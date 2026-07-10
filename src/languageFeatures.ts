import * as vscode from 'vscode';
import { execFile } from 'child_process';
import * as path from 'path';
import { KeywordProvider, Keyword } from './keywordProvider';
import {
    PythonTarget,
    describePythonTarget,
    withPythonProcessEnv
} from './pythonRuntimeResolver';
import {
    DslDiagnostic,
    SourceDefinition,
    collectDslDiagnostics,
    findKeywordAtOffset,
    findVariableAtOffset,
    isDslLikeFile,
    markEffectiveVariableDefinitions,
    parseDslVariableDefinitions,
    parseResourceDefinitions,
    parseYamlVariableDefinitions,
    selectEffectiveVariableDefinition,
    uniqueKeywordsByName
} from './languageService';

const INDEX_CACHE_TTL_MS = 30000;
const PYTHON_DEFINITION_TIMEOUT_MS = 15000;
const PYTHON_DEFINITION_MAX_BUFFER = 10 * 1024 * 1024;
const FIND_FILES_EXCLUDE = '**/{.git,node_modules,.venv,venv,__pycache__,dist,build,.pytest_cache}/**';

const PYTHON_DEFINITION_SCRIPT = `
import contextlib
import inspect
import io
import json
import os
import sys

project_root = sys.argv[1]
os.chdir(project_root)
captured = io.StringIO()

def parameter_dict(param):
    return {
        "name": getattr(param, "name", str(param)),
        "mapping": getattr(param, "mapping", ""),
        "description": getattr(param, "description", ""),
        "default": getattr(param, "default", None),
    }

definitions = []
with contextlib.redirect_stdout(captured):
    from pytest_dsl.core.keyword_loader import load_all_keywords
    from pytest_dsl.core.keyword_manager import keyword_manager

    project_custom_keywords = load_all_keywords(include_remote=False) or {}

    for name, info in keyword_manager._keywords.items():
        if name in project_custom_keywords:
            continue

        func = info.get("func")
        if not func:
            continue

        try:
            unwrapped = inspect.unwrap(func)
            source_file = inspect.getsourcefile(unwrapped) or inspect.getfile(unwrapped)
            source_lines = None
            start_line = None
            try:
                source_lines, start_line = inspect.getsourcelines(unwrapped)
            except Exception:
                pass
        except Exception:
            continue

        if not source_file:
            continue

        definition_line = int(start_line or 1)
        if source_lines is not None:
            for offset, line_text in enumerate(source_lines):
                if line_text.lstrip().startswith("def "):
                    definition_line = int(start_line + offset)
                    break

        definitions.append({
            "name": name,
            "path": os.path.abspath(source_file),
            "line": definition_line,
            "column": 1,
            "parameters": [parameter_dict(param) for param in info.get("parameters", [])],
        })

diagnostics = captured.getvalue()
if diagnostics:
    print(diagnostics, file=sys.stderr, end="")

print(json.dumps({"definitions": definitions}, ensure_ascii=False))
`;

export class WorkspaceDslIndex {
    private resourceCache: { timestamp: number; definitions: SourceDefinition[] } | null = null;
    private yamlCache: { timestamp: number; signature: string; definitions: SourceDefinition[] } | null = null;
    private pythonCache: { timestamp: number; projectRoot: string; definitions: SourceDefinition[] } | null = null;

    constructor(
        private keywordProvider: KeywordProvider,
        private yamlPathsProvider?: (document?: vscode.TextDocument) => string[] | null
    ) {}

    invalidate(uri?: vscode.Uri): void {
        if (!uri) {
            this.resourceCache = null;
            this.yamlCache = null;
            this.pythonCache = null;
            return;
        }

        const fileName = uri.fsPath.toLowerCase();
        if (fileName.endsWith('.resource')) {
            this.resourceCache = null;
        }
        if (fileName.endsWith('.yaml') || fileName.endsWith('.yml')) {
            this.yamlCache = null;
        }
        if (fileName.endsWith('.py') || fileName.endsWith('.resource')) {
            this.pythonCache = null;
        }
    }

    async getResourceDefinitions(): Promise<SourceDefinition[]> {
        if (this.resourceCache && Date.now() - this.resourceCache.timestamp < INDEX_CACHE_TTL_MS) {
            return this.resourceCache.definitions;
        }

        const uris = await vscode.workspace.findFiles('**/*.resource', FIND_FILES_EXCLUDE, 2000);
        const definitions = (await Promise.all(
            uris.map(async (uri) => parseResourceDefinitions(await this.readText(uri), uri.fsPath))
        )).flat();

        this.resourceCache = {
            timestamp: Date.now(),
            definitions
        };
        return definitions;
    }

