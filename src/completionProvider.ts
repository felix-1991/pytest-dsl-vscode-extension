import * as vscode from 'vscode';
import { KeywordProvider, Keyword } from './keywordProvider';
import {
    METADATA_COMPLETION_TEMPLATES,
    SourceDefinition,
    buildKeywordSnippet,
    buildParameterSnippet,
    createParameterCompletionCandidates,
    createVariableCompletionCandidates,
    getCompletionContext,
    uniqueKeywordsByName
} from './languageService';
import { WorkspaceDslIndex } from './languageFeatures';

export class KeywordCompletionProvider implements vscode.CompletionItemProvider {
    constructor(
        private keywordProvider: KeywordProvider,
        private workspaceIndex?: WorkspaceDslIndex
    ) {}

    async provideCompletionItems(
        document: vscode.TextDocument,
        position: vscode.Position,
        token: vscode.CancellationToken,
        context: vscode.CompletionContext
    ): Promise<vscode.CompletionItem[]> {
        const config = vscode.workspace.getConfiguration('pytest-dsl');
        if (!config.get<boolean>('enableAutoCompletion', true)) {
            return [];
        }

        try {
            const line = document.lineAt(position);
            const lineText = line.text;
            const cursorPosition = position.character;
            const completionContext = getCompletionContext(
                lineText,
                cursorPosition,
                context.triggerKind === vscode.CompletionTriggerKind.Invoke
            );

            if (completionContext.kind === 'metadata') {
                return this.createMetadataCompletions(document, position, completionContext);
            }

            if (completionContext.kind === 'variable') {
                const definitions = this.workspaceIndex
                    ? await this.workspaceIndex.getWorkspaceVariableDefinitions(document)
                    : [];
                return this.createVariableCompletions(definitions, document, position, completionContext);
            }

            const keywords = uniqueKeywordsByName(await this.keywordProvider.getKeywords()) as Keyword[];

            if (completionContext.kind === 'keyword') {
                return this.createKeywordCompletions(keywords, document, position, completionContext);
            }

            if (completionContext.kind === 'parameter' && completionContext.keywordName) {
                const keyword = keywords.find(k => k.name === completionContext.keywordName);
                if (keyword) {
                    return this.createParameterCompletions(keyword, document, position, completionContext);
                }
            }

            return [];
        } catch (error) {
            console.error('自动补全失败:', error);
            return [];
        }
    }

    private createKeywordCompletions(
        keywords: Keyword[],
        document: vscode.TextDocument,
        position: vscode.Position,
        completionContext: ReturnType<typeof getCompletionContext>
    ): vscode.CompletionItem[] {
        const range = this.createCompletionRange(document, position, completionContext);
        return keywords.map(keyword => {
            const item = new vscode.CompletionItem(
                keyword.name,
                vscode.CompletionItemKind.Function
            );

            // 设置详细信息
            item.detail = `[${this.getCategoryDisplayName(keyword.category)}] ${keyword.name}`;
            item.documentation = new vscode.MarkdownString(this.createKeywordDocumentation(keyword));

            item.insertText = new vscode.SnippetString(buildKeywordSnippet(keyword, {
                inBracket: completionContext.inBracket
            }));
            item.range = range;
            item.additionalTextEdits = this.createAutoClosedBracketEdits(document, position, completionContext);

            // 设置排序优先级（内置关键字优先）
            item.sortText = keyword.category === 'builtin' ? '0' + keyword.name : '1' + keyword.name;

            // 设置过滤文本
            item.filterText = keyword.name;

            return item;
        });
    }

    private createParameterCompletions(
        keyword: Keyword,
        document: vscode.TextDocument,
        position: vscode.Position,
        completionContext: ReturnType<typeof getCompletionContext>
    ): vscode.CompletionItem[] {
        const range = this.createCompletionRange(document, position, completionContext);
        return createParameterCompletionCandidates(keyword, completionContext.usedParameterNames).map(param => {
            const item = new vscode.CompletionItem(
                param.name || param.mapping || '',
                vscode.CompletionItemKind.Property
            );

            item.detail = param.description || '参数';
            const defaultInfo = param.default !== undefined ? `\n\n**默认值:** ${this.formatDefaultValue(param.default)}` : '';
            item.documentation = new vscode.MarkdownString(
                `**参数名:** ${param.name}\n\n` +
                `**映射名:** ${param.mapping || param.name}\n\n` +
                `**说明:** ${param.description || '无说明'}${defaultInfo}`
            );

            item.insertText = new vscode.SnippetString(buildParameterSnippet(param));
            item.filterText = param.name || param.mapping || '';
            item.range = range;

            return item;
        });
    }

