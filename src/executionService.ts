import { ChildProcessWithoutNullStreams, execFile, spawn } from 'child_process';
import * as path from 'path';
import {
    PythonTarget,
    describePythonTarget,
    resolvePythonTargets,
    withPythonProcessEnv
} from './pythonRuntimeResolver';

const STRUCTURED_EVENT_PREFIX = '__PYTEST_DSL_GUI_EVENT__';

export type ExecutionMode = 'run' | 'debug';
export type DebugCommand = 'next' | 'continue' | 'stop';

export interface ExecutionRequest {
    mode: ExecutionMode;
    projectRoot: string;
    filePath: string;
    configuredPython?: string;
    yamlVars?: string[];
    pauseFromLine?: number;
    env?: NodeJS.ProcessEnv;
}

export type ExecutionEvent =
    | { type: 'started'; mode: ExecutionMode; command: string; target: PythonTarget }
    | { type: 'stdout' | 'stderr'; text: string }
    | {
        type: 'debug-step';
        phase: string;
        line: number | null;
        nodeType: string | null;
        description: string;
        status: string | null;
        error: string | null;
    }
    | { type: 'completed'; mode: ExecutionMode; status: 'passed' | 'failed' | 'stopped'; exitCode: number | null };

export interface ExecutionResult {
    mode: ExecutionMode;
    status: 'passed' | 'failed' | 'stopped';
    exitCode: number | null;
}

export class DslExecutionService {
    private child: ChildProcessWithoutNullStreams | null = null;
    private stopped = false;
    private stdoutBuffer = '';

    constructor(private readonly onEvent: (event: ExecutionEvent) => void) {}

    get isRunning(): boolean {
        return this.child !== null;
    }

    async start(request: ExecutionRequest): Promise<ExecutionResult> {
        if (this.child) {
            throw new Error('已有 pytest-DSL 任务正在运行');
        }

        const projectRoot = path.resolve(request.projectRoot);
        const target = await resolveUsablePythonTarget(projectRoot, request.configuredPython, request.env);
        const relativePath = projectRelativePath(projectRoot, request.filePath);
        const args = buildExecutionArgs(request, relativePath);
        const env = withPythonProcessEnv({
            ...process.env,
            ...request.env,
            PYTEST_DSL_KEYWORD_TRACE: request.env && Object.prototype.hasOwnProperty.call(request.env, 'PYTEST_DSL_KEYWORD_TRACE')
                ? request.env.PYTEST_DSL_KEYWORD_TRACE
                : '1'
        });

        this.stopped = false;
        this.stdoutBuffer = '';
        const child = spawn(target.command, [...target.args, ...args], {
            cwd: projectRoot,
            env,
            windowsHide: true
        });
        this.child = child;
        this.onEvent({
            type: 'started',
            mode: request.mode,
            command: formatCommand(target, args),
            target
        });

        child.stdout.on('data', (chunk: Buffer | string) => this.handleStdout(String(chunk)));
        child.stderr.on('data', (chunk: Buffer | string) => {
            this.onEvent({ type: 'stderr', text: String(chunk) });
        });

        return new Promise<ExecutionResult>((resolve, reject) => {
            let spawnError: Error | null = null;
            child.on('error', (error) => {
                spawnError = error;
                this.onEvent({ type: 'stderr', text: `${error.message}\n` });
            });
            child.on('close', (exitCode) => {
                this.flushStdout();
                if (this.child === child) {
                    this.child = null;
                }
                if (spawnError && exitCode === null) {
                    reject(spawnError);
                    return;
                }
                const result: ExecutionResult = {
                    mode: request.mode,
                    status: this.stopped ? 'stopped' : exitCode === 0 ? 'passed' : 'failed',
                    exitCode
                };
                this.onEvent({ type: 'completed', ...result });
                resolve(result);
            });
        });
    }

    sendDebugCommand(command: DebugCommand): boolean {
        const child = this.child;
        if (!child || !child.stdin.writable) {
            return false;
        }
        child.stdin.write(`${command}\n`);
        return true;
    }

    stop(): boolean {
        const child = this.child;
        if (!child) {
            return false;
        }
        this.stopped = true;
        if (child.stdin.writable) {
            child.stdin.write('stop\n');
        }
        child.kill('SIGTERM');
        const timer = setTimeout(() => {
            if (this.child === child) {
                child.kill('SIGKILL');
            }
        }, 1500);
        timer.unref?.();
        return true;
    }

