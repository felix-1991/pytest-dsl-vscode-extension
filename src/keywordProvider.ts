import * as vscode from 'vscode';
import { exec } from 'child_process';
import * as path from 'path';
import * as fs from 'fs';

export interface KeywordParameter {
    name: string;
    mapping: string;
    description: string;
    default?: any;
}

export interface Keyword {
    name: string;
    category: string;
    parameters: KeywordParameter[];
    documentation?: string;
    remote?: {
        alias: string;
        original_name: string;
    };
}

export interface KeywordData {
    summary: {
        total_count: number;
        category_counts: { [key: string]: number };
    };
    keywords: Keyword[];
}

export class KeywordProvider {
    private cache: Keyword[] | null = null;
    private cacheTimestamp: number = 0;
    private readonly cacheTimeout: number;

    constructor(private context: vscode.ExtensionContext) {
        this.cacheTimeout = this.getCacheTimeout();
    }

    private getCacheTimeout(): number {
        const config = vscode.workspace.getConfiguration('pytest-dsl');
        return config.get<number>('cacheTimeout', 300) * 1000; // 转换为毫秒
    }

    private getPythonPath(): string {
        const config = vscode.workspace.getConfiguration('pytest-dsl');
        return config.get<string>('pythonPath', 'python');
    }

    private getProjectRoot(): string {
        const config = vscode.workspace.getConfiguration('pytest-dsl');
        const configuredRoot = config.get<string>('projectRoot', '');
        
        if (configuredRoot) {
            return configuredRoot;
        }

        // 自动检测项目根目录
        const workspaceFolders = vscode.workspace.workspaceFolders;
        if (workspaceFolders && workspaceFolders.length > 0) {
            const workspaceRoot = workspaceFolders[0].uri.fsPath;
            
            // 检查是否存在pytest-dsl相关文件
            const indicators = ['pyproject.toml', 'setup.py', 'requirements.txt'];
            for (const indicator of indicators) {
                const indicatorPath = path.join(workspaceRoot, indicator);
                if (fs.existsSync(indicatorPath)) {
                    return workspaceRoot;
                }
            }
            
            return workspaceRoot;
        }

        return process.cwd();
    }

    private getKeywordsJsonFilePath(): string {
        const config = vscode.workspace.getConfiguration('pytest-dsl');
        const customPath = config.get<string>('keywordsJsonPath', '');
        
        if (customPath) {
            return path.isAbsolute(customPath) ? customPath : path.join(this.getProjectRoot(), customPath);
        }

        // 默认在项目根目录下查找常见的文件名
        const projectRoot = this.getProjectRoot();
        const possibleNames = [
            'pytest-dsl-keywords.json',
            'keywords.json',
            'pytest_dsl_keywords.json',
            '.pytest-dsl-keywords.json'
        ];

        for (const name of possibleNames) {
            const filePath = path.join(projectRoot, name);
            if (fs.existsSync(filePath)) {
                return filePath;
            }
        }

        // 如果都不存在，返回默认路径
        return path.join(projectRoot, 'pytest-dsl-keywords.json');
    }

    private async readKeywordsFromFile(): Promise<Keyword[]> {
        const filePath = this.getKeywordsJsonFilePath();
        
        if (!fs.existsSync(filePath)) {
            throw new Error(`关键字JSON文件不存在: ${filePath}`);
        }

        try {
            const fileContent = fs.readFileSync(filePath, 'utf8');
            const data: KeywordData = JSON.parse(fileContent);
            
            if (!data.keywords || !Array.isArray(data.keywords)) {
                throw new Error('无效的关键字数据格式');
            }

            console.log(`从文件读取到 ${data.keywords.length} 个关键字: ${filePath}`);
            return data.keywords;
        } catch (error) {
            throw new Error(`读取关键字文件失败: ${error}`);
        }
    }

    async getKeywords(): Promise<Keyword[]> {
        // 检查缓存是否有效
        const now = Date.now();
        if (this.cache && (now - this.cacheTimestamp) < this.cacheTimeout) {
            return this.cache;
        }

        try {
            const keywords = await this.fetchKeywords();
            this.cache = keywords;
            this.cacheTimestamp = now;
            return keywords;
        } catch (error) {
            console.error('获取关键字失败:', error);
            
            // 如果有缓存，返回缓存的数据
            if (this.cache) {
                vscode.window.showWarningMessage('获取最新关键字失败，使用缓存数据');
                return this.cache;
            }
            
            throw error;
        }
    }