    async getYamlVariableDefinitions(document?: vscode.TextDocument): Promise<SourceDefinition[]> {
        const selectedPaths = this.yamlPathsProvider ? this.yamlPathsProvider(document) : null;
        // YAML load order is significant: a later configured file overrides an earlier one.
        const signature = selectedPaths ? selectedPaths.join('\0') : '*';
        if (
            this.yamlCache &&
            this.yamlCache.signature === signature &&
            Date.now() - this.yamlCache.timestamp < INDEX_CACHE_TTL_MS
        ) {
            return this.yamlCache.definitions;
        }

        const uris = selectedPaths
            ? selectedPaths.filter((filePath) => /\.ya?ml$/i.test(filePath)).map((filePath) => vscode.Uri.file(filePath))
            : await vscode.workspace.findFiles('**/*.{yaml,yml}', FIND_FILES_EXCLUDE, 2000);
        const definitions = (await Promise.all(
            uris.map(async (uri) => {
                try {
                    return parseYamlVariableDefinitions(await this.readText(uri), uri.fsPath);
                } catch {
                    return [];
                }
            })
        )).flat();
        markEffectiveVariableDefinitions(definitions);

        this.yamlCache = {
            timestamp: Date.now(),
            signature,
            definitions
        };
        return definitions;
    }

    async getWorkspaceVariableDefinitions(document?: vscode.TextDocument): Promise<SourceDefinition[]> {
        const definitions: SourceDefinition[] = [];
        if (document && isDslDocument(document)) {
            definitions.push(...parseDslVariableDefinitions(document.getText(), document.uri.fsPath));
        }
        definitions.push(...await this.getYamlVariableDefinitions(document));
        return definitions;
    }

    async findVariableDefinitions(name: string, document: vscode.TextDocument): Promise<SourceDefinition[]> {
        return (await this.getWorkspaceVariableDefinitions(document))
            .filter((definition) => definition.name === name);
    }

    async findKeywordDefinitions(name: string): Promise<SourceDefinition[]> {
        const resourceDefinitions = (await this.getResourceDefinitions())
            .filter((definition) => definition.name === name);
        const pythonDefinitions = (await this.getPythonKeywordDefinitions())
            .filter((definition) => definition.name === name);
        return [...resourceDefinitions, ...pythonDefinitions];
    }

    private async getPythonKeywordDefinitions(): Promise<SourceDefinition[]> {
        const projectRoot = this.keywordProvider.getProjectRoot();
        if (
            this.pythonCache &&
            this.pythonCache.projectRoot === projectRoot &&
            Date.now() - this.pythonCache.timestamp < INDEX_CACHE_TTL_MS
        ) {
            return this.pythonCache.definitions;
        }

        try {
            const definitions = await this.queryPythonKeywordDefinitions(projectRoot);
            this.pythonCache = {
                timestamp: Date.now(),
                projectRoot,
                definitions
            };
            return definitions;
        } catch (error) {
            console.warn('pytest-dsl 关键字定义查询失败:', error);
            return [];
        }
    }

    private queryPythonKeywordDefinitions(projectRoot: string): Promise<SourceDefinition[]> {
        const targets = this.keywordProvider.getPythonTargets();
        const errors: string[] = [];

        const tryTarget = (index: number): Promise<SourceDefinition[]> => {
            const target = targets[index];
            if (!target) {
                return Promise.reject(new Error(
                    `Unable to load pytest-dsl keyword definitions. Tried:\n${errors.map((item) => `- ${item}`).join('\n') || '- no Python candidates'}`
                ));
            }

            return this.queryPythonKeywordDefinitionsWithTarget(projectRoot, target)
                .catch((error) => {
                    errors.push(`${describePythonTarget(target)}: ${error}`);
                    if (target.required) {
                        throw error;
                    }
                    return tryTarget(index + 1);
                });
        };

        return tryTarget(0);
    }

    private queryPythonKeywordDefinitionsWithTarget(projectRoot: string, target: PythonTarget): Promise<SourceDefinition[]> {
        return new Promise((resolve, reject) => {
            execFile(
                target.command,
                [
                    ...target.args,
                    '-c',
                    PYTHON_DEFINITION_SCRIPT,
                    projectRoot
                ],
                {
                    cwd: projectRoot,
                    env: withPythonProcessEnv(process.env),
                    timeout: PYTHON_DEFINITION_TIMEOUT_MS,
                    maxBuffer: PYTHON_DEFINITION_MAX_BUFFER
                },
                (error, stdout, stderr) => {
                    if (error) {
                        reject(new Error(String(stderr || error.message)));
                        return;
                    }

                    try {
                        const payload = JSON.parse(stdout);
                        const definitions = Array.isArray(payload.definitions) ? payload.definitions : [];
                        resolve(definitions.map((definition: any) => ({
                            name: String(definition.name || ''),
                            path: String(definition.path || ''),
                            line: Math.max(1, Number(definition.line) || 1),
                            column: Math.max(1, Number(definition.column) || 1),
                            kind: 'python' as const,
                            parameters: Array.isArray(definition.parameters) ? definition.parameters : []
                        })).filter((definition: SourceDefinition) => definition.name && definition.path));
                    } catch (parseError) {
                        reject(parseError);
                    }
                }
            );
        });
    }

