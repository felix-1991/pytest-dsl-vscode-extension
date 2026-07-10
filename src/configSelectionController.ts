import { execFile } from 'child_process';
import * as path from 'path';
import * as vscode from 'vscode';
import {
    ConfigFile,
    ResolvedConfigSelection,
    StoredConfigSelection,
    defaultConfigPaths,
    discoverConfigFiles,
    normalizeConfigProfiles,
    resolveConfigSelection
} from './configSelectionService';
import { resolveUsablePythonTarget } from './executionService';
import { resolveProjectRoot } from './projectContext';
import { withPythonProcessEnv } from './pythonRuntimeResolver';

const YAML_VALIDATION_SCRIPT = `
import json
import sys
import yaml

results = {}
for file_path in sys.argv[1:]:
    try:
        with open(file_path, "r", encoding="utf-8") as stream:
            yaml.safe_load(stream)
        results[file_path] = None
    except Exception as exc:
        results[file_path] = str(exc)
print(json.dumps(results, ensure_ascii=False))
`;

interface ConfigModeItem extends vscode.QuickPickItem {
    action: 'auto' | 'files' | 'profile' | 'manage' | 'refresh';
    profileName?: string;
}

interface ConfigFileItem extends vscode.QuickPickItem {
    file: ConfigFile;
    validationError?: string;
}

export interface ConfigValidationFailure {
    relativePath: string;
    message: string;
}

