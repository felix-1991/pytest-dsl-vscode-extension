import * as vscode from 'vscode';
import { KeywordProvider, Keyword, KeywordParameter } from './keywordProvider';

export class KeywordEditorProvider {
    constructor(
        private context: vscode.ExtensionContext,
        private keywordProvider: KeywordProvider
    ) {}

    async openEditor(keyword: Keyword): Promise<void> {
        const panel = vscode.window.createWebviewPanel(
            'keywordEditor',
            `编辑关键字: ${keyword.name}`,
            vscode.ViewColumn.Two,
            {
                enableScripts: true,
                retainContextWhenHidden: true,
                localResourceRoots: []
            }
        );

        panel.webview.html = this.generateEditorHtml(keyword);

        // 处理来自webview的消息
        panel.webview.onDidReceiveMessage(
            async (message) => {
                switch (message.command) {
                    case 'insertKeyword':
                        await this.insertKeywordWithValues(keyword, message.values);
                        panel.dispose();
                        break;
                    case 'previewKeyword':
                        this.showPreview(panel, keyword, message.values);
                        break;
                    case 'validateParameter':
                        const validation = this.validateParameterValue(
                            keyword.parameters.find(p => p.name === message.paramName),
                            message.value
                        );
                        panel.webview.postMessage({
                            command: 'validationResult',
                            paramName: message.paramName,
                            isValid: validation.isValid,
                            message: validation.message
                        });
                        break;
                }
            },
            undefined,
            this.context.subscriptions
        );
    }

