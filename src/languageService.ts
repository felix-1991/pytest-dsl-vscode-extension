export interface KeywordParameterLike {
    name?: string;
    mapping?: string;
    description?: string;
    default?: any;
}

export interface NormalizedKeywordParameter extends KeywordParameterLike {
    name: string;
    mapping: string;
    description: string;
}

export interface KeywordLike {
    name?: string;
    category?: string;
    documentation?: string;
    parameters?: KeywordParameterLike[];
    source?: string;
    source_info?: {
        display_name?: string;
        module?: string;
    };
}

export interface SourceDefinition {
    name: string;
    path: string;
    line: number;
    column: number;
    kind: 'resource' | 'dsl-variable' | 'yaml-variable' | 'python';
    parameters?: KeywordParameterLike[];
    valuePreview?: string;
    sourceLabel?: string;
    effective?: boolean;
}

export interface CompletionContext {
    kind: 'keyword' | 'parameter' | 'variable' | 'metadata' | 'none';
    from: number;
    to: number;
    prefix: string;
    inBracket?: boolean;
    replaceNextBracket?: boolean;
    keywordName?: string;
    usedParameterNames?: string[];
}

export interface MetadataCompletionTemplate {
    label: string;
    snippet: string;
    detail: string;
}

export interface DslDiagnostic {
    code: string;
    message: string;
    range: {
        start: { line: number; character: number };
        end: { line: number; character: number };
    };
    severity: 'error' | 'warning' | 'information';
}

export interface SymbolAtOffset {
    name: string;
    start: number;
    end: number;
}

const IDENTIFIER_PATTERN = '[\\p{L}\\p{N}_-]';
const IDENTIFIER_REGEX = /[\p{L}\p{N}_-]/u;
const KEYWORD_CALL_REGEX = /(?:([\p{L}\p{N}_-]+)\|)?\[([^\]\n]+)\]/gu;

export const METADATA_COMPLETION_TEMPLATES: MetadataCompletionTemplate[] = [
    { label: '@name', snippet: '@name: "${1:名称}"', detail: '测试或资源名称' },
    { label: '@description', snippet: '@description: "${1:描述}"', detail: '说明当前文件用途' },
    { label: '@tags', snippet: '@tags: [${1:标签}]', detail: '测试标签' },
    { label: '@author', snippet: '@author: "${1:作者}"', detail: '作者' },
    { label: '@date', snippet: '@date: "${1:日期}"', detail: '日期' },
    { label: '@import', snippet: '@import: "${1:path}.resource"', detail: '导入 Resource 文件' },
    { label: '@remote', snippet: '@remote: "http://${1:host}:${2:port}/" as ${3:alias}', detail: '远程关键字服务' },
    { label: '@data', snippet: '@data: "${1:file}.csv" using csv', detail: '数据驱动文件' }
];

export function isDslLikeFile(fileName: string): boolean {
    const normalized = fileName.toLowerCase();
    return normalized.endsWith('.dsl') || normalized.endsWith('.auto') || normalized.endsWith('.resource');
}

export function getCompletionContext(lineText: string, cursorPosition: number, explicit = false): CompletionContext {
    const cursor = clamp(cursorPosition, 0, lineText.length);
    const prefix = lineText.slice(0, cursor);
    const nextChar = lineText.slice(cursor, cursor + 1);

    const variableMatch = prefix.match(new RegExp(`\\$\\{(${IDENTIFIER_PATTERN}*(?:\\.${IDENTIFIER_PATTERN}*)*)$`, 'u'));
    if (variableMatch) {
        const typed = variableMatch[1];
        return {
            kind: 'variable',
            from: cursor - typed.length,
            to: cursor,
            prefix: typed
        };
    }

    const metadataMatch = prefix.match(/^(\s*)(@[\w-]*)$/);
    if (metadataMatch) {
        return {
            kind: 'metadata',
            from: metadataMatch[1].length,
            to: cursor,
            prefix: metadataMatch[2]
        };
    }

    const parameterMatch = getParameterCompletionContext(prefix, explicit);
    if (parameterMatch) {
        return parameterMatch;
    }

    const keywordMatch = getKeywordCompletionContext(prefix, nextChar);
    if (keywordMatch) {
        return keywordMatch;
    }

    if (explicit) {
        return {
            kind: 'keyword',
            from: cursor,
            to: cursor,
            prefix: '',
            inBracket: false,
            replaceNextBracket: false
        };
    }

    return {
        kind: 'none',
        from: cursor,
        to: cursor,
        prefix: ''
    };
}