export class DslConfigSelectionController implements vscode.Disposable {
    private readonly statusItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 80);
    private readonly selectionEmitter = new vscode.EventEmitter<ResolvedConfigSelection>();
    private readonly disposables: vscode.Disposable[] = [];

    readonly onDidChangeSelection = this.selectionEmitter.event;

    constructor(private readonly context: vscode.ExtensionContext) {
        this.statusItem.command = 'pytest-dsl.selectConfig';
        this.disposables.push(
            this.statusItem,
            this.selectionEmitter,
            vscode.commands.registerCommand('pytest-dsl.selectConfig', () => this.selectPersistentConfig()),
            vscode.commands.registerCommand('pytest-dsl.refreshConfigs', () => this.refresh()),
            vscode.commands.registerCommand('pytest-dsl.manageConfigProfiles', () => {
                return vscode.commands.executeCommand(
                    'workbench.action.openSettings',
                    '@ext:felix-1991.pytest-dsl-support pytest-dsl.configProfiles'
                );
            }),
            vscode.window.onDidChangeActiveTextEditor(() => this.updateStatus()),
            vscode.workspace.onDidChangeConfiguration((event) => {
                if (event.affectsConfiguration('pytest-dsl')) {
                    this.updateStatus();
                }
            })
        );
        this.updateStatus();
    }

    getActiveSelection(document: vscode.TextDocument): ResolvedConfigSelection {
        const projectRoot = resolveProjectRoot(document);
        const config = vscode.workspace.getConfiguration('pytest-dsl', document.uri);
        const profiles = normalizeConfigProfiles(config.get<unknown>('configProfiles', {}));
        const stored = this.context.workspaceState.get<StoredConfigSelection>(selectionKey(projectRoot));
        return resolveConfigSelection(
            projectRoot,
            stored,
            profiles,
            config.get<string>('activeConfigProfile', '').trim(),
            config.get<string[]>('yamlVars', [])
        );
    }

    getCompletionConfigPaths(document: vscode.TextDocument): string[] {
        const projectRoot = resolveProjectRoot(document);
        const selection = this.getActiveSelection(document);
        const paths = selection.kind === 'auto'
            ? defaultConfigPaths(discoverConfigFiles(projectRoot))
            : selection.paths;
        return paths.map((item) => path.isAbsolute(item) ? item : path.resolve(projectRoot, item));
    }

    async chooseTemporarySelection(document: vscode.TextDocument): Promise<ResolvedConfigSelection | undefined> {
        return this.showSelectionMenu(document, false);
    }

    async validateSelection(
        document: vscode.TextDocument,
        selection: ResolvedConfigSelection
    ): Promise<ConfigValidationFailure[]> {
        if (selection.paths.length === 0) {
            return [];
        }
        const projectRoot = resolveProjectRoot(document);
        const files: ConfigFile[] = selection.paths.map((relativePath) => ({
            relativePath,
            absolutePath: path.isAbsolute(relativePath) ? relativePath : path.resolve(projectRoot, relativePath),
            defaultConfig: false
        }));
        const errors = await this.validateYamlFiles(document, projectRoot, files);
        return files.flatMap((file) => {
            const message = errors.get(file.absolutePath);
            return message ? [{ relativePath: file.relativePath, message }] : [];
        });
    }

    dispose(): void {
        this.disposables.splice(0).forEach((item) => item.dispose());
    }

    private async selectPersistentConfig(): Promise<void> {
        const document = activeDslDocument();
        if (!document) {
            void vscode.window.showWarningMessage('请先打开 pytest-DSL 文件');
            return;
        }
        await this.showSelectionMenu(document, true);
    }

    private async showSelectionMenu(
        document: vscode.TextDocument,
        persist: boolean
    ): Promise<ResolvedConfigSelection | undefined> {
        const projectRoot = resolveProjectRoot(document);
        const config = vscode.workspace.getConfiguration('pytest-dsl', document.uri);
        const profiles = normalizeConfigProfiles(config.get<unknown>('configProfiles', {}));
        const current = this.getActiveSelection(document);
        const items: ConfigModeItem[] = [
            {
                label: '$(sparkle) 自动使用 pytest-dsl 默认配置',
                description: current.kind === 'auto' ? '当前' : '',
                detail: '不传 --yaml-vars，由 pytest-dsl 按默认规则发现配置',
                action: 'auto'
            },
            {
                label: '$(list-selection) 选择配置文件…',
                description: current.kind === 'files' || current.kind === 'settings' ? current.label : '',
                detail: '从项目 config 目录多选 YAML 文件',
                action: 'files'
            },
            ...Object.keys(profiles).sort().map((name): ConfigModeItem => ({
                label: `$(symbol-enum) ${name}`,
                description: current.kind === 'profile' && current.profileName === name ? '当前方案' : `${profiles[name].length} 个文件`,
                detail: profiles[name].join(' → ') || '空方案（等同自动）',
                action: 'profile',
                profileName: name
            })),
            {
                label: '$(refresh) 刷新配置文件',
                action: 'refresh'
            },
            {
                label: '$(settings-gear) 管理配置方案…',
                detail: '编辑 pytest-dsl.configProfiles 设置',
                action: 'manage'
            }
        ];
        const selected = await vscode.window.showQuickPick(items, {
            placeHolder: persist ? '选择项目默认运行配置' : '选择本次运行使用的配置',
            matchOnDescription: true,
            matchOnDetail: true
        });
        if (!selected) {
            return undefined;
        }
        if (selected.action === 'manage') {
            await vscode.commands.executeCommand(
                'workbench.action.openSettings',
                '@ext:felix-1991.pytest-dsl-support pytest-dsl.configProfiles'
            );
            return undefined;
        }
        if (selected.action === 'refresh') {
            return this.showSelectionMenu(document, persist);
        }

        let stored: StoredConfigSelection;
        if (selected.action === 'auto') {
            stored = { kind: 'auto' };
        } else if (selected.action === 'profile' && selected.profileName) {
            stored = { kind: 'profile', name: selected.profileName };
        } else {
            const paths = await this.chooseConfigFiles(document, projectRoot, current.paths);
            if (!paths) {
                return undefined;
            }
            stored = paths.length > 0 ? { kind: 'files', paths } : { kind: 'auto' };
        }

        const resolved = resolveConfigSelection(projectRoot, stored, profiles, '', []);
        if (resolved.missingPaths.length > 0) {
            void vscode.window.showErrorMessage(`配置文件不存在: ${resolved.missingPaths.join(', ')}`);
            return undefined;
        }
        const validationFailures = await this.validateSelection(document, resolved);
        if (validationFailures.length > 0) {
            const first = validationFailures[0];
            void vscode.window.showErrorMessage(`${first.relativePath} 存在 YAML 语法错误: ${first.message}`);
            return undefined;
        }
        if (persist) {
            await this.context.workspaceState.update(selectionKey(projectRoot), stored);
            this.selectionEmitter.fire(resolved);
            this.updateStatus();
            void vscode.window.showInformationMessage(`pytest-DSL 配置已切换为：${resolved.label}`);
        }
        return resolved;
    }

    private async chooseConfigFiles(
        document: vscode.TextDocument,
        projectRoot: string,
        selectedPaths: string[]
    ): Promise<string[] | undefined> {
        const files = discoverConfigFiles(projectRoot);
        if (files.length === 0) {
            void vscode.window.showWarningMessage(`未在 ${path.join(projectRoot, 'config')} 中找到 YAML 配置`);
            return undefined;
        }
        const errors = await vscode.window.withProgress({
            location: vscode.ProgressLocation.Window,
            title: '正在校验 pytest-DSL 配置…'
        }, () => this.validateYamlFiles(document, projectRoot, files));
        const selectedSet = new Set(selectedPaths);
        const items: ConfigFileItem[] = files.map((file) => {
            const validationError = errors.get(file.absolutePath);
            return {
                label: `${validationError ? '$(error)' : errors.has(file.absolutePath) ? '$(check)' : '$(question)'} ${file.relativePath}`,
                description: validationError ? 'YAML 解析失败，不可选择' : file.defaultConfig ? '默认配置候选' : '',
                detail: validationError || undefined,
                picked: selectedSet.has(file.relativePath),
                file,
                validationError
            };
        });
        const selected = await vscode.window.showQuickPick(items, {
            canPickMany: true,
            placeHolder: '选择 YAML 配置；执行顺序与列表顺序一致',
            matchOnDescription: true,
            matchOnDetail: true
        });
        if (!selected) {
            return undefined;
        }
        const invalid = selected.find((item) => item.validationError);
        if (invalid) {
            void vscode.window.showErrorMessage(`${invalid.file.relativePath} 存在 YAML 语法错误，不能用于运行`);
            return undefined;
        }
        return selected.map((item) => item.file.relativePath);
    }

    private async validateYamlFiles(
        document: vscode.TextDocument,
        projectRoot: string,
        files: ConfigFile[]
    ): Promise<Map<string, string | undefined>> {
        const config = vscode.workspace.getConfiguration('pytest-dsl', document.uri);
        try {
            const target = await resolveUsablePythonTarget(
                projectRoot,
                config.get<string>('pythonPath', '')
            );
            const output = await execFileText(
                target.command,
                [...target.args, '-c', YAML_VALIDATION_SCRIPT, ...files.map((file) => file.absolutePath)],
                projectRoot
            );
            const payload = JSON.parse(output) as Record<string, string | null>;
            return new Map(Object.entries(payload).map(([filePath, error]) => [filePath, error || undefined]));
        } catch (error) {
            console.warn('pytest-DSL YAML 校验暂不可用:', error);
            return new Map();
        }
    }

    private async refresh(): Promise<void> {
        this.updateStatus();
        const document = activeDslDocument();
        if (document) {
            await this.showSelectionMenu(document, true);
        }
    }

    private updateStatus(): void {
        const document = activeDslDocument();
        if (!document) {
            this.statusItem.hide();
            return;
        }
        try {
            const selection = this.getActiveSelection(document);
            this.statusItem.text = `$(settings-gear) Config: ${selection.label}`;
            this.statusItem.tooltip = selection.kind === 'auto'
                ? '自动使用 pytest-dsl 默认配置加载规则\n点击选择明确的 YAML 配置'
                : `加载顺序:\n${selection.paths.map((item, index) => `${index + 1}. ${item}`).join('\n')}`;
            this.statusItem.backgroundColor = selection.missingPaths.length > 0
                ? new vscode.ThemeColor('statusBarItem.errorBackground')
                : undefined;
            this.statusItem.show();
        } catch (error) {
            this.statusItem.text = '$(error) Config: 配置错误';
            this.statusItem.tooltip = error instanceof Error ? error.message : String(error);
            this.statusItem.backgroundColor = new vscode.ThemeColor('statusBarItem.errorBackground');
            this.statusItem.show();
        }
    }
}

function activeDslDocument(): vscode.TextDocument | undefined {
    const editor = vscode.window.activeTextEditor;
    return editor && editor.document.languageId === 'pytest-dsl' ? editor.document : undefined;
}

function selectionKey(projectRoot: string): string {
    return `pytest-dsl.configSelection:${path.resolve(projectRoot)}`;
}

function execFileText(command: string, args: string[], cwd: string): Promise<string> {
    return new Promise((resolve, reject) => {
        execFile(command, args, {
            cwd,
            env: withPythonProcessEnv(process.env),
            timeout: 15000,
            maxBuffer: 5 * 1024 * 1024
        }, (error, stdout, stderr) => {
            if (error) {
                reject(new Error(String(stderr || stdout || error.message).trim()));
                return;
            }
            resolve(stdout);
        });
    });
}