    private generateEditorHtml(keyword: Keyword): string {
        const parametersHtml = keyword.parameters.map((param, index) => `
            <div class="parameter-group">
                <label for="param-${index}" class="parameter-label">
                    <strong>${param.name}</strong>
                    ${param.mapping && param.mapping !== param.name ? `<span class="mapping">(${param.mapping})</span>` : ''}
                </label>
                <div class="parameter-input-group">
                    <input 
                        type="text" 
                        id="param-${index}" 
                        name="${param.name}"
                        placeholder="${param.description || '请输入值'}"
                        value="${this.formatParameterDefaultValue(param)}"
                        class="parameter-input"
                        data-param-name="${param.name}"
                    />
                    <div class="parameter-validation" id="validation-${index}"></div>
                </div>
                <div class="parameter-description">
                    ${param.description || '无说明'}
                    ${param.default !== undefined ? `<br><strong>默认值:</strong> ${this.formatParameterDefaultValue(param)}` : ''}
                </div>
            </div>
        `).join('');

        return `
            <!DOCTYPE html>
            <html>
            <head>
                <meta charset="UTF-8">
                <meta name="viewport" content="width=device-width, initial-scale=1.0">
                <title>关键字编辑器</title>
                <style>
                    body {
                        font-family: var(--vscode-font-family);
                        padding: 20px;
                        color: var(--vscode-foreground);
                        background-color: var(--vscode-editor-background);
                        margin: 0;
                    }
                    
                    .header {
                        border-bottom: 1px solid var(--vscode-panel-border);
                        padding-bottom: 15px;
                        margin-bottom: 20px;
                    }
                    
                    .keyword-title {
                        font-size: 24px;
                        font-weight: bold;
                        margin: 0 0 10px 0;
                    }
                    
                    .category {
                        background-color: var(--vscode-badge-background);
                        color: var(--vscode-badge-foreground);
                        padding: 4px 8px;
                        border-radius: 3px;
                        font-size: 12px;
                        display: inline-block;
                    }
                    
                    .documentation {
                        background-color: var(--vscode-textCodeBlock-background);
                        padding: 10px;
                        border-radius: 3px;
                        margin: 10px 0;
                        font-style: italic;
                    }
                    
                    .parameters-section {
                        margin: 20px 0;
                    }
                    
                    .section-title {
                        font-size: 18px;
                        font-weight: bold;
                        margin-bottom: 15px;
                        color: var(--vscode-textLink-foreground);
                    }
                    
                    .parameter-group {
                        margin-bottom: 20px;
                        padding: 15px;
                        border: 1px solid var(--vscode-panel-border);
                        border-radius: 5px;
                        background-color: var(--vscode-editor-lineHighlightBackground);
                    }
                    
                    .parameter-label {
                        display: block;
                        margin-bottom: 8px;
                        font-weight: bold;
                    }
                    
                    .mapping {
                        color: var(--vscode-descriptionForeground);
                        font-weight: normal;
                        font-size: 0.9em;
                    }
                    
                    .parameter-input-group {
                        position: relative;
                        margin-bottom: 8px;
                    }
                    
                    .parameter-input {
                        width: 100%;
                        padding: 8px 12px;
                        border: 1px solid var(--vscode-input-border);
                        border-radius: 3px;
                        background-color: var(--vscode-input-background);
                        color: var(--vscode-input-foreground);
                        font-family: var(--vscode-font-family);
                        font-size: 14px;
                        box-sizing: border-box;
                    }
                    
                    .parameter-input:focus {
                        outline: none;
                        border-color: var(--vscode-focusBorder);
                        box-shadow: 0 0 0 1px var(--vscode-focusBorder);
                    }
                    
                    .parameter-validation {
                        position: absolute;
                        right: 8px;
                        top: 50%;
                        transform: translateY(-50%);
                        font-size: 12px;
                        pointer-events: none;
                    }
                    
                    .parameter-validation.valid {
                        color: var(--vscode-testing-iconPassed);
                    }
                    
                    .parameter-validation.invalid {
                        color: var(--vscode-testing-iconFailed);
                    }
                    
                    .parameter-description {
                        font-size: 12px;
                        color: var(--vscode-descriptionForeground);
                        margin-top: 5px;
                    }
                    
                    .actions {
                        margin-top: 30px;
                        padding-top: 20px;
                        border-top: 1px solid var(--vscode-panel-border);
                        display: flex;
                        gap: 10px;
                        flex-wrap: wrap;
                    }
                    
                    .button {
                        padding: 8px 16px;
                        border: none;
                        border-radius: 3px;
                        cursor: pointer;
                        font-family: var(--vscode-font-family);
                        font-size: 14px;
                        transition: background-color 0.2s;
                    }
                    
                    .button-primary {
                        background-color: var(--vscode-button-background);
                        color: var(--vscode-button-foreground);
                    }
                    
                    .button-primary:hover {
                        background-color: var(--vscode-button-hoverBackground);
                    }
                    
                    .button-secondary {
                        background-color: var(--vscode-button-secondaryBackground);
                        color: var(--vscode-button-secondaryForeground);
                    }
                    
                    .button-secondary:hover {
                        background-color: var(--vscode-button-secondaryHoverBackground);
                    }
                    
                    .preview-section {
                        margin-top: 20px;
                        padding: 15px;
                        background-color: var(--vscode-textCodeBlock-background);
                        border-radius: 5px;
                        border-left: 4px solid var(--vscode-textLink-foreground);
                    }
                    
                    .preview-title {
                        font-weight: bold;
                        margin-bottom: 10px;
                        color: var(--vscode-textLink-foreground);
                    }
                    
                    .preview-code {
                        font-family: var(--vscode-editor-font-family);
                        font-size: var(--vscode-editor-font-size);
                        background-color: var(--vscode-editor-background);
                        padding: 10px;
                        border-radius: 3px;
                        border: 1px solid var(--vscode-panel-border);
                        white-space: pre-wrap;
                        word-break: break-all;
                    }
                    
                    .no-parameters {
                        text-align: center;
                        color: var(--vscode-descriptionForeground);
                        font-style: italic;
                        padding: 20px;
                    }
                </style>
            </head>
            <body>
                <div class="header">
                    <h1 class="keyword-title">${keyword.name}</h1>
                    <span class="category">${this.getCategoryDisplayName(keyword.category)}</span>
                    ${keyword.remote ? `
                        <div style="margin-top: 10px;">
                            <strong>远程服务器:</strong> ${keyword.remote.alias} | 
                            <strong>原始名称:</strong> ${keyword.remote.original_name}
                        </div>
                    ` : ''}
                    ${keyword.documentation ? `
                        <div class="documentation">${keyword.documentation}</div>
                    ` : ''}
                </div>
                
                <div class="parameters-section">
                    <h2 class="section-title">参数配置</h2>
                    ${keyword.parameters && keyword.parameters.length > 0 ? `
                        <form id="keyword-form">
                            ${parametersHtml}
                        </form>
                    ` : `
                        <div class="no-parameters">此关键字无需参数</div>
                    `}
                </div>
                
                <div class="preview-section" id="preview-section" style="display: none;">
                    <div class="preview-title">预览</div>
                    <div class="preview-code" id="preview-code"></div>
                </div>
                
                <div class="actions">
                    <button class="button button-primary" onclick="insertKeyword()">
                        插入到编辑器
                    </button>
                    <button class="button button-secondary" onclick="previewKeyword()">
                        预览代码
                    </button>
                    <button class="button button-secondary" onclick="resetForm()">
                        重置
                    </button>
                </div>
                
                <script>
                    const vscode = acquireVsCodeApi();
                    
                    // 参数验证
                    function validateParameter(paramName, value) {
                        vscode.postMessage({
                            command: 'validateParameter',
                            paramName: paramName,
                            value: value
                        });
                    }
                    
                    // 监听参数输入变化
                    document.querySelectorAll('.parameter-input').forEach(input => {
                        input.addEventListener('input', function() {
                            const paramName = this.getAttribute('data-param-name');
                            validateParameter(paramName, this.value);
                        });
                        
                        input.addEventListener('blur', function() {
                            previewKeyword();
                        });
                    });
                    
                    // 插入关键字
                    function insertKeyword() {
                        const values = {};
                        document.querySelectorAll('.parameter-input').forEach(input => {
                            const paramName = input.getAttribute('data-param-name');
                            values[paramName] = input.value;
                        });
                        
                        vscode.postMessage({
                            command: 'insertKeyword',
                            values: values
                        });
                    }
                    
                    // 预览关键字
                    function previewKeyword() {
                        const values = {};
                        document.querySelectorAll('.parameter-input').forEach(input => {
                            const paramName = input.getAttribute('data-param-name');
                            values[paramName] = input.value;
                        });
                        
                        vscode.postMessage({
                            command: 'previewKeyword',
                            values: values
                        });
                    }
                    
                    // 重置表单
                    function resetForm() {
                        document.querySelectorAll('.parameter-input').forEach(input => {
                            input.value = '';
                        });
                        document.getElementById('preview-section').style.display = 'none';
                    }
                    
                    // 监听来自扩展的消息
                    window.addEventListener('message', event => {
                        const message = event.data;
                        
                        switch (message.command) {
                            case 'validationResult':
                                const validationElement = document.querySelector(
                                    \`[data-param-name="\${message.paramName}"]\`
                                ).parentElement.querySelector('.parameter-validation');
                                
                                if (message.isValid) {
                                    validationElement.textContent = '✓';
                                    validationElement.className = 'parameter-validation valid';
                                } else {
                                    validationElement.textContent = '✗';
                                    validationElement.className = 'parameter-validation invalid';
                                    validationElement.title = message.message;
                                }
                                break;
                                
                            case 'previewResult':
                                const previewSection = document.getElementById('preview-section');
                                const previewCode = document.getElementById('preview-code');
                                previewCode.textContent = message.code;
                                previewSection.style.display = 'block';
                                break;
                        }
                    });
                    
                    // 初始预览
                    setTimeout(previewKeyword, 100);
                </script>
            </body>
            </html>
        `;
    }