    private async readText(uri: vscode.Uri): Promise<string> {
        const openDocument = vscode.workspace.textDocuments.find((document) => (
            document.uri.toString() === uri.toString()
        ));
        if (openDocument) {
            return openDocument.getText();
        }
        const bytes = await vscode.workspace.fs.readFile(uri);
        return Buffer.from(bytes).toString('utf8');
    }
}

export class DslDefinitionProvider implements vscode.DefinitionProvider {
    constructor(private workspaceIndex: WorkspaceDslIndex) {}

    async provideDefinition(
        document: vscode.TextDocument,
        position: vscode.Position
    ): Promise<vscode.Definition | undefined> {
        const offset = document.offsetAt(position);
        const text = document.getText();
        const variable = findVariableAtOffset(text, offset);
        if (variable) {
            return this.toLocations(await this.workspaceIndex.findVariableDefinitions(variable.name, document));
        }

        const keyword = findKeywordAtOffset(text, offset);
        if (keyword) {
            return this.toLocations(await this.workspaceIndex.findKeywordDefinitions(keyword.name));
        }

        return undefined;
    }

    private toLocations(definitions: SourceDefinition[]): vscode.Location[] {
        return definitions.map((definition) => new vscode.Location(
            vscode.Uri.file(definition.path),
            new vscode.Position(Math.max(0, definition.line - 1), Math.max(0, definition.column - 1))
        ));
    }
}

export class DslHoverProvider implements vscode.HoverProvider {
    constructor(
        private keywordProvider: KeywordProvider,
        private workspaceIndex: WorkspaceDslIndex
    ) {}

    async provideHover(
        document: vscode.TextDocument,
        position: vscode.Position
    ): Promise<vscode.Hover | undefined> {
        const offset = document.offsetAt(position);
        const text = document.getText();
        const variable = findVariableAtOffset(text, offset);
        if (variable) {
            const definitions = await this.workspaceIndex.findVariableDefinitions(variable.name, document);
            const markdown = new vscode.MarkdownString();
            markdown.appendMarkdown(`**变量** \`\${${escapeInlineCode(variable.name)}}\``);
            const effectiveDefinition = selectEffectiveVariableDefinition(definitions);
            if (effectiveDefinition) {
                if (effectiveDefinition.valuePreview) {
                    markdown.appendMarkdown(`\n\n**当前值** \`${escapeInlineCode(effectiveDefinition.valuePreview)}\``);
                }
                markdown.appendMarkdown(
                    `\n\n**来源** ${escapeMarkdownText(path.basename(effectiveDefinition.path))}:${effectiveDefinition.line}`
                );
                if (effectiveDefinition.kind === 'yaml-variable') {
                    markdown.appendMarkdown('\n\n_值来自当前 DSL 文件已配置的 YAML，后加载的配置优先。_');
                }
                const overriddenCount = definitions.filter((definition) => definition !== effectiveDefinition).length;
                if (overriddenCount > 0) {
                    markdown.appendMarkdown(`\n\n其他定义: ${overriddenCount} 个`);
                }
            } else {
                markdown.appendMarkdown('\n\n未在当前 DSL 或已配置的 YAML 中找到定义。');
            }
            return new vscode.Hover(markdown, new vscode.Range(
                document.positionAt(variable.start),
                document.positionAt(variable.end)
            ));
        }

        const keywordSymbol = findKeywordAtOffset(text, offset);
        if (!keywordSymbol) {
            return undefined;
        }

        let keyword: Keyword | undefined;
        try {
            keyword = (uniqueKeywordsByName(await this.keywordProvider.getKeywords()) as Keyword[])
                .find((item) => item.name === keywordSymbol.name);
        } catch {
            return undefined;
        }
        if (!keyword) {
            return undefined;
        }

        return new vscode.Hover(keywordMarkdown(keyword));
    }
}

export class DslDiagnosticsManager implements vscode.Disposable {
    private readonly collection = vscode.languages.createDiagnosticCollection('pytest-dsl');
    private readonly timers = new Map<string, NodeJS.Timeout>();
    private disposed = false;

    constructor(
        private keywordProvider: KeywordProvider,
        private workspaceIndex: WorkspaceDslIndex
    ) {}

