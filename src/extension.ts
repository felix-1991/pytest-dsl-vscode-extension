import * as vscode from 'vscode';
import { KeywordProvider } from './keywordProvider';
import { KeywordCompletionProvider } from './completionProvider';
import { KeywordEditorProvider } from './keywordEditor';

let keywordProvider: KeywordProvider;
let keywordEditor: KeywordEditorProvider;

export function activate(context: vscode.ExtensionContext) {
    console.log('pytest-DSL扩展已激活');

    // 初始化关键字提供者
    keywordProvider = new KeywordProvider(context);

    // 注册自动补全提供者
    const completionProvider = new KeywordCompletionProvider(keywordProvider);
    context.subscriptions.push(
        vscode.languages.registerCompletionItemProvider(
            { scheme: 'file', language: 'pytest-dsl' },
            completionProvider,
            '[', // 触发字符
            ','  // 参数分隔符
        )
    );

    // 注册关键字编辑器
    keywordEditor = new KeywordEditorProvider(context, keywordProvider);

    // 注册命令
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
            vscode.window.showInformationMessage('关键字缓存已刷新');
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('pytest-dsl.generateKeywordsFile', async () => {
            await generateKeywordsFile();
        })
    );

    // 监听配置变化
    context.subscriptions.push(
        vscode.workspace.onDidChangeConfiguration(event => {
            if (event.affectsConfiguration('pytest-dsl')) {
                keywordProvider.refreshKeywords();
            }
        })
    );
}

async function showKeywordsList() {
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
            placeHolder: '选择一个关键字查看详情',
            matchOnDescription: true,
            matchOnDetail: true
        });

        if (selected) {
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

        // 创建快速选择项
        const items: vscode.QuickPickItem[] = keywords.map(keyword => ({
            label: keyword.name,
            description: `[${getCategoryDisplayName(keyword.category)}]`,
            detail: keyword.documentation || '无说明',
            keyword: keyword
        } as any));

        const selected = await vscode.window.showQuickPick(items, {
            placeHolder: '选择要插入的关键字',
            matchOnDescription: true,
            matchOnDetail: true
        });

        if (selected) {
            const keyword = (selected as any).keyword;
            await insertKeywordAtCursor(keyword);
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