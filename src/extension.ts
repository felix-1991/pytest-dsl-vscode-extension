import * as vscode from 'vscode';
import { KeywordProvider } from './keywordProvider';
import { KeywordCompletionProvider } from './completionProvider';
import { KeywordEditorProvider } from './keywordEditor';
import { KeywordTreeProvider, KeywordTreeItem } from './keywordTreeProvider';
import {
    DslDefinitionProvider,
    DslDiagnosticsManager,
    DslHoverProvider,
    WorkspaceDslIndex
} from './languageFeatures';
import { DslExecutionController } from './executionController';
import { DslConfigSelectionController } from './configSelectionController';

let keywordProvider: KeywordProvider;
let keywordEditor: KeywordEditorProvider;
let keywordTreeProvider: KeywordTreeProvider;
let workspaceIndex: WorkspaceDslIndex;
let diagnosticsManager: DslDiagnosticsManager;

export function activate(context: vscode.ExtensionContext) {
    console.log('pytest-DSL扩展已激活');

    // 初始化关键字提供者
    keywordProvider = new KeywordProvider(context);
    const configSelectionController = new DslConfigSelectionController(context);
    workspaceIndex = new WorkspaceDslIndex(
        keywordProvider,
        (document) => document ? configSelectionController.getCompletionConfigPaths(document) : null
    );
    context.subscriptions.push(
        configSelectionController,
        configSelectionController.onDidChangeSelection(() => workspaceIndex.invalidate())
    );

    // 注册自动补全提供者
    const completionProvider = new KeywordCompletionProvider(keywordProvider, workspaceIndex);
    const languageSelector = { scheme: 'file', language: 'pytest-dsl' };
    context.subscriptions.push(
        vscode.languages.registerCompletionItemProvider(
            languageSelector,
            completionProvider,
            '[', // 触发字符
            ',', // 参数分隔符
            '$',
            '{',
            '@'
        )
    );
    context.subscriptions.push(
        vscode.languages.registerHoverProvider(
            languageSelector,
            new DslHoverProvider(keywordProvider, workspaceIndex)
        )
    );
    context.subscriptions.push(
        vscode.languages.registerDefinitionProvider(
            languageSelector,
            new DslDefinitionProvider(workspaceIndex)
        )
    );

    diagnosticsManager = new DslDiagnosticsManager(keywordProvider, workspaceIndex);
    diagnosticsManager.activate(context);
    context.subscriptions.push(diagnosticsManager);

    // 对齐 Electron GUI 的 workbench 协议：整文件运行、步进调试和结构化事件。
    const executionController = new DslExecutionController(context, configSelectionController);
    executionController.registerCodeLens(languageSelector);
    context.subscriptions.push(executionController);

    // 注册关键字编辑器
    keywordEditor = new KeywordEditorProvider(context, keywordProvider);

    // 创建并注册关键字树视图
    keywordTreeProvider = new KeywordTreeProvider(keywordProvider, context);
    const treeView = vscode.window.createTreeView('pytest-dsl-keywords', {
        treeDataProvider: keywordTreeProvider,
        showCollapseAll: true,
        canSelectMany: false
    });

    context.subscriptions.push(treeView);

    // 注册原有命令
    context.subscriptions.push(
        vscode.commands.registerCommand('pytest-dsl.showKeywords', async () => {
            await showKeywordsList();
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('pytest-dsl.insertKeyword', async () => {
            await insertKeyword();
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('pytest-dsl.editKeyword', async () => {
            await editKeyword();
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('pytest-dsl.refreshKeywords', async () => {
            await keywordProvider.refreshKeywords();
            keywordTreeProvider.refresh();
            vscode.window.showInformationMessage('关键字缓存已刷新');
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('pytest-dsl.generateKeywordsFile', async () => {
            await generateKeywordsFile();
        })
    );

    // 新增命令
    context.subscriptions.push(
        vscode.commands.registerCommand('pytest-dsl.searchKeywords', async () => {
            await showSmartSearch();
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('pytest-dsl.toggleFavorite', async (item: KeywordTreeItem) => {
            if (item && item.keyword) {
                await keywordTreeProvider.toggleFavorite(item.keyword.name);
            }
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('pytest-dsl.insertKeywordFromTree', async (item: KeywordTreeItem) => {
            if (item && item.keyword) {
                await insertKeywordAtCursor(item.keyword);
            }
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('pytest-dsl.previewKeyword', async (item: KeywordTreeItem) => {
            if (item && item.keyword) {
                showKeywordDetails(item.keyword);
            }
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('pytest-dsl.insertKeywordWithParams', async () => {
            await insertKeywordWithParameterTemplate();
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('pytest-dsl.filterByCategory', async () => {
            await filterKeywordsByCategory();
        })
    );

    // 监听配置变化
    context.subscriptions.push(
        vscode.workspace.onDidChangeConfiguration(event => {
            if (event.affectsConfiguration('pytest-dsl')) {
                workspaceIndex.invalidate();
                keywordProvider.refreshKeywords();
                keywordTreeProvider.refresh();
            }
        })
    );

    // 初始化树视图
    keywordTreeProvider.refresh();
}

// 智能搜索功能
async function showSmartSearch() {
    try {
        const keywords = await keywordProvider.getKeywords();
        
        if (!keywords || keywords.length === 0) {
            vscode.window.showWarningMessage('未找到任何关键字');
            return;
        }

        // 创建搜索输入框
        const searchQuery = await vscode.window.showInputBox({
            placeHolder: '搜索关键字（支持名称、分类、参数、说明）',
            prompt: '输入搜索关键词，支持模糊匹配',
            validateInput: (value) => {
                return value.length < 1 ? '请输入搜索关键词' : null;
            }
        });

        if (!searchQuery) {
            return;
        }

        // 执行搜索
        const filteredKeywords = keywordProvider.searchKeywords(searchQuery);
        
        if (filteredKeywords.length === 0) {
            vscode.window.showInformationMessage(`未找到匹配"${searchQuery}"的关键字`);
            return;
        }

        // 创建快速选择项，增强显示信息
        const items: vscode.QuickPickItem[] = filteredKeywords.map(keyword => {
            const paramCount = keyword.parameters ? keyword.parameters.length : 0;
            const sourceInfo = keyword.source_info || { display_name: '未知来源' };
            
            return {
                label: `$(symbol-method) ${keyword.name}`,
                description: `[${getCategoryDisplayName(keyword.category)}] ${sourceInfo.display_name}`,
                detail: `参数: ${paramCount}个 | ${keyword.documentation?.split('\n')[0] || '无说明'}`,
                keyword: keyword
            } as any;
        });

        const selected = await vscode.window.showQuickPick(items, {
            placeHolder: `从 ${filteredKeywords.length} 个匹配结果中选择关键字`,
            matchOnDescription: true,
            matchOnDetail: true
        });

        if (selected) {
            const keyword = (selected as any).keyword;
            
            // 显示操作选项
            const action = await vscode.window.showQuickPick([
                { label: '$(add) 插入关键字', action: 'insert' },
                { label: '$(add) 插入带参数模板', action: 'insertWithParams' },
                { label: '$(eye) 查看详情', action: 'preview' },
                { label: '$(edit) 编辑关键字', action: 'edit' },
                { label: '$(star-empty) 添加到收藏夹', action: 'favorite' }
            ], {
                placeHolder: '选择操作'
            });

            if (action) {
                switch (action.action) {
                    case 'insert':
                        await insertKeywordAtCursor(keyword);
                        break;
                    case 'insertWithParams':
                        await insertKeywordWithTemplate(keyword);
                        break;
                    case 'preview':
                        showKeywordDetails(keyword);
                        break;
                    case 'edit':
                        await keywordEditor.openEditor(keyword);
                        break;
                    case 'favorite':
                        await keywordTreeProvider.toggleFavorite(keyword.name);
                        vscode.window.showInformationMessage(`已将"${keyword.name}"添加到收藏夹`);
                        break;
                }
            }
        }
    } catch (error) {
        vscode.window.showErrorMessage(`智能搜索失败: ${error}`);
    }
}

// 按分类过滤关键字
async function filterKeywordsByCategory() {
    try {
        const keywords = await keywordProvider.getKeywords();
        
        if (!keywords || keywords.length === 0) {
            vscode.window.showWarningMessage('未找到任何关键字');
            return;
        }

        // 获取所有分类
        const categories = [...new Set(keywords.map(k => k.category))];
        const categoryItems = categories.map(category => {
            const count = keywords.filter(k => k.category === category).length;
            return {
                label: getCategoryDisplayName(category),
                description: `${count} 个关键字`,
                category: category
            };
        });

        // 添加"全部"选项
        categoryItems.unshift({
            label: '全部分类',
            description: `${keywords.length} 个关键字`,
            category: 'all'
        });

        const selectedCategory = await vscode.window.showQuickPick(categoryItems, {
            placeHolder: '选择要查看的分类'
        });

        if (selectedCategory) {
            const filteredKeywords = selectedCategory.category === 'all' 
                ? keywords 
                : keywords.filter(k => k.category === selectedCategory.category);

            // 显示该分类下的关键字
            const items: vscode.QuickPickItem[] = filteredKeywords.map(keyword => ({
                label: keyword.name,
                description: `[${getCategoryDisplayName(keyword.category)}]`,
                detail: keyword.documentation?.split('\n')[0] || '无说明',
                keyword: keyword
            } as any));

            const selected = await vscode.window.showQuickPick(items, {
                placeHolder: `${selectedCategory.label} - 选择关键字`,
                matchOnDescription: true,
                matchOnDetail: true
            });

            if (selected) {
                const keyword = (selected as any).keyword;
                await insertKeywordAtCursor(keyword);
            }
        }
    } catch (error) {
        vscode.window.showErrorMessage(`分类过滤失败: ${error}`);
    }
}

// 插入带参数模板的关键字
async function insertKeywordWithParameterTemplate() {
    try {
        const keywords = await keywordProvider.getKeywords();
        
        if (!keywords || keywords.length === 0) {
            vscode.window.showWarningMessage('未找到任何关键字');
            return;
        }

        // 只显示有参数的关键字
        const keywordsWithParams = keywords.filter(k => k.parameters && k.parameters.length > 0);
        
        if (keywordsWithParams.length === 0) {
            vscode.window.showWarningMessage('未找到有参数的关键字');
            return;
        }

        const items: vscode.QuickPickItem[] = keywordsWithParams.map(keyword => ({
            label: keyword.name,
            description: `[${getCategoryDisplayName(keyword.category)}] ${keyword.parameters.length} 个参数`,
            detail: keyword.parameters.map(p => p.name).join(', '),
            keyword: keyword
        } as any));

        const selected = await vscode.window.showQuickPick(items, {
            placeHolder: '选择要插入参数模板的关键字',
            matchOnDescription: true,
            matchOnDetail: true
        });

        if (selected) {
            const keyword = (selected as any).keyword;
            await insertKeywordWithTemplate(keyword);
        }
    } catch (error) {
        vscode.window.showErrorMessage(`插入参数模板失败: ${error}`);
    }
}

// 插入带参数模板的关键字
async function insertKeywordWithTemplate(keyword: any) {
    const editor = vscode.window.activeTextEditor;
    if (!editor) {
        vscode.window.showWarningMessage('请先打开一个编辑器');
        return;
    }

    const position = editor.selection.active;
    let insertText = keyword.name;

    if (keyword.parameters && keyword.parameters.length > 0) {
        // 生成参数模板
        const paramTemplates = keyword.parameters.map((param: any, index: number) => {
            const placeholder = param.default !== undefined ? param.default : `\${${index + 1}:${param.description}}`;
            return `    ${param.name}=${placeholder}`;
        });

        insertText = `${keyword.name}[\n${paramTemplates.join('\n')}\n]`;
    }

    await editor.edit(editBuilder => {
        editBuilder.insert(position, insertText);
    });

    // 如果有参数，选中整个插入的文本以便用户修改
    if (keyword.parameters && keyword.parameters.length > 0) {
        const newPosition = position.translate(0, insertText.length);
        editor.selection = new vscode.Selection(position, newPosition);
    }

    vscode.window.showInformationMessage(`已插入关键字"${keyword.name}"的参数模板`);
}

async function showKeywordsList() {
    try {
        const keywords = await keywordProvider.getKeywords();
        
        if (!keywords || keywords.length === 0) {
            vscode.window.showWarningMessage('未找到任何关键字');
            return;
        }

        // 按分类分组显示
        const categories = [...new Set(keywords.map(k => k.category))];
        const items: vscode.QuickPickItem[] = [];

        for (const category of categories.sort()) {
            const categoryKeywords = keywords.filter(k => k.category === category);
            
            // 添加分类标题
            items.push({
                label: `📁 ${getCategoryDisplayName(category)}`,
                description: `${categoryKeywords.length} 个关键字`,
                kind: vscode.QuickPickItemKind.Separator
            } as any);

            // 添加该分类下的关键字
            categoryKeywords.forEach(keyword => {
                items.push({
                    label: `  $(symbol-method) ${keyword.name}`,
                    description: keyword.source_info?.display_name || '',
                    detail: keyword.documentation?.split('\n')[0] || '无说明',
                    keyword: keyword
                } as any);
            });
        }

        const selected = await vscode.window.showQuickPick(items, {
            placeHolder: '选择一个关键字查看详情',
            matchOnDescription: true,
            matchOnDetail: true
        });

        if (selected && (selected as any).keyword) {
            const keyword = (selected as any).keyword;
            showKeywordDetails(keyword);
        }
    } catch (error) {
        vscode.window.showErrorMessage(`获取关键字列表失败: ${error}`);
    }
}

async function insertKeyword() {
    try {
        const keywords = await keywordProvider.getKeywords();
        
        if (!keywords || keywords.length === 0) {
            vscode.window.showWarningMessage('未找到任何关键字');
            return;
        }

        // 按使用频率和收藏夹排序
        const favorites = keywordTreeProvider.getFavorites();
        const sortedKeywords = [...keywords].sort((a, b) => {
            const aIsFav = favorites.includes(a.name);
            const bIsFav = favorites.includes(b.name);
            
            if (aIsFav && !bIsFav) return -1;
            if (!aIsFav && bIsFav) return 1;
            return a.name.localeCompare(b.name);
        });

        // 创建快速选择项
        const items: vscode.QuickPickItem[] = sortedKeywords.map(keyword => {
            const isFavorite = favorites.includes(keyword.name);
            const icon = isFavorite ? '$(star-full)' : '$(symbol-method)';
            
            return {
                label: `${icon} ${keyword.name}`,
                description: `[${getCategoryDisplayName(keyword.category)}]`,
                detail: keyword.documentation?.split('\n')[0] || '无说明',
                keyword: keyword
            } as any;
        });

        const selected = await vscode.window.showQuickPick(items, {
            placeHolder: '选择要插入的关键字（⭐ 表示收藏）',
            matchOnDescription: true,
            matchOnDetail: true
        });

        if (selected) {
            const keyword = (selected as any).keyword;
            
            // 询问插入方式
            const insertMode = await vscode.window.showQuickPick([
                { label: '仅插入关键字名称', mode: 'name' },
                { label: '插入带参数模板', mode: 'template' }
            ], {
                placeHolder: '选择插入方式'
            });

            if (insertMode) {
                if (insertMode.mode === 'template') {
                    await insertKeywordWithTemplate(keyword);
                } else {
                    await insertKeywordAtCursor(keyword);
                }
            }
        }
    } catch (error) {
        vscode.window.showErrorMessage(`插入关键字失败: ${error}`);
    }
}

async function editKeyword() {
    try {
        const keywords = await keywordProvider.getKeywords();
        
        if (!keywords || keywords.length === 0) {
            vscode.window.showWarningMessage('未找到任何关键字');
            return;
        }

        // 创建快速选择项
        const items: vscode.QuickPickItem[] = keywords.map(keyword => ({
            label: keyword.name,
            description: `[${getCategoryDisplayName(keyword.category)}]`,
            detail: keyword.documentation || '无说明',
            keyword: keyword
        } as any));

        const selected = await vscode.window.showQuickPick(items, {
            placeHolder: '选择要编辑的关键字',
            matchOnDescription: true,
            matchOnDetail: true
        });

        if (selected) {
            const keyword = (selected as any).keyword;
            await keywordEditor.openEditor(keyword);
        }
    } catch (error) {
        vscode.window.showErrorMessage(`编辑关键字失败: ${error}`);
    }
}

async function generateKeywordsFile() {
    try {
        // 显示进度指示器
        await vscode.window.withProgress({
            location: vscode.ProgressLocation.Notification,
            title: "正在生成关键字文件...",
            cancellable: false
        }, async (progress) => {
            progress.report({ increment: 0 });
            
            // 检查环境
            progress.report({ message: "检查环境...", increment: 25 });
            const isValid = await keywordProvider.validateEnvironment();
            if (!isValid) {
                throw new Error('pytest-dsl环境不可用，请确保已正确安装pytest-dsl');
            }
            
            // 生成文件
            progress.report({ message: "获取关键字数据...", increment: 50 });
            await keywordProvider.generateKeywordsFile();
            
            progress.report({ message: "完成", increment: 100 });
        });
    } catch (error) {
        vscode.window.showErrorMessage(`生成关键字文件失败: ${error}`);
    }
}

function showKeywordDetails(keyword: any) {
    const panel = vscode.window.createWebviewPanel(
        'keywordDetails',
        `关键字详情: ${keyword.name}`,
        vscode.ViewColumn.Two,
        {
            enableScripts: true,
            retainContextWhenHidden: true
        }
    );

    panel.webview.html = generateKeywordDetailsHtml(keyword);
}

function generateKeywordDetailsHtml(keyword: any): string {
    const parametersHtml = keyword.parameters.map((param: any) => `
        <tr>
            <td><strong>${param.name}</strong></td>
            <td>${param.mapping || param.name}</td>
            <td>${param.description || '无说明'}</td>
        </tr>
    `).join('');

    return `
        <!DOCTYPE html>
        <html>
        <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>关键字详情</title>
            <style>
                body { 
                    font-family: var(--vscode-font-family); 
                    padding: 20px;
                    color: var(--vscode-foreground);
                    background-color: var(--vscode-editor-background);
                }
                .header { 
                    border-bottom: 1px solid var(--vscode-panel-border); 
                    padding-bottom: 10px; 
                    margin-bottom: 20px; 
                }
                .category { 
                    background-color: var(--vscode-badge-background); 
                    color: var(--vscode-badge-foreground); 
                    padding: 2px 8px; 
                    border-radius: 3px; 
                    font-size: 12px; 
                }
                table { 
                    width: 100%; 
                    border-collapse: collapse; 
                    margin-top: 10px; 
                }
                th, td { 
                    border: 1px solid var(--vscode-panel-border); 
                    padding: 8px; 
                    text-align: left; 
                }
                th { 
                    background-color: var(--vscode-editor-lineHighlightBackground); 
                }
                .documentation { 
                    background-color: var(--vscode-textCodeBlock-background); 
                    padding: 10px; 
                    border-radius: 3px; 
                    margin-top: 10px; 
                }
            </style>
        </head>
        <body>
            <div class="header">
                <h1>${keyword.name} <span class="category">${getCategoryDisplayName(keyword.category)}</span></h1>
                ${keyword.remote ? `
                    <p><strong>远程服务器:</strong> ${keyword.remote.alias}</p>
                    <p><strong>原始名称:</strong> ${keyword.remote.original_name}</p>
                ` : ''}
            </div>
            
            <h2>参数列表</h2>
            ${keyword.parameters.length > 0 ? `
                <table>
                    <thead>
                        <tr>
                            <th>参数名</th>
                            <th>映射名</th>
                            <th>说明</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${parametersHtml}
                    </tbody>
                </table>
            ` : '<p>无参数</p>'}
            
            ${keyword.documentation ? `
                <h2>说明文档</h2>
                <div class="documentation">${keyword.documentation}</div>
            ` : ''}
        </body>
        </html>
    `;
}

async function insertKeywordAtCursor(keyword: any) {
    const editor = vscode.window.activeTextEditor;
    if (!editor) {
        vscode.window.showWarningMessage('没有活动的编辑器');
        return;
    }

    // 检查是否需要远程服务器前缀
    let keywordCall: string;
    if (keyword.remote && keyword.remote.alias) {
        keywordCall = `${keyword.remote.alias}|[${keyword.name}]`;
    } else {
        keywordCall = `[${keyword.name}]`;
    }
    
    if (keyword.parameters && keyword.parameters.length > 0) {
        // 支持snippet格式的参数插入
        const params = keyword.parameters.map((param: any, index: number) => 
            `${param.name}: $\{${index + 1}:${param.description || '值'}\}`
        ).join(', ');
        keywordCall += `, ${params}`;
        
        // 使用snippet插入以支持tab跳转
        const snippet = new vscode.SnippetString(keywordCall);
        await editor.insertSnippet(snippet);
    } else {
        // 简单插入
        await editor.edit(editBuilder => {
            editBuilder.insert(editor.selection.active, keywordCall);
        });
    }
}

function getCategoryDisplayName(category: string): string {
    const categoryNames: { [key: string]: string } = {
        'builtin': '内置',
        'custom': '自定义', 
        'remote': '远程'
    };
    return categoryNames[category] || category;
}

export function deactivate() {
    console.log('pytest-DSL扩展已停用');
}
