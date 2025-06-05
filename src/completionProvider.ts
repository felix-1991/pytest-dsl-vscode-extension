import * as vscode from 'vscode';
import { KeywordProvider, Keyword } from './keywordProvider';

export class KeywordCompletionProvider implements vscode.CompletionItemProvider {
    constructor(private keywordProvider: KeywordProvider) {}

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
            const keywords = await this.keywordProvider.getKeywords();
            const line = document.lineAt(position);
            const lineText = line.text;
            const cursorPosition = position.character;

            // 检查是否在关键字调用上下文中
            if (this.isInKeywordContext(lineText, cursorPosition)) {
                return this.createKeywordCompletions(keywords);
            }

            // 检查是否在参数上下文中
            const keywordMatch = this.findKeywordInLine(lineText, cursorPosition);
            if (keywordMatch) {
                const keyword = keywords.find(k => k.name === keywordMatch.name);
                if (keyword) {
                    return this.createParameterCompletions(keyword, lineText, cursorPosition);
                }
            }

            return [];
        } catch (error) {
            console.error('自动补全失败:', error);
            return [];
        }
    }

    private isInKeywordContext(lineText: string, cursorPosition: number): boolean {
        // 检查光标前是否有 '[' 字符（支持远程调用语法）
        const beforeCursor = lineText.substring(0, cursorPosition);
        const lastBracket = beforeCursor.lastIndexOf('[');
        const lastCloseBracket = beforeCursor.lastIndexOf(']');
        
        // 检查是否在远程调用语法中：alias|[
        const remoteCallMatch = beforeCursor.match(/(\w+)\|\[([^\]]*)$/);
        if (remoteCallMatch) {
            return true;
        }
        
        // 如果最近的 '[' 在最近的 ']' 之后，说明在关键字名称上下文中
        return lastBracket > lastCloseBracket;
    }

    private findKeywordInLine(lineText: string, cursorPosition: number): { name: string, start: number, end: number } | null {
        // 支持普通关键字和远程调用关键字
        const keywordRegex = /(?:(\w+)\|)?\[([^\]]+)\]/g;
        let match;
        
        while ((match = keywordRegex.exec(lineText)) !== null) {
            const keywordStart = match.index;
            const keywordEnd = match.index + match[0].length;
            const keywordName = match[2]; // 关键字名称（不包括远程服务器前缀）
            
            // 检查光标是否在这个关键字调用的参数部分
            if (cursorPosition > keywordEnd) {
                // 查找这个关键字后面的参数部分
                const afterKeyword = lineText.substring(keywordEnd);
                const paramMatch = afterKeyword.match(/^\s*,/);
                if (paramMatch) {
                    return {
                        name: keywordName,
                        start: keywordStart,
                        end: keywordEnd
                    };
                }
            }
        }
        
        return null;
    }

    private createKeywordCompletions(keywords: Keyword[]): vscode.CompletionItem[] {
        return keywords.map(keyword => {
            const item = new vscode.CompletionItem(
                keyword.name,
                vscode.CompletionItemKind.Function
            );

            // 设置详细信息
            item.detail = `[${this.getCategoryDisplayName(keyword.category)}] ${keyword.name}`;
            item.documentation = new vscode.MarkdownString(this.createKeywordDocumentation(keyword));

            // 创建插入文本
            if (keyword.parameters && keyword.parameters.length > 0) {
                // 使用snippet格式，支持tab跳转
                const params = keyword.parameters.map((param, index) => {
                    // 如果参数有默认值，使用默认值，否则使用占位符
                    const defaultValue = param.default !== undefined ? param.default : (param.description || '值');
                    const displayValue = param.default !== undefined ? this.formatDefaultValue(param.default) : param.description || '值';
                    return `${param.name}: \${${index + 1}:${displayValue}}`;
                }).join(', ');
                item.insertText = new vscode.SnippetString(`${keyword.name}], ${params}`);
            } else {
                item.insertText = `${keyword.name}]`;
            }

            // 设置排序优先级（内置关键字优先）
            item.sortText = keyword.category === 'builtin' ? '0' + keyword.name : '1' + keyword.name;

            // 设置过滤文本
            item.filterText = keyword.name;

            return item;
        });
    }

    private createParameterCompletions(keyword: Keyword, lineText: string, cursorPosition: number): vscode.CompletionItem[] {
        if (!keyword.parameters || keyword.parameters.length === 0) {
            return [];
        }

        // 分析已经输入的参数
        const usedParams = this.parseUsedParameters(lineText, cursorPosition);
        const availableParams = keyword.parameters.filter(param => 
            !usedParams.includes(param.name)
        );

        return availableParams.map(param => {
            const item = new vscode.CompletionItem(
                param.name,
                vscode.CompletionItemKind.Property
            );

            item.detail = param.description || '参数';
            const defaultInfo = param.default !== undefined ? `\n\n**默认值:** ${this.formatDefaultValue(param.default)}` : '';
            item.documentation = new vscode.MarkdownString(
                `**参数名:** ${param.name}\n\n` +
                `**映射名:** ${param.mapping || param.name}\n\n` +
                `**说明:** ${param.description || '无说明'}${defaultInfo}`
            );

            // 插入参数名和冒号，如果有默认值则使用默认值
            const defaultValue = param.default !== undefined ? this.formatDefaultValue(param.default) : (param.description || '值');
            item.insertText = new vscode.SnippetString(`${param.name}: \${1:${defaultValue}}`);
            item.filterText = param.name;

            return item;
        });
    }

    private parseUsedParameters(lineText: string, cursorPosition: number): string[] {
        // 简单的参数解析，查找已经使用的参数名
        const beforeCursor = lineText.substring(0, cursorPosition);
        const paramRegex = /(\w+)\s*:/g;
        const usedParams: string[] = [];
        let match;

        while ((match = paramRegex.exec(beforeCursor)) !== null) {
            usedParams.push(match[1]);
        }

        return usedParams;
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
        token: vscode.CancellationToken
    ): vscode.ProviderResult<vscode.CompletionItem> {
        return item;
    }
}