import * as vscode from 'vscode';
import { KeywordProvider, Keyword } from './keywordProvider';

export class KeywordTreeProvider implements vscode.TreeDataProvider<TreeItem> {
    private _onDidChangeTreeData: vscode.EventEmitter<TreeItem | undefined | null | void> = new vscode.EventEmitter<TreeItem | undefined | null | void>();
    readonly onDidChangeTreeData: vscode.Event<TreeItem | undefined | null | void> = this._onDidChangeTreeData.event;

    private keywords: Keyword[] = [];
    private favorites: Set<string> = new Set();
    private searchQuery: string = '';
    private filterCategory: string = 'all';

    constructor(
        private keywordProvider: KeywordProvider,
        private context: vscode.ExtensionContext
    ) {
        this.loadFavorites();
    }

    refresh(): void {
        this.loadKeywords();
        this._onDidChangeTreeData.fire();
    }

    private async loadKeywords() {
        try {
            this.keywords = await this.keywordProvider.getKeywords();
        } catch (error) {
            console.error('加载关键字失败:', error);
            this.keywords = [];
        }
    }

    private loadFavorites() {
        const favoritesData = this.context.globalState.get<string[]>('pytest-dsl.favorites', []);
        this.favorites = new Set(favoritesData);
    }

    private async saveFavorites() {
        await this.context.globalState.update('pytest-dsl.favorites', Array.from(this.favorites));
    }

    getFavorites(): string[] {
        return Array.from(this.favorites);
    }

    async toggleFavorite(keywordName: string): Promise<void> {
        if (this.favorites.has(keywordName)) {
            this.favorites.delete(keywordName);
        } else {
            this.favorites.add(keywordName);
        }
        await this.saveFavorites();
        this.refresh();
    }

    setSearchQuery(query: string) {
        this.searchQuery = query.toLowerCase();
        this.refresh();
    }

    setFilterCategory(category: string) {
        this.filterCategory = category;
        this.refresh();
    }

    getTreeItem(element: TreeItem): vscode.TreeItem {
        return element;
    }

    getChildren(element?: TreeItem): Thenable<TreeItem[]> {
        if (!element) {
            return this.getRootItems();
        }

        if (element instanceof CategoryTreeItem) {
            return this.getCategoryChildren(element);
        }

        return Promise.resolve([]);
    }

    private async getRootItems(): Promise<TreeItem[]> {
        if (this.keywords.length === 0) {
            await this.loadKeywords();
        }

        const items: TreeItem[] = [];

        // 添加收藏夹分类（如果有收藏的关键字）
        const favoriteKeywords = this.getFilteredKeywords().filter(k => this.favorites.has(k.name));
        if (favoriteKeywords.length > 0) {
            items.push(new CategoryTreeItem(
                '收藏夹',
                'favorites',
                favoriteKeywords.length,
                vscode.TreeItemCollapsibleState.Expanded
            ));
        }

        // 按分类分组
        const categories = this.getCategories();
        for (const category of categories) {
            const categoryKeywords = this.getCategoryKeywords(category);
            if (categoryKeywords.length > 0) {
                const displayName = this.getCategoryDisplayName(category);
                items.push(new CategoryTreeItem(
                    displayName,
                    category,
                    categoryKeywords.length,
                    vscode.TreeItemCollapsibleState.Collapsed
                ));
            }
        }

        return items;
    }

    private async getCategoryChildren(categoryItem: CategoryTreeItem): Promise<TreeItem[]> {
        let keywords: Keyword[];

        if (categoryItem.categoryId === 'favorites') {
            keywords = this.getFilteredKeywords().filter(k => this.favorites.has(k.name));
        } else {
            keywords = this.getCategoryKeywords(categoryItem.categoryId);
        }

        return keywords.map(keyword => new KeywordTreeItem(keyword, this.favorites.has(keyword.name)));
    }

