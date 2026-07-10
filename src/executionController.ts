import * as path from 'path';
import * as vscode from 'vscode';
import { DslConfigSelectionController } from './configSelectionController';
import { ResolvedConfigSelection } from './configSelectionService';
import {
    DebugCommand,
    DslExecutionService,
    ExecutionEvent,
    ExecutionMode
} from './executionService';
import { resolveProjectRoot } from './projectContext';

const RUNNABLE_EXTENSIONS = new Set(['.dsl', '.auto']);

export class DslExecutionController implements vscode.Disposable {
    private readonly output = vscode.window.createOutputChannel('pytest-DSL');
    private readonly currentLineDecoration = vscode.window.createTextEditorDecorationType({
        isWholeLine: true,
        backgroundColor: new vscode.ThemeColor('editor.stackFrameHighlightBackground'),
        overviewRulerColor: new vscode.ThemeColor('editorOverviewRuler.infoForeground'),
        overviewRulerLane: vscode.OverviewRulerLane.Full,
        before: {
            contentText: '▶ ',
            color: new vscode.ThemeColor('debugIcon.startForeground')
        }
    });
    private readonly nextItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 101);
    private readonly continueItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
    private readonly stopItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 99);
    private readonly service: DslExecutionService;
    private activeDocumentUri: vscode.Uri | null = null;
    private paused = false;
    private readonly disposables: vscode.Disposable[] = [];

    constructor(
        private readonly context: vscode.ExtensionContext,
        private readonly configSelectionController: DslConfigSelectionController
    ) {
        this.service = new DslExecutionService((event) => this.handleEvent(event));
        this.nextItem.text = '$(debug-step-over) pytest-DSL 单步';
        this.nextItem.tooltip = '执行下一步 (F10)';
        this.nextItem.command = 'pytest-dsl.debugNext';
        this.continueItem.text = '$(debug-continue) pytest-DSL 继续';
        this.continueItem.tooltip = '继续执行 (F5)';
        this.continueItem.command = 'pytest-dsl.debugContinue';
        this.stopItem.text = '$(debug-stop) pytest-DSL 停止';
        this.stopItem.tooltip = '停止当前任务 (Shift+F5)';
        this.stopItem.command = 'pytest-dsl.stopExecution';

        this.disposables.push(
            this.output,
            this.currentLineDecoration,
            this.nextItem,
            this.continueItem,
            this.stopItem,
            vscode.commands.registerCommand('pytest-dsl.runFile', () => this.runActiveFile('run')),
            vscode.commands.registerCommand('pytest-dsl.debugFile', () => this.runActiveFile('debug')),
            vscode.commands.registerCommand('pytest-dsl.runFileWithConfig', () => this.runWithSelectedConfig('run')),
            vscode.commands.registerCommand('pytest-dsl.debugFileWithConfig', () => this.runWithSelectedConfig('debug')),
            vscode.commands.registerCommand('pytest-dsl.debugFromCursor', (line?: number) => {
                const editor = vscode.window.activeTextEditor;
                const lineNumber = typeof line === 'number'
                    ? line + 1
                    : (editor?.selection.active.line ?? 0) + 1;
                return this.runActiveFile('debug', lineNumber);
            }),
            vscode.commands.registerCommand('pytest-dsl.debugNext', () => this.sendDebugCommand('next')),
            vscode.commands.registerCommand('pytest-dsl.debugContinue', () => this.sendDebugCommand('continue')),
            vscode.commands.registerCommand('pytest-dsl.stopExecution', () => this.stop())
        );

        void this.setExecutionContext(false, false);
    }

    registerCodeLens(selector: vscode.DocumentSelector): vscode.Disposable {
        const provider = new DslExecutionCodeLensProvider();
        const disposable = vscode.languages.registerCodeLensProvider(selector, provider);
        this.disposables.push(disposable);
        return disposable;
    }

    dispose(): void {
        this.service.dispose();
        this.disposables.splice(0).forEach((item) => item.dispose());
    }

    async runActiveFile(
        mode: ExecutionMode,
        pauseFromLine?: number,
        configSelectionOverride?: ResolvedConfigSelection,
        configSelectionValidated = false
    ): Promise<void> {
        const editor = vscode.window.activeTextEditor;
        if (!editor || editor.document.languageId !== 'pytest-dsl') {
            void vscode.window.showWarningMessage('请先打开 pytest-DSL 文件');
            return;
        }
        if (!RUNNABLE_EXTENSIONS.has(path.extname(editor.document.fileName).toLowerCase())) {
            void vscode.window.showWarningMessage('仅 .dsl 和 .auto 文件支持整文件运行或调试');
            return;
        }
        if (this.service.isRunning) {
            void vscode.window.showWarningMessage('已有 pytest-DSL 任务正在运行，请先停止');
            return;
        }
        if (editor.document.isUntitled) {
            void vscode.window.showWarningMessage('请先保存当前 pytest-DSL 文件');
            return;
        }
        if (editor.document.isDirty && !await editor.document.save()) {
            return;
        }

        const projectRoot = resolveProjectRoot(editor.document);
        const config = vscode.workspace.getConfiguration('pytest-dsl', editor.document.uri);
        const configSelection = configSelectionOverride || this.configSelectionController.getActiveSelection(editor.document);
        if (configSelection.missingPaths.length > 0) {
            void vscode.window.showErrorMessage(`配置文件不存在: ${configSelection.missingPaths.join(', ')}`);
            return;
        }
        const validationFailures = configSelectionValidated
            ? []
            : await this.configSelectionController.validateSelection(editor.document, configSelection);
        if (validationFailures.length > 0) {
            const first = validationFailures[0];
            void vscode.window.showErrorMessage(`${first.relativePath} 存在 YAML 语法错误，请先修复后再执行`);
            return;
        }
        const yamlVars = configSelection.paths;
        const configuredPython = config.get<string>('pythonPath', '');

        this.activeDocumentUri = editor.document.uri;
        this.paused = false;
        this.clearCurrentLine();
        this.output.clear();
        this.output.show(true);
        this.output.appendLine(`【pytest-DSL ${mode === 'debug' ? '调试' : '运行'}】${editor.document.fileName}`);
        this.output.appendLine(`项目: ${projectRoot}`);
        this.output.appendLine(`配置: ${configSelection.label}${configSelection.kind === 'auto' ? '（pytest-dsl 默认加载规则）' : ''}`);
        configSelection.paths.forEach((item, index) => this.output.appendLine(`  ${index + 1}. ${item}`));
        if (pauseFromLine && pauseFromLine > 1) {
            this.output.appendLine(`调试起点: 第 ${pauseFromLine} 行（起点前步骤正常执行但不暂停）`);
        }
        await this.setExecutionContext(true, false);
        this.updateStatusItems();

        try {
            await this.service.start({
                mode,
                projectRoot,
                filePath: editor.document.fileName,
                configuredPython,
                yamlVars,
                pauseFromLine
            });
        } catch (error) {
            this.output.appendLine(`启动失败: ${error instanceof Error ? error.message : String(error)}`);
            void vscode.window.showErrorMessage(`pytest-DSL ${mode === 'debug' ? '调试' : '运行'}失败，请查看输出面板`);
            await this.finishExecution();
        }
    }

    private async runWithSelectedConfig(mode: ExecutionMode): Promise<void> {
        const editor = vscode.window.activeTextEditor;
        if (!editor || editor.document.languageId !== 'pytest-dsl') {
            void vscode.window.showWarningMessage('请先打开 pytest-DSL 文件');
            return;
        }
        const selection = await this.configSelectionController.chooseTemporarySelection(editor.document);
        if (selection) {
            await this.runActiveFile(mode, undefined, selection, true);
        }
    }

    private sendDebugCommand(command: DebugCommand): void {
        if (!this.service.sendDebugCommand(command)) {
            return;
        }
        this.paused = false;
        this.clearCurrentLine();
        void this.setExecutionContext(true, false);
        this.updateStatusItems();
        this.output.appendLine(command === 'continue' ? '继续执行' : '执行下一步');
    }

    private stop(): void {
        if (this.service.stop()) {
            this.output.appendLine('正在停止任务...');
        }
    }

    private handleEvent(event: ExecutionEvent): void {
        if (event.type === 'started') {
            this.updateStatusItems();
            this.output.appendLine(`Python: ${event.target.command}`);
            this.output.appendLine(`命令: ${event.command}`);
            this.output.appendLine('');
            return;
        }
        if (event.type === 'stdout' || event.type === 'stderr') {
            this.output.append(event.text);
            return;
        }
        if (event.type === 'debug-step') {
            this.handleDebugStep(event);
            return;
        }
        if (event.type === 'completed') {
            const labels = { passed: '通过', failed: '失败', stopped: '已停止' };
            this.output.appendLine('');
            this.output.appendLine(`任务${labels[event.status]}${event.exitCode === null ? '' : `（退出码 ${event.exitCode}）`}`);
            void this.finishExecution();
        }
    }

    private handleDebugStep(event: Extract<ExecutionEvent, { type: 'debug-step' }>): void {
        if (event.phase === 'start') {
            this.paused = true;
            void this.setExecutionContext(true, true);
            this.updateStatusItems();
            this.renderCurrentLine(event.line);
            this.output.appendLine(`暂停于第 ${event.line || '?'} 行: ${event.description || event.nodeType || 'DSL 步骤'}`);
            return;
        }
        if (event.phase === 'finish') {
            this.output.appendLine(
                `第 ${event.line || '?'} 行 ${event.status === 'failed' ? '失败' : '完成'}${event.error ? `: ${event.error}` : ''}`
            );
        }
    }

    private renderCurrentLine(line: number | null): void {
        if (!this.activeDocumentUri) {
            return;
        }
        const editor = vscode.window.visibleTextEditors.find(
            (item) => item.document.uri.toString() === this.activeDocumentUri?.toString()
        );
        if (!editor) {
            return;
        }
        if (!line || line < 1 || line > editor.document.lineCount) {
            editor.setDecorations(this.currentLineDecoration, []);
            return;
        }
        const range = editor.document.lineAt(line - 1).range;
        editor.setDecorations(this.currentLineDecoration, [range]);
        editor.revealRange(range, vscode.TextEditorRevealType.InCenterIfOutsideViewport);
    }

    private clearCurrentLine(): void {
        vscode.window.visibleTextEditors.forEach((editor) => {
            editor.setDecorations(this.currentLineDecoration, []);
        });
    }

    private async finishExecution(): Promise<void> {
        this.paused = false;
        this.activeDocumentUri = null;
        this.clearCurrentLine();
        await this.setExecutionContext(false, false);
        this.updateStatusItems();
    }

    private async setExecutionContext(running: boolean, paused: boolean): Promise<void> {
        await Promise.all([
            vscode.commands.executeCommand('setContext', 'pytest-dsl.executionRunning', running),
            vscode.commands.executeCommand('setContext', 'pytest-dsl.debugPaused', paused)
        ]);
    }

    private updateStatusItems(): void {
        if (!this.service.isRunning) {
            this.nextItem.hide();
            this.continueItem.hide();
            this.stopItem.hide();
            return;
        }
        this.stopItem.show();
        if (this.paused) {
            this.nextItem.show();
            this.continueItem.show();
        } else {
            this.nextItem.hide();
            this.continueItem.hide();
        }
    }
}