export function buildKeywordSnippet(keyword: KeywordLike, options: { inBracket?: boolean } = {}): string {
    const name = escapeSnippetText(keyword.name || '');
    const prefix = options.inBracket ? '' : '[';
    const parameters = normalizeKeywordParameters(keyword.parameters).slice(0, 8);
    const parameterText = parameters.length > 0
        ? `, ${parameters.map((param, index) => `${escapeSnippetText(param.name)}: \${${index + 1}:${escapeSnippetPlaceholder(defaultPlaceholder(param))}}`).join(', ')}`
        : '';

    return `${prefix}${name}]${parameterText}`;
}

export function buildParameterSnippet(parameter: KeywordParameterLike): string {
    const name = normalizedParameterName(parameter);
    return `${escapeSnippetText(name)}: \${1:${escapeSnippetPlaceholder(defaultPlaceholder(parameter))}}`;
}

export function createParameterCompletionCandidates(
    keyword: KeywordLike,
    usedParameterNames: Iterable<string> | undefined
): KeywordParameterLike[] {
    const used = new Set(Array.from(usedParameterNames || []));
    return normalizeKeywordParameters(keyword.parameters)
        .filter((param) => !used.has(param.name));
}

export function createVariableCompletionCandidates(definitions: SourceDefinition[]): SourceDefinition[] {
    const byName = new Map<string, SourceDefinition>();
    definitions
        .filter((definition) => definition && definition.name)
        .forEach((definition) => {
            const existing = byName.get(definition.name);
            if (!existing || definition.effective || existing.kind === 'dsl-variable') {
                byName.set(definition.name, definition);
            }
        });

    return Array.from(byName.values())
        .sort((left, right) => left.name.localeCompare(right.name, 'zh-CN'))
        .slice(0, 300);
}

export function uniqueKeywordsByName(keywords: KeywordLike[]): KeywordLike[] {
    const seen = new Set<string>();
    const result: KeywordLike[] = [];
    (Array.isArray(keywords) ? keywords : []).forEach((keyword) => {
        const name = String(keyword && keyword.name ? keyword.name : '').trim();
        if (!name || seen.has(name)) {
            return;
        }
        seen.add(name);
        result.push({
            ...keyword,
            name,
            parameters: normalizeKeywordParameters(keyword.parameters)
        });
    });
    return result;
}

export function normalizeKeywordParameters(parameters: KeywordParameterLike[] | undefined): NormalizedKeywordParameter[] {
    const seen = new Set<string>();
    const result: NormalizedKeywordParameter[] = [];
    (Array.isArray(parameters) ? parameters : []).forEach((parameter) => {
        const name = normalizedParameterName(parameter);
        if (!name || seen.has(name)) {
            return;
        }
        seen.add(name);
        result.push({
            ...parameter,
            name,
            mapping: String(parameter && parameter.mapping ? parameter.mapping : name),
            description: String(parameter && parameter.description ? parameter.description : '')
        });
    });
    return result;
}

export function parseResourceDefinitions(content: string, filePath: string): SourceDefinition[] {
    const definitions: SourceDefinition[] = [];
    splitLines(content).forEach((lineText, index) => {
        const match = lineText.match(/^\s*function\s+(.+?)\s*\((.*?)\)\s+do\s*$/u);
        if (!match) {
            return;
        }
        const name = match[1].trim();
        if (!name) {
            return;
        }
        definitions.push({
            name,
            path: filePath,
            line: index + 1,
            column: Math.max(1, lineText.indexOf('function') + 1),
            kind: 'resource',
            parameters: parseResourceParameters(match[2])
        });
    });
    return definitions;
}

