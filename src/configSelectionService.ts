import * as fs from 'fs';
import * as path from 'path';

const IGNORED_CONFIG_DIRS = new Set([
    '.git',
    '.pytest-dsl-gui',
    '.pytest-dsl-generated',
    '.venv',
    'venv',
    '__pycache__',
    'node_modules',
    'dist',
    'build',
    '.pytest_cache'
]);

export interface ConfigFile {
    absolutePath: string;
    relativePath: string;
    defaultConfig: boolean;
}

export interface ConfigProfiles {
    [name: string]: string[];
}

export type StoredConfigSelection =
    | { kind: 'auto' }
    | { kind: 'files'; paths: string[] }
    | { kind: 'profile'; name: string };

export interface ResolvedConfigSelection {
    kind: 'auto' | 'files' | 'profile' | 'settings';
    label: string;
    paths: string[];
    missingPaths: string[];
    profileName?: string;
}

export function discoverConfigFiles(projectRoot: string): ConfigFile[] {
    const root = path.resolve(projectRoot);
    const configDir = path.join(root, 'config');
    const files: ConfigFile[] = [];
    walkConfigDirectory(root, configDir, files);
    return files.sort((left, right) => {
        if (left.defaultConfig !== right.defaultConfig) {
            return left.defaultConfig ? -1 : 1;
        }
        return left.relativePath.localeCompare(right.relativePath);
    });
}

export function normalizeConfigProfiles(value: unknown): ConfigProfiles {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        return {};
    }
    const profiles: ConfigProfiles = {};
    Object.entries(value as Record<string, unknown>).forEach(([name, paths]) => {
        const normalizedName = name.trim();
        if (!normalizedName || !Array.isArray(paths)) {
            return;
        }
        profiles[normalizedName] = normalizeConfigPaths(paths);
    });
    return profiles;
}

export function resolveConfigSelection(
    projectRoot: string,
    stored: StoredConfigSelection | undefined,
    profiles: ConfigProfiles,
    activeProfile: string,
    legacyYamlVars: string[]
): ResolvedConfigSelection {
    const fallback = (): StoredConfigSelection => {
        if (activeProfile && profiles[activeProfile]) {
            return { kind: 'profile', name: activeProfile };
        }
        const paths = normalizeConfigPaths(legacyYamlVars);
        return paths.length > 0 ? { kind: 'files', paths } : { kind: 'auto' };
    };
    const selection = stored || fallback();
    if (selection.kind === 'profile') {
        const paths = profiles[selection.name];
        if (!paths) {
            return resolvedSelection(projectRoot, 'auto', '自动', []);
        }
        return resolvedSelection(projectRoot, 'profile', selection.name, paths, selection.name);
    }
    if (selection.kind === 'files') {
        const paths = normalizeConfigPaths(selection.paths);
        const kind = stored ? 'files' : 'settings';
        return resolvedSelection(projectRoot, kind, configSelectionLabel(paths), paths);
    }
    return resolvedSelection(projectRoot, 'auto', '自动', []);
}

export function configSelectionLabel(paths: string[]): string {
    if (paths.length === 0) {
        return '自动';
    }
    const first = path.basename(paths[0]);
    return paths.length === 1 ? first : `${first} +${paths.length - 1}`;
}

export function defaultConfigPaths(files: ConfigFile[]): string[] {
    return files.filter((file) => file.defaultConfig).map((file) => file.relativePath);
}

export function normalizeConfigPaths(value: unknown[]): string[] {
    const seen = new Set<string>();
    const paths: string[] = [];
    value.forEach((item) => {
        if (typeof item !== 'string') {
            return;
        }
        const normalized = item.trim().replace(/\\/g, '/').replace(/^\.\//, '');
        if (!normalized || seen.has(normalized)) {
            return;
        }
        seen.add(normalized);
        paths.push(normalized);
    });
    return paths;
}

function walkConfigDirectory(projectRoot: string, directory: string, files: ConfigFile[]): void {
    if (!fs.existsSync(directory) || !fs.statSync(directory).isDirectory()) {
        return;
    }
    const entries = fs.readdirSync(directory, { withFileTypes: true })
        .sort((left, right) => left.name.localeCompare(right.name));
    entries.forEach((entry) => {
        const fullPath = path.join(directory, entry.name);
        if (entry.isDirectory()) {
            if (!entry.name.startsWith('.') && !IGNORED_CONFIG_DIRS.has(entry.name)) {
                walkConfigDirectory(projectRoot, fullPath, files);
            }
            return;
        }
        if (!entry.isFile() || !/\.ya?ml$/i.test(entry.name)) {
            return;
        }
        const relativePath = path.relative(projectRoot, fullPath).replace(/\\/g, '/');
        const parts = relativePath.split('/');
        files.push({
            absolutePath: fullPath,
            relativePath,
            defaultConfig: parts.length === 2 && parts[0] === 'config'
        });
    });
}

function resolvedSelection(
    projectRoot: string,
    kind: ResolvedConfigSelection['kind'],
    label: string,
    paths: string[],
    profileName?: string
): ResolvedConfigSelection {
    const missingPaths = paths.filter((item) => {
        const target = path.isAbsolute(item) ? item : path.resolve(projectRoot, item);
        return !fs.existsSync(target) || !fs.statSync(target).isFile();
    });
    return { kind, label, paths, missingPaths, profileName };
}