    activate(context: vscode.ExtensionContext): void {
        context.subscriptions.push(vscode.workspace.onDidOpenTextDocument((document) => this.schedule(document)));
        context.subscriptions.push(vscode.workspace.onDidChangeTextDocument((event) => {
            this.workspaceIndex.invalidate(event.document.uri);
            this.schedule(event.document);
        }));
        context.subscriptions.push(vscode.workspace.onDidSaveTextDocument((document) => {
            this.workspaceIndex.invalidate(document.uri);
            this.schedule(document);
        }));
        context.subscriptions.push(vscode.workspace.onDidCloseTextDocument((document) => {
            this.collection.delete(document.uri);
        }));
        context.subscriptions.push(vscode.window.onDidChangeActiveTextEditor((editor) => {
            if (editor) {
                this.schedule(editor.document);
            }
        }));

        vscode.workspace.textDocuments.forEach((document) => this.schedule(document));
        if (vscode.window.activeTextEditor) {
            this.schedule(vscode.window.activeTextEditor.document);
        }
    }

    dispose(): void {
        this.disposed = true;
        this.timers.forEach((timer) => clearTimeout(timer));
        this.timers.clear();
        this.collection.dispose();
    }

    schedule(document: vscode.TextDocument): void {
        if (!isDslDocument(document) || document.uri.scheme !== 'file') {
            return;
        }
        const key = document.uri.toString();
        const existing = this.timers.get(key);
        if (existing) {
            clearTimeout(existing);
        }
        this.timers.set(key, setTimeout(() => {
            this.timers.delete(key);
            this.update(document).catch((error) => {
                console.warn('pytest-dsl 诊断更新失败:', error);
            });
        }, 250));
    }

    private async update(document: vscode.TextDocument): Promise<void> {
        if (this.disposed || !isDslDocument(document)) {
            return;
        }

        const [keywords, resourceDefinitions] = await Promise.all([
            this.loadKeywordsForDiagnostics(),
            this.workspaceIndex.getResourceDefinitions()
        ]);
        const diagnostics = collectDslDiagnostics(document.getText(), keywords, resourceDefinitions)
            .map((diagnostic) => toVscodeDiagnostic(document, diagnostic));
        this.collection.set(document.uri, diagnostics);
    }

    private async loadKeywordsForDiagnostics(): Promise<Keyword[]> {
        try {
            if (!await this.keywordProvider.validateEnvironment()) {
                return [];
            }
            return uniqueKeywordsByName(await this.keywordProvider.getKeywords()) as Keyword[];
        } catch {
            return [];
        }
    }
}

export function isDslDocument(document: vscode.TextDocument): boolean {
    return document.languageId === 'pytest-dsl' || isDslLikeFile(document.fileName);
}

function toVscodeDiagnostic(document: vscode.TextDocument, diagnostic: DslDiagnostic): vscode.Diagnostic {
    const startLine = Math.min(document.lineCount - 1, diagnostic.range.start.line);
    const endLine = Math.min(document.lineCount - 1, diagnostic.range.end.line);
    const range = new vscode.Range(
        new vscode.Position(startLine, diagnostic.range.start.character),
        new vscode.Position(endLine, diagnostic.range.end.character)
    );
    const item = new vscode.Diagnostic(range, diagnostic.message, toSeverity(diagnostic.severity));
    item.source = 'pytest-dsl';
    item.code = diagnostic.code;
    return item;
}

function toSeverity(severity: DslDiagnostic['severity']): vscode.DiagnosticSeverity {
    switch (severity) {
        case 'error':
            return vscode.DiagnosticSeverity.Error;
        case 'information':
            return vscode.DiagnosticSeverity.Information;
        default:
            return vscode.DiagnosticSeverity.Warning;
    }
}

function keywordMarkdown(keyword: Keyword): vscode.MarkdownString {
    const markdown = new vscode.MarkdownString();
    markdown.appendMarkdown(`**${keyword.name}**`);
    if (keyword.source_info?.display_name) {
        markdown.appendMarkdown(`\n\n来源: ${keyword.source_info.display_name}`);
    }
    if (keyword.documentation) {
        markdown.appendMarkdown(`\n\n${keyword.documentation}`);
    }
    if (keyword.parameters && keyword.parameters.length > 0) {
        markdown.appendMarkdown('\n\n参数:\n');
        keyword.parameters.forEach((parameter) => {
            markdown.appendMarkdown(`\n- \`${parameter.name}\`: ${parameter.description || '无说明'}`);
        });
    }
    return markdown;
}

function escapeInlineCode(value: string): string {
    return String(value || '').replace(/`/g, '\\`');
}

function escapeMarkdownText(value: string): string {
    return String(value || '').replace(/([\\`*_{}\[\]()#+\-.!])/g, '\\$1');
}