    private createMetadataCompletions(
        document: vscode.TextDocument,
        position: vscode.Position,
        completionContext: ReturnType<typeof getCompletionContext>
    ): vscode.CompletionItem[] {
        const range = this.createCompletionRange(document, position, completionContext);
        return METADATA_COMPLETION_TEMPLATES.map(template => {
            const item = new vscode.CompletionItem(template.label, vscode.CompletionItemKind.Property);
            item.detail = template.detail;
            item.insertText = new vscode.SnippetString(template.snippet);
            item.range = range;
            return item;
        });
    }

    private createVariableCompletions(
        definitions: SourceDefinition[],
        document: vscode.TextDocument,
        position: vscode.Position,
        completionContext: ReturnType<typeof getCompletionContext>
    ): vscode.CompletionItem[] {
        const range = this.createCompletionRange(document, position, completionContext);
        const lineText = document.lineAt(position).text;
        const hasExistingClosingBrace = lineText.slice(position.character, position.character + 1) === '}';
        return createVariableCompletionCandidates(definitions).map(definition => {
            const item = new vscode.CompletionItem(definition.name, vscode.CompletionItemKind.Variable);
            item.detail = definition.sourceLabel || `${definition.path}:${definition.line}`;
            item.documentation = definition.valuePreview
                ? new vscode.MarkdownString(`当前值: \`${definition.valuePreview}\``)
                : undefined;
            item.insertText = hasExistingClosingBrace ? definition.name : `${definition.name}}`;
            item.range = range;
            return item;
        });
    }

    private createCompletionRange(
        document: vscode.TextDocument,
        position: vscode.Position,
        completionContext: ReturnType<typeof getCompletionContext>
    ): vscode.Range | { inserting: vscode.Range; replacing: vscode.Range } {
        const start = position.with({ character: completionContext.from });
        const insertEnd = position.with({ character: completionContext.to });
        return new vscode.Range(start, insertEnd);
    }

    private createAutoClosedBracketEdits(
        document: vscode.TextDocument,
        position: vscode.Position,
        completionContext: ReturnType<typeof getCompletionContext>
    ): vscode.TextEdit[] | undefined {
        if (completionContext.replaceNextBracket) {
            const lineLength = document.lineAt(position).text.length;
            const replaceEnd = position.with({ character: Math.min(lineLength, completionContext.to + 1) });
            return [vscode.TextEdit.delete(new vscode.Range(position, replaceEnd))];
        }
        return undefined;
    }

    private createKeywordDocumentation(keyword: Keyword): string {
        let doc = `**${keyword.name}** [${this.getCategoryDisplayName(keyword.category)}]\n\n`;

        if (keyword.documentation) {
            doc += `${keyword.documentation}\n\n`;
        }

        if (keyword.remote) {
            doc += `**远程服务器:** ${keyword.remote.alias}\n\n`;
            doc += `**原始名称:** ${keyword.remote.original_name}\n\n`;
        }

        if (keyword.parameters && keyword.parameters.length > 0) {
            doc += '**参数:**\n\n';
            keyword.parameters.forEach(param => {
                const defaultInfo = param.default !== undefined ? ` [默认: ${this.formatDefaultValue(param.default)}]` : '';
                doc += `- **${param.name}** (${param.mapping || param.name}): ${param.description || '无说明'}${defaultInfo}\n`;
            });
        } else {
            doc += '**参数:** 无\n';
        }

        return doc;
    }

    private formatDefaultValue(defaultValue: any): string {
        if (typeof defaultValue === 'string') {
            return `"${defaultValue}"`;
        } else if (typeof defaultValue === 'boolean') {
            return defaultValue.toString();
        } else if (typeof defaultValue === 'number') {
            return defaultValue.toString();
        } else if (defaultValue === null || defaultValue === undefined) {
            return '';
        } else {
            return JSON.stringify(defaultValue);
        }
    }

    private getCategoryDisplayName(category: string): string {
        const categoryNames: { [key: string]: string } = {
            'builtin': '内置',
            'custom': '自定义',
            'remote': '远程'
        };
        return categoryNames[category] || category;
    }

    resolveCompletionItem(
        item: vscode.CompletionItem,
        _token: vscode.CancellationToken
    ): vscode.ProviderResult<vscode.CompletionItem> {
        return item;
    }
}