    private async insertKeywordWithValues(keyword: Keyword, values: { [key: string]: string }): Promise<void> {
        const editor = vscode.window.activeTextEditor;
        if (!editor) {
            vscode.window.showWarningMessage('没有活动的编辑器');
            return;
        }

        // 生成关键字调用代码，支持远程服务器
        let keywordCall: string;
        if (keyword.remote && keyword.remote.alias) {
            keywordCall = `${keyword.remote.alias}|[${keyword.name}]`;
        } else {
            keywordCall = `[${keyword.name}]`;
        }
        
        if (keyword.parameters && keyword.parameters.length > 0) {
            const params = keyword.parameters
                .map(param => {
                    let value = values[param.name];
                    
                    // 如果用户没有填写值，但参数有默认值，使用默认值
                    if ((!value || value.trim() === '') && param.default !== undefined) {
                        if (typeof param.default === 'string') {
                            value = param.default;
                        } else {
                            value = String(param.default);
                        }
                    }
                    
                    // 如果仍然没有值，跳过这个参数
                    if (!value || value.trim() === '') {
                        return null;
                    }
                    
                    // 智能处理参数值的引号
                    if (param.name.toLowerCase().includes('配置') && value.startsWith('{')) {
                        // JSON配置，使用三重引号
                        return `${param.name}: '''\n${value}\n'''`;
                    } else if (value.includes('\n') || value.includes("'") || value.includes('"')) {
                        // 多行或包含引号的内容，使用三重引号
                        return `${param.name}: '''\n${value}\n'''`;
                    } else if (!value.startsWith('"') && !value.startsWith("'") && isNaN(Number(value))) {
                        // 字符串值，添加引号
                        return `${param.name}: "${value}"`;
                    } else {
                        // 数字或已经有引号的值
                        return `${param.name}: ${value}`;
                    }
                })
                .filter(param => param !== null)  // 过滤掉null值
                .join(', ');
            
            if (params) {
                keywordCall += `, ${params}`;
            }
        }

        // 插入到光标位置
        await editor.edit(editBuilder => {
            editBuilder.insert(editor.selection.active, keywordCall);
        });

        vscode.window.showInformationMessage(`已插入关键字: ${keyword.name}`);
    }