    private async fetchKeywords(): Promise<Keyword[]> {
        try {
            // 优先尝试从JSON文件读取
            return await this.readKeywordsFromFile();
        } catch (fileError) {
            console.log('从文件读取关键字失败:', fileError);
            
            // 检查是否是文件不存在的错误
            const jsonFilePath = this.getKeywordsJsonFilePath();
            if (!fs.existsSync(jsonFilePath)) {
                // 获取项目根目录用于错误提示
                const projectRoot = this.getProjectRoot();
                const possibleNames = [
                    'pytest-dsl-keywords.json',
                    'keywords.json', 
                    'pytest_dsl_keywords.json',
                    '.pytest-dsl-keywords.json'
                ];
                
                const errorMessage = `未找到关键字JSON文件！\n\n请在项目根目录 (${projectRoot}) 下创建以下任一文件：\n${possibleNames.map(name => `- ${name}`).join('\n')}\n\n您可以使用命令面板中的"生成关键字JSON文件"功能来创建文件。`;
                
                vscode.window.showErrorMessage(errorMessage, '打开项目根目录', '生成关键字文件').then(selection => {
                    if (selection === '打开项目根目录') {
                        vscode.env.openExternal(vscode.Uri.file(projectRoot));
                    } else if (selection === '生成关键字文件') {
                        vscode.commands.executeCommand('pytest-dsl.generateKeywordsFile');
                    }
                });
                
                throw new Error(`未找到关键字JSON文件。请在项目根目录下创建关键字文件：${possibleNames.join(', ')}`);
            }
            
            // 如果是其他读取错误，直接抛出
            throw fileError;
        }
    }

    async refreshKeywords(): Promise<void> {
        this.cache = null;
        this.cacheTimestamp = 0;
        await this.getKeywords();
    }

    getKeywordByName(name: string): Keyword | undefined {
        if (!this.cache) {
            return undefined;
        }
        return this.cache.find(keyword => keyword.name === name);
    }

    getKeywordsByCategory(category: string): Keyword[] {
        if (!this.cache) {
            return [];
        }
        return this.cache.filter(keyword => keyword.category === category);
    }

    searchKeywords(query: string): Keyword[] {
        if (!this.cache) {
            return [];
        }

        const lowerQuery = query.toLowerCase();
        return this.cache.filter(keyword => 
            keyword.name.toLowerCase().includes(lowerQuery) ||
            (keyword.documentation && keyword.documentation.toLowerCase().includes(lowerQuery)) ||
            keyword.parameters.some(param => 
                param.name.toLowerCase().includes(lowerQuery) ||
                param.description.toLowerCase().includes(lowerQuery)
            )
        );
    }

    async validateEnvironment(): Promise<boolean> {
        // 只检查是否存在JSON文件
        const jsonFilePath = this.getKeywordsJsonFilePath();
        if (fs.existsSync(jsonFilePath)) {
            console.log('找到关键字JSON文件，环境验证通过');
            return true;
        }

        console.log('未找到关键字JSON文件');
        return false;
    }

    // 新增方法：生成关键字JSON文件
    async generateKeywordsFile(): Promise<void> {
        try {
            // 直接执行命令获取关键字
            const keywords = await this.executeKeywordCommand();
            const data: KeywordData = {
                summary: {
                    total_count: keywords.length,
                    category_counts: {}
                },
                keywords: keywords
            };

            // 计算分类统计
            for (const keyword of keywords) {
                if (!data.summary.category_counts[keyword.category]) {
                    data.summary.category_counts[keyword.category] = 0;
                }
                data.summary.category_counts[keyword.category]++;
            }

            const jsonContent = JSON.stringify(data, null, 2);
            const filePath = this.getKeywordsJsonFilePath();
            
            fs.writeFileSync(filePath, jsonContent, 'utf8');
            console.log(`关键字JSON文件已生成: ${filePath}`);
            
            vscode.window.showInformationMessage(`关键字文件已生成: ${path.basename(filePath)}`);
        } catch (error) {
            console.error('生成关键字文件失败:', error);
            vscode.window.showErrorMessage(`生成关键字文件失败: ${error}`);
            throw error;
        }
    }

    private async executeKeywordCommand(): Promise<Keyword[]> {
        return new Promise((resolve, reject) => {
            const pythonPath = this.getPythonPath();
            const projectRoot = this.getProjectRoot();
            
            // 构建命令
            const command = `cd "${projectRoot}" && ${pythonPath} -m pytest_dsl.cli list-keywords --format json`;
            
            console.log('执行命令:', command);

            exec(command, { 
                cwd: projectRoot,
                timeout: 30000, // 30秒超时
                maxBuffer: 1024 * 1024 * 10 // 10MB缓冲区
            }, (error, stdout, stderr) => {
                if (error) {
                    console.error('命令执行错误:', error);
                    console.error('stderr:', stderr);
                    reject(new Error(`执行pytest-dsl-list失败: ${error.message}\n\n请确保：\n1. Python环境中已安装pytest-dsl\n2. 当前目录是pytest-dsl项目根目录\n3. pytest-dsl-list命令可用`));
                    return;
                }

                try {
                    // 查找JSON开始位置（跳过可能的日志输出）
                    const jsonStart = stdout.indexOf('{');
                    if (jsonStart === -1) {
                        throw new Error('未找到有效的JSON输出');
                    }

                    const jsonOutput = stdout.substring(jsonStart);
                    const data: KeywordData = JSON.parse(jsonOutput);
                    
                    if (!data.keywords || !Array.isArray(data.keywords)) {
                        throw new Error('无效的关键字数据格式');
                    }

                    console.log(`通过命令获取到 ${data.keywords.length} 个关键字`);
                    resolve(data.keywords);
                } catch (parseError) {
                    console.error('解析JSON失败:', parseError);
                    console.error('原始输出:', stdout);
                    reject(new Error(`解析关键字数据失败: ${parseError}`));
                }
            });
        });
    }
}