export function parseDslVariableDefinitions(content: string, filePath: string): SourceDefinition[] {
    const definitions: SourceDefinition[] = [];
    splitLines(content).forEach((lineText, index) => {
        if (/^\s*(#|@)/.test(lineText)) {
            return;
        }
        const match = lineText.match(new RegExp(`^\\s*(${IDENTIFIER_PATTERN}+(?:\\.${IDENTIFIER_PATTERN}+)*)\\s*=\\s*(.+)$`, 'u'));
        if (!match) {
            return;
        }
        const name = match[1].trim();
        if (!name || name.includes('|')) {
            return;
        }
        definitions.push({
            name,
            path: filePath,
            line: index + 1,
            column: Math.max(1, lineText.indexOf(name) + 1),
            kind: 'dsl-variable',
            valuePreview: trimPreview(match[2])
        });
    });
    return definitions;
}

export function parseYamlVariableDefinitions(content: string, filePath: string): SourceDefinition[] {
    const definitions: SourceDefinition[] = [];
    const stack: Array<{ indent: number; key: string }> = [];

    splitLines(content).forEach((lineText, index) => {
        if (!lineText.trim() || /^\s*#/.test(lineText)) {
            return;
        }
        const match = lineText.match(/^(\s*)([\p{L}\p{N}_-]+)\s*:\s*(.*?)\s*$/u);
        if (!match) {
            return;
        }

        const indent = match[1].replace(/\t/g, '    ').length;
        const key = match[2];
        const value = match[3] || '';

        while (stack.length > 0 && stack[stack.length - 1].indent >= indent) {
            stack.pop();
        }

        const name = [...stack.map((entry) => entry.key), key].join('.');
        definitions.push({
            name,
            path: filePath,
            line: index + 1,
            column: Math.max(1, lineText.indexOf(key) + 1),
            kind: 'yaml-variable',
            valuePreview: trimPreview(value),
            sourceLabel: `${filePath}:${index + 1}`
        });
        stack.push({ indent, key });
    });

    markEffectiveDefinitions(definitions);
    return definitions;
}

export function markEffectiveVariableDefinitions(definitions: SourceDefinition[]): SourceDefinition[] {
    markEffectiveDefinitions(definitions);
    return definitions;
}

export function selectEffectiveVariableDefinition(
    definitions: SourceDefinition[]
): SourceDefinition | undefined {
    const dslDefinitions = definitions.filter((definition) => definition.kind === 'dsl-variable');
    if (dslDefinitions.length > 0) {
        return dslDefinitions[dslDefinitions.length - 1];
    }

    const effectiveDefinitions = definitions.filter((definition) => definition.effective);
    if (effectiveDefinitions.length > 0) {
        return effectiveDefinitions[effectiveDefinitions.length - 1];
    }
    return definitions[definitions.length - 1];
}

export function findKeywordAtOffset(text: string, offset: number): SymbolAtOffset | null {
    KEYWORD_CALL_REGEX.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = KEYWORD_CALL_REGEX.exec(text)) !== null) {
        const start = match.index;
        const end = start + match[0].length;
        if (offset < start || offset > end) {
            continue;
        }
        const keywordStart = start + match[0].indexOf('[') + 1;
        const keywordEnd = keywordStart + match[2].length;
        const name = match[2].trim();
        if (!shouldTreatAsKeywordName(name)) {
            continue;
        }
        return {
            name,
            start: keywordStart,
            end: keywordEnd
        };
    }
    return null;
}

export function findVariableAtOffset(text: string, offset: number): SymbolAtOffset | null {
    const pattern = /\$\{([\p{L}\p{N}_.-]+)\}/gu;
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(text)) !== null) {
        const start = match.index;
        const end = start + match[0].length;
        if (offset < start || offset > end) {
            continue;
        }
        return {
            name: match[1].trim(),
            start: start + 2,
            end: end - 1
        };
    }
    return null;
}