export class DslExecutionCodeLensProvider implements vscode.CodeLensProvider {
    provideCodeLenses(document: vscode.TextDocument): vscode.CodeLens[] {
        const config = vscode.workspace.getConfiguration('pytest-dsl', document.uri);
        if (!config.get<boolean>('enableExecutionCodeLens', true) || !RUNNABLE_EXTENSIONS.has(path.extname(document.fileName).toLowerCase())) {
            return [];
        }
        const firstLine = document.lineAt(0).range;
        const lenses = [
            new vscode.CodeLens(firstLine, {
                command: 'pytest-dsl.runFile',
                title: '$(run) 运行当前文件'
            }),
            new vscode.CodeLens(firstLine, {
                command: 'pytest-dsl.debugFile',
                title: '$(debug-alt) 调试当前文件'
            })
        ];
        for (let line = 0; line < document.lineCount; line++) {
            const text = document.lineAt(line).text;
            if (!isExecutableDslLine(text)) {
                continue;
            }
            lenses.push(new vscode.CodeLens(document.lineAt(line).range, {
                command: 'pytest-dsl.debugFromCursor',
                title: '$(debug-start) 从此处调试',
                arguments: [line]
            }));
        }
        return lenses;
    }
}

export function isExecutableDslLine(text: string): boolean {
    const trimmed = text.trim();
    if (!trimmed || trimmed.startsWith('#') || trimmed === 'end' || trimmed === 'else') {
        return false;
    }
    return /(?:^|=\s*)(?:[\w.-]+\|)?\[[^\]]+\]/u.test(trimmed) ||
        /^(?:if|for|while|retry|return|break|continue)\b/i.test(trimmed);
}
