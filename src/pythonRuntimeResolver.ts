import * as fs from 'fs';
import * as path from 'path';

export type PythonTargetSource = 'configuration' | 'project-venv' | 'environment' | 'path';

export interface PythonTarget {
    command: string;
    args: string[];
    source: PythonTargetSource;
    required: boolean;
}

export interface PythonRuntimeOptions {
    configuredPython?: string;
    env?: NodeJS.ProcessEnv | { [key: string]: string | undefined };
    platform?: NodeJS.Platform | string;
}

export function resolvePythonTargets(projectRoot: string, options: PythonRuntimeOptions = {}): PythonTarget[] {
    const env = options.env || process.env;
    const platform = options.platform || process.platform;
    const configured = parsePythonCommand(options.configuredPython || '');

    if (configured) {
        return [{
            ...configured,
            source: 'configuration',
            required: true
        }];
    }

    const targets: PythonTarget[] = [];
    findProjectVenvPythons(projectRoot, platform).forEach((command) => {
        addTarget(targets, command, [], 'project-venv');
    });
    addTarget(targets, env.PYTEST_DSL_PYTHON, [], 'environment');
    addTarget(targets, env.PYTHON, [], 'environment');

    if (platform === 'win32') {
        addTarget(targets, 'python', [], 'path');
        addTarget(targets, 'py', ['-3'], 'path');
    } else {
        addTarget(targets, 'python3', [], 'path');
        addTarget(targets, 'python', [], 'path');
    }

    return dedupeTargets(targets);
}

export function withPythonProcessEnv(env: NodeJS.ProcessEnv | { [key: string]: string | undefined } = process.env): NodeJS.ProcessEnv {
    return {
        ...env,
        PYTHONUNBUFFERED: '1',
        PYTHONIOENCODING: 'utf-8',
        PYTHONUTF8: '1'
    } as NodeJS.ProcessEnv;
}

export function findProjectVenvPythons(projectRoot: string, platform: NodeJS.Platform | string = process.platform): string[] {
    if (!projectRoot) {
        return [];
    }

    const root = path.resolve(projectRoot);
    const candidates = platform === 'win32'
        ? [
            path.join(root, '.venv', 'Scripts', 'python.exe'),
            path.join(root, 'venv', 'Scripts', 'python.exe')
        ]
        : [
            path.join(root, '.venv', 'bin', 'python'),
            path.join(root, 'venv', 'bin', 'python')
        ];

    return candidates.filter((candidate) => isExecutableFile(candidate, platform));
}

export function describePythonTarget(target: PythonTarget): string {
    const args = target.args.length > 0 ? ` ${target.args.join(' ')}` : '';
    return `${target.command}${args} (${target.source})`;
}

function addTarget(
    targets: PythonTarget[],
    command: string | undefined,
    args: string[],
    source: PythonTargetSource
): void {
    const parsed = parsePythonCommand(command || '');
    if (!parsed) {
        return;
    }
    targets.push({
        command: parsed.command,
        args: [...parsed.args, ...args],
        source,
        required: false
    });
}

function parsePythonCommand(commandLine: string): { command: string; args: string[] } | null {
    const trimmed = String(commandLine || '').trim();
    if (!trimmed) {
        return null;
    }
    const parts = trimmed.split(/\s+/);
    const command = parts.shift();
    return command ? { command, args: parts } : null;
}

function isExecutableFile(filePath: string, platform: NodeJS.Platform | string): boolean {
    try {
        const stat = fs.statSync(filePath);
        if (!stat.isFile()) {
            return false;
        }
        if (platform === 'win32') {
            return true;
        }
        fs.accessSync(filePath, fs.constants.X_OK);
        return true;
    } catch {
        return false;
    }
}

function dedupeTargets(targets: PythonTarget[]): PythonTarget[] {
    const seen = new Set<string>();
    return targets.filter((target) => {
        const key = `${target.command}\0${target.args.join('\0')}`;
        if (seen.has(key)) {
            return false;
        }
        seen.add(key);
        return true;
    });
}