export function collectDslDiagnostics(
    content: string,
    keywords: KeywordLike[],
    resourceDefinitions: SourceDefinition[] = []
): DslDiagnostic[] {
    const diagnostics: DslDiagnostic[] = [];
    const keywordMap = new Map<string, KeywordLike>();
    uniqueKeywordsByName([
        ...keywords,
        ...resourceDefinitions.map((definition) => ({
            name: definition.name,
            parameters: definition.parameters || [],
            category: 'custom'
        }))
    ]).forEach((keyword) => {
        if (keyword.name) {
            keywordMap.set(keyword.name, keyword);
        }
    });

    splitLines(content).forEach((lineText, lineIndex) => {
        const variableStart = unclosedVariableStart(lineText);
        if (variableStart >= 0) {
            diagnostics.push(createDiagnostic(
                'unclosed-variable',
                '变量引用缺少结束的 }',
                lineIndex,
                variableStart,
                lineText.length,
                'error'
            ));
        }

        KEYWORD_CALL_REGEX.lastIndex = 0;
        let match: RegExpExecArray | null;
        while ((match = KEYWORD_CALL_REGEX.exec(lineText)) !== null) {
            const keywordName = match[2].trim();
            if (!shouldTreatAsKeywordName(keywordName)) {
                continue;
            }

            const nameStart = match.index + match[0].indexOf('[') + 1;
            const keyword = keywordMap.get(keywordName);
            if (!keyword) {
                diagnostics.push(createDiagnostic(
                    'unknown-keyword',
                    `未识别的 pytest-dsl 关键字: ${keywordName}`,
                    lineIndex,
                    nameStart,
                    nameStart + keywordName.length,
                    'warning'
                ));
                continue;
            }

            const tail = lineText.slice(match.index + match[0].length);
            const occurrences = parseParameterOccurrences(tail, match.index + match[0].length);
            const used = new Set<string>();
            occurrences.forEach((occurrence) => {
                if (used.has(occurrence.name)) {
                    diagnostics.push(createDiagnostic(
                        'duplicate-parameter',
                        `参数重复: ${occurrence.name}`,
                        lineIndex,
                        occurrence.start,
                        occurrence.end,
                        'warning'
                    ));
                }
                used.add(occurrence.name);
            });

            normalizeKeywordParameters(keyword.parameters)
                .filter((parameter) => parameter.default === undefined && !used.has(parameter.name))
                .forEach((parameter) => {
                    diagnostics.push(createDiagnostic(
                        'missing-parameter',
                        `关键字 ${keywordName} 缺少参数: ${parameter.name}`,
                        lineIndex,
                        nameStart,
                        nameStart + keywordName.length,
                        'information'
                    ));
                });
        }
    });

    return diagnostics;
}

function getKeywordCompletionContext(prefix: string, nextChar: string): CompletionContext | null {
    const bracketMatch = prefix.match(/\[([^\]\n]*)$/);
    if (bracketMatch) {
        const typed = bracketMatch[1];
        return {
            kind: 'keyword',
            from: prefix.length - typed.length,
            to: prefix.length,
            prefix: typed,
            inBracket: true,
            replaceNextBracket: nextChar === ']'
        };
    }

    const barePattern = new RegExp(`(?:^|[\\s=,|])(${IDENTIFIER_PATTERN}{1,48})$`, 'u');
    const bareMatch = prefix.match(barePattern);
    if (!bareMatch) {
        return null;
    }

    const typed = bareMatch[1];
    return {
        kind: 'keyword',
        from: prefix.length - typed.length,
        to: prefix.length,
        prefix: typed,
        inBracket: false,
        replaceNextBracket: false
    };
}

function getParameterCompletionContext(prefix: string, explicit: boolean): CompletionContext | null {
    const call = lastClosedKeywordCall(prefix);
    if (!call) {
        return null;
    }

    const tail = prefix.slice(call.closeIndex + 1);
    const hasParameterSeparator = /^\s*,/.test(tail);
    if (!hasParameterSeparator && !explicit) {
        return null;
    }

    const lastComma = tail.lastIndexOf(',');
    const segmentStart = lastComma >= 0 ? lastComma + 1 : 0;
    const segment = tail.slice(segmentStart);
    const tokenMatch = segment.match(new RegExp(`^(\\s*)(${IDENTIFIER_PATTERN}*)$`, 'u'));
    if (!tokenMatch) {
        return null;
    }

    const from = call.closeIndex + 1 + segmentStart + tokenMatch[1].length;
    return {
        kind: 'parameter',
        from,
        to: prefix.length,
        prefix: tokenMatch[2],
        keywordName: call.keywordName,
        usedParameterNames: usedParameterNames(tail)
    };
}

function lastClosedKeywordCall(prefix: string): { keywordName: string; closeIndex: number } | null {
    const closeIndex = prefix.lastIndexOf(']');
    if (closeIndex < 0) {
        return null;
    }
    const openIndex = prefix.lastIndexOf('[', closeIndex);
    if (openIndex < 0) {
        return null;
    }
    const keywordName = prefix.slice(openIndex + 1, closeIndex).trim();
    return keywordName ? { keywordName, closeIndex } : null;
}

function usedParameterNames(text: string): string[] {
    return parseParameterOccurrences(text, 0).map((occurrence) => occurrence.name);
}

