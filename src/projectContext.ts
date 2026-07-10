import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';

export function resolveProjectRoot(document: vscode.TextDocument): string {
    const config = vscode.workspace.getConfiguration('pytest-dsl', document.uri);
    const configuredRoot = config.get<string>('projectRoot', '').trim();
    if (configuredRoot) {
        const resolved = path.isAbsolute(configuredRoot)
            ? configuredRoot
            : path.resolve(vscode.workspace.getWorkspaceFolder(document.uri)?.uri.fsPath || process.cwd(), configuredRoot);
        if (!fs.existsSync(resolved) || !fs.statSync(resolved).isDirectory()) {
            throw new Error(`配置的 pytest-dsl.projectRoot 不存在: ${resolved}`);
        }
        return resolved;
    }
    return vscode.workspace.getWorkspaceFolder(document.uri)?.uri.fsPath || path.dirname(document.fileName);
}