    private showPreview(panel: vscode.WebviewPanel, keyword: Keyword, values: { [key: string]: string }): void {
        // 生成预览代码
        let previewCode = `[${keyword.name}]`;
        
        if (keyword.parameters && keyword.parameters.length > 0) {
            const params = keyword.parameters
                .map(param => {
                    let value = values[param.name];
                    
                    // 如果用户没有填写值，但参数有默认值，使用默认值
                    if ((!value || value.trim() === '') && param.default !== undefined) {
                        if (typeof param.default === 'string') {
                            value = param.default;
                        } else {
                            value = String(param.default);
                        }
                    }
                    
                    // 如果仍然没有值，跳过这个参数
                    if (!value || value.trim() === '') {
                        return null;
                    }
                    
                    return `${param.name}: ${value}`;
                })
                .filter(param => param !== null)
                .join(', ');
            
            if (params) {
                previewCode += `, ${params}`;
            }
        }

        // 发送预览结果到webview
        panel.webview.postMessage({
            command: 'previewResult',
            code: previewCode
        });
    }

    private validateParameterValue(parameter: KeywordParameter | undefined, value: string): { isValid: boolean, message: string } {
        if (!parameter) {
            return { isValid: false, message: '未知参数' };
        }

        if (!value || value.trim() === '') {
            return { isValid: true, message: '' }; // 空值通常是允许的
        }

        // 基本验证规则
        if (parameter.name.toLowerCase().includes('url') && value) {
            try {
                new URL(value);
                return { isValid: true, message: '' };
            } catch {
                return { isValid: false, message: '无效的URL格式' };
            }
        }

        if (parameter.name.toLowerCase().includes('number') && value) {
            if (isNaN(Number(value))) {
                return { isValid: false, message: '必须是数字' };
            }
        }

        if (parameter.name.toLowerCase().includes('email') && value) {
            const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
            if (!emailRegex.test(value)) {
                return { isValid: false, message: '无效的邮箱格式' };
            }
        }

        return { isValid: true, message: '' };
    }

    private formatParameterDefaultValue(param: KeywordParameter): string {
        if (param.default !== undefined && param.default !== null) {
            if (typeof param.default === 'string') {
                return param.default;
            } else if (typeof param.default === 'boolean') {
                return param.default.toString();
            } else if (typeof param.default === 'number') {
                return param.default.toString();
            } else {
                return JSON.stringify(param.default);
            }
        }
        return '';
    }

    private getCategoryDisplayName(category: string): string {
        const categoryNames: { [key: string]: string } = {
            'builtin': '内置',
            'custom': '自定义',
            'remote': '远程'
        };
        return categoryNames[category] || category;
    }
}