function parseParameterOccurrences(text: string, offset: number): Array<{ name: string; start: number; end: number }> {
    const result: Array<{ name: string; start: number; end: number }> = [];
    const pattern = new RegExp(`(?:^|,)\\s*(${IDENTIFIER_PATTERN}+)\\s*[:=]`, 'gu');
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(text)) !== null) {
        const name = match[1];
        const localStart = match.index + match[0].indexOf(name);
        result.push({
            name,
            start: offset + localStart,
            end: offset + localStart + name.length
        });
    }
    return result;
}

function parseResourceParameters(rawParameters: string): KeywordParameterLike[] {
    return splitCsvLike(rawParameters)
        .map((item) => item.trim())
        .filter(Boolean)
        .map((item) => {
            const [namePart, defaultPart] = item.split('=', 2);
            const name = namePart.trim();
            const parameter: KeywordParameterLike = {
                name,
                mapping: name,
                description: `自定义关键字参数 ${name}`
            };
            if (defaultPart !== undefined) {
                parameter.default = defaultPart.trim();
            }
            return parameter;
        });
}

function splitCsvLike(value: string): string[] {
    const result: string[] = [];
    let current = '';
    let quote: string | null = null;
    for (let index = 0; index < value.length; index += 1) {
        const char = value[index];
        if ((char === '"' || char === "'") && value[index - 1] !== '\\') {
            quote = quote === char ? null : quote || char;
        }
        if (char === ',' && !quote) {
            result.push(current);
            current = '';
            continue;
        }
        current += char;
    }
    result.push(current);
    return result;
}

function normalizedParameterName(parameter: KeywordParameterLike | undefined): string {
    if (!parameter) {
        return '';
    }
    return String(parameter.name || parameter.mapping || '').trim();
}

function defaultPlaceholder(parameter: KeywordParameterLike): string {
    if (parameter.default !== undefined && parameter.default !== null) {
        return formatDefaultValue(parameter.default);
    }
    return String(parameter.description || '值');
}

function formatDefaultValue(defaultValue: any): string {
    if (typeof defaultValue === 'string') {
        return defaultValue;
    }
    if (defaultValue === null || defaultValue === undefined) {
        return '';
    }
    if (typeof defaultValue === 'number' || typeof defaultValue === 'boolean') {
        return String(defaultValue);
    }
    return JSON.stringify(defaultValue);
}

function escapeSnippetText(value: string): string {
    return String(value || '').replace(/[\\$}]/g, '\\$&');
}

function escapeSnippetPlaceholder(value: string): string {
    return String(value || '').replace(/[\\$}]/g, '\\$&');
}

function shouldTreatAsKeywordName(name: string): boolean {
    const trimmed = name.trim();
    if (!trimmed || trimmed.includes(',')) {
        return false;
    }
    if (/^["'{\d]/.test(trimmed)) {
        return false;
    }
    return IDENTIFIER_REGEX.test(trimmed[0]);
}

function unclosedVariableStart(lineText: string): number {
    const openIndex = lineText.lastIndexOf('${');
    if (openIndex < 0) {
        return -1;
    }
    const closeIndex = lineText.indexOf('}', openIndex + 2);
    return closeIndex < 0 ? openIndex : -1;
}

function createDiagnostic(
    code: string,
    message: string,
    line: number,
    start: number,
    end: number,
    severity: DslDiagnostic['severity']
): DslDiagnostic {
    return {
        code,
        message,
        severity,
        range: {
            start: { line, character: Math.max(0, start) },
            end: { line, character: Math.max(Math.max(0, start) + 1, end) }
        }
    };
}

function splitLines(content: string): string[] {
    return String(content || '').split(/\r?\n/);
}

function trimPreview(value: string): string {
    const trimmed = String(value || '').trim();
    if (!trimmed) {
        return '';
    }
    return trimmed.length > 120 ? `${trimmed.slice(0, 117)}...` : trimmed;
}

function markEffectiveDefinitions(definitions: SourceDefinition[]): void {
    const lastIndexByName = new Map<string, number>();
    definitions.forEach((definition, index) => {
        lastIndexByName.set(definition.name, index);
    });
    definitions.forEach((definition, index) => {
        definition.effective = lastIndexByName.get(definition.name) === index;
    });
}

function clamp(value: number, min: number, max: number): number {
    return Math.min(max, Math.max(min, value));
}