    dispose(): void {
        this.stop();
    }

    private handleStdout(text: string): void {
        this.stdoutBuffer += text;
        const lines = this.stdoutBuffer.split(/\r?\n/);
        this.stdoutBuffer = lines.pop() || '';
        lines.forEach((line) => this.handleStdoutLine(line));
    }

    private flushStdout(): void {
        if (!this.stdoutBuffer) {
            return;
        }
        const line = this.stdoutBuffer;
        this.stdoutBuffer = '';
        this.handleStdoutLine(line);
    }

    private handleStdoutLine(line: string): void {
        if (!line.startsWith(STRUCTURED_EVENT_PREFIX)) {
            this.onEvent({ type: 'stdout', text: `${line}\n` });
            return;
        }
        try {
            const payload = JSON.parse(line.slice(STRUCTURED_EVENT_PREFIX.length));
            if (payload.type === 'debug_step') {
                this.onEvent({
                    type: 'debug-step',
                    phase: payload.phase || 'start',
                    line: Number(payload.line) || null,
                    nodeType: payload.nodeType || null,
                    description: payload.description || '',
                    status: payload.status || null,
                    error: payload.error || null
                });
                return;
            }
        } catch {
            // Preserve unknown or malformed protocol output for diagnostics.
        }
        this.onEvent({ type: 'stdout', text: `${line}\n` });
    }
}

export function buildExecutionArgs(request: ExecutionRequest, relativePath: string): string[] {
    const yamlArgs = (request.yamlVars || []).flatMap((item) => ['--yaml-vars', normalizeProjectArgument(request.projectRoot, item)]);
    if (request.mode === 'debug') {
        const pauseArgs = request.pauseFromLine && request.pauseFromLine > 1
            ? ['--pause-from-line', String(Math.trunc(request.pauseFromLine))]
            : [];
        return [
            '-m',
            'pytest_dsl.workbench.runner',
            'debug',
            relativePath,
            ...pauseArgs,
            ...yamlArgs
        ];
    }
    return ['-m', 'pytest_dsl.cli', relativePath, ...yamlArgs];
}

export function projectRelativePath(projectRoot: string, filePath: string): string {
    const relativePath = path.relative(path.resolve(projectRoot), path.resolve(filePath));
    if (!relativePath || relativePath.startsWith('..') || path.isAbsolute(relativePath)) {
        throw new Error(`当前文件不在 pytest-DSL 项目目录内: ${filePath}`);
    }
    return relativePath.split(path.sep).join('/');
}

export async function resolveUsablePythonTarget(
    projectRoot: string,
    configuredPython = '',
    env: NodeJS.ProcessEnv = process.env
): Promise<PythonTarget> {
    const targets = resolvePythonTargets(projectRoot, { configuredPython, env });
    const errors: string[] = [];
    for (const target of targets) {
        try {
            await probePythonTarget(target, projectRoot, env);
            return target;
        } catch (error) {
            errors.push(`${describePythonTarget(target)}: ${error instanceof Error ? error.message : String(error)}`);
            if (target.required) {
                break;
            }
        }
    }
    throw new Error(
        `未找到安装了 pytest-dsl workbench 的 Python 解释器。\n${errors.map((item) => `- ${item}`).join('\n')}`
    );
}

function probePythonTarget(target: PythonTarget, cwd: string, env: NodeJS.ProcessEnv): Promise<void> {
    return new Promise((resolve, reject) => {
        execFile(
            target.command,
            [...target.args, '-c', 'import pytest_dsl; import pytest_dsl.workbench.runner'],
            { cwd, env: withPythonProcessEnv(env), timeout: 10000 },
            (error, stdout, stderr) => {
                if (error) {
                    reject(new Error(String(stderr || stdout || error.message).trim()));
                    return;
                }
                resolve();
            }
        );
    });
}

function normalizeProjectArgument(projectRoot: string, item: string): string {
    const value = String(item || '').trim();
    if (!value || !path.isAbsolute(value)) {
        return value.split(path.sep).join('/');
    }
    const relative = path.relative(projectRoot, value);
    return relative.startsWith('..') ? value : relative.split(path.sep).join('/');
}

function formatCommand(target: PythonTarget, args: string[]): string {
    return [target.command, ...target.args, ...args]
        .map((item) => /\s/.test(item) ? JSON.stringify(item) : item)
        .join(' ');
}