    private getFilteredKeywords(): Keyword[] {
        let filtered = this.keywords;

        // 应用搜索过滤
        if (this.searchQuery) {
            filtered = filtered.filter(keyword => 
                keyword.name.toLowerCase().includes(this.searchQuery) ||
                keyword.documentation?.toLowerCase().includes(this.searchQuery) ||
                keyword.parameters?.some(p => 
                    p.name.toLowerCase().includes(this.searchQuery) ||
                    p.description.toLowerCase().includes(this.searchQuery)
                )
            );
        }

        // 应用分类过滤
        if (this.filterCategory && this.filterCategory !== 'all') {
            filtered = filtered.filter(keyword => keyword.category === this.filterCategory);
        }

        return filtered;
    }

    private getCategories(): string[] {
        const filteredKeywords = this.getFilteredKeywords();
        const categories = [...new Set(filteredKeywords.map(k => k.category))];
        return categories.sort();
    }

    private getCategoryKeywords(category: string): Keyword[] {
        return this.getFilteredKeywords().filter(k => k.category === category);
    }

    private getCategoryDisplayName(category: string): string {
        switch (category) {
            case 'builtin':
                return '🔧 内置关键字';
            case 'custom':
                return '🔍 自定义关键字';
            case 'library':
                return '📚 库关键字';
            case 'user':
                return '👤 用户关键字';
            default:
                return `📁 ${category}`;
        }
    }
}

export abstract class TreeItem extends vscode.TreeItem {
    constructor(
        public readonly label: string,
        public readonly collapsibleState: vscode.TreeItemCollapsibleState
    ) {
        super(label, collapsibleState);
    }
}

export class CategoryTreeItem extends TreeItem {
    constructor(
        public readonly label: string,
        public readonly categoryId: string,
        public readonly count: number,
        collapsibleState: vscode.TreeItemCollapsibleState
    ) {
        super(label, collapsibleState);
        
        this.description = `${count} 个关键字`;
        this.contextValue = 'category';
        
        // 设置图标
        if (categoryId === 'favorites') {
            this.iconPath = new vscode.ThemeIcon('star-full');
        } else {
            this.iconPath = new vscode.ThemeIcon('folder');
        }
    }
}

export class KeywordTreeItem extends TreeItem {
    constructor(
        public readonly keyword: Keyword,
        public readonly isFavorite: boolean
    ) {
        super(keyword.name, vscode.TreeItemCollapsibleState.None);
        
        this.description = this.getDescription();
        this.tooltip = this.getTooltip();
        this.contextValue = 'keyword';
        
        // 设置图标
        if (isFavorite) {
            this.iconPath = new vscode.ThemeIcon('star-full');
        } else {
            this.iconPath = new vscode.ThemeIcon('symbol-method');
        }

        // 设置命令 - 点击时预览关键字
        this.command = {
            command: 'pytest-dsl.previewKeyword',
            title: '预览关键字',
            arguments: [this]
        };
    }

    private getDescription(): string {
        const paramCount = this.keyword.parameters ? this.keyword.parameters.length : 0;
        const sourceInfo = this.keyword.source_info?.display_name || '';
        return `${paramCount}参数 | ${sourceInfo}`;
    }

    private getTooltip(): string {
        const parts = [
            `关键字: ${this.keyword.name}`,
            `分类: ${this.keyword.category}`,
            `参数数量: ${this.keyword.parameters ? this.keyword.parameters.length : 0}`,
            `来源: ${this.keyword.source_info?.display_name || '未知'}`
        ];

        if (this.keyword.documentation) {
            const doc = this.keyword.documentation.split('\n')[0];
            if (doc.length > 100) {
                parts.push(`说明: ${doc.substring(0, 100)}...`);
            } else {
                parts.push(`说明: ${doc}`);
            }
        }

        if (this.keyword.parameters && this.keyword.parameters.length > 0) {
            const paramNames = this.keyword.parameters.slice(0, 3).map(p => p.name);
            if (this.keyword.parameters.length > 3) {
                paramNames.push('...');
            }
            parts.push(`参数: ${paramNames.join(', ')}`);
        }

        return parts.join('\n');
    }
} 