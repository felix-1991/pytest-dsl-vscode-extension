# pytest-DSL VSCode 扩展

[![Version](https://img.shields.io/badge/version-0.1.1-blue.svg)](https://github.com/felix-1991/pytest-dsl-vscode-extension)
[![License](https://img.shields.io/badge/license-MIT-green.svg)](LICENSE)

一个强大的VSCode扩展，为pytest-DSL语言提供全面的开发支持，包括语法高亮、智能补全、关键字管理和可视化编辑器。

## ✨ 主要功能

### 🔧 核心功能
- **语法高亮**: 完整的pytest-DSL语法高亮支持
- **智能补全**: 基于关键字库的自动补全
- **关键字管理**: 分类浏览、搜索和收藏关键字
- **可视化编辑**: 图形化界面编辑关键字

### 📊 关键字浏览器
- **分层分类显示**: 按category自动分组（内置、自定义等）
- **收藏夹功能**: 标记常用关键字，快速访问
- **智能搜索**: 支持名称、分类、参数、说明的模糊搜索
- **树状结构**: 清晰的层级展示，支持展开/折叠

### 🔍 智能功能
- **参数模板生成**: 自动生成带参数的关键字模板
- **多种插入方式**: 仅插入名称或完整参数模板
- **上下文菜单**: 右键快速操作
- **快捷键支持**: 高效的键盘操作

### 📁 分类系统
- **内置关键字** (🔧): pytest-dsl核心关键字
- **自定义关键字** (🔍): 项目特定关键字
- **收藏夹** (⭐): 个人收藏的常用关键字

## 🚀 快速开始

### 安装
1. 在VSCode扩展市场搜索"pytest-DSL Support"
2. 点击安装并重新加载VSCode
3. 打开.dsl或.auto文件即可自动激活

### 配置关键字文件
扩展需要关键字JSON文件来提供智能功能。支持以下文件名：
- `keywords.json`
- `pytest-dsl-keywords.json` 
- `pytest_dsl_keywords.json`
- `.pytest-dsl-keywords.json`

### 生成关键字文件
如果项目中没有关键字文件，可以使用以下方式生成：

1. **命令面板**: `Ctrl+Shift+P` → "生成关键字JSON文件"
2. **右键菜单**: 在.dsl文件中右键选择相应选项
3. **关键字浏览器**: 点击工具栏中的刷新按钮

## 🎯 使用指南

### 关键字浏览器

扩展会在资源管理器中添加"pytest-DSL 关键字"面板，提供以下功能：

#### 浏览关键字
- 展开分类查看所有关键字
- 点击关键字预览详细信息
- 查看参数数量和来源信息

#### 搜索功能
- **智能搜索**: `Ctrl+Alt+S` (Mac: `Cmd+Alt+S`)
- **分类筛选**: `Ctrl+Alt+F` (Mac: `Cmd+Alt+F`)
- 支持关键字名称、说明、参数的模糊匹配

#### 收藏夹管理
- 右键关键字选择"切换收藏状态"
- 收藏的关键字显示在顶部收藏夹分类中
- 插入关键字时优先显示收藏项

### 插入关键字

#### 基本插入
- **快捷键**: `Ctrl+Alt+I` (Mac: `Cmd+Alt+I`)
- **命令面板**: "插入关键字"
- **右键菜单**: 在.dsl文件中右键选择

#### 智能插入
- **带参数模板**: `Ctrl+Alt+T` (Mac: `Cmd+Alt+T`)
- 自动生成完整的参数结构
- 使用VSCode的snippet功能，支持Tab键跳转

示例插入效果：
```dsl
HTTP请求[
    客户端=${1:default}
    配置=${2:请求配置}
    会话=${3:会话名称}
    保存响应=${4:响应变量名}
]
```

### 关键字管理

#### 查看关键字列表
- **快捷键**: `Ctrl+Alt+K` (Mac: `Cmd+Alt+K`)
- 分类展示所有可用关键字
- 显示参数数量和来源信息

#### 编辑关键字
- 在关键字浏览器中右键选择"编辑关键字"
- 使用可视化编辑器修改关键字定义
- 支持参数配置和文档编辑

#### 刷新缓存
- 修改关键字文件后自动检测更新
- 手动刷新: 命令面板 → "刷新关键字缓存"

## ⚙️ 配置选项

```json
{
  "pytest-dsl.pythonPath": "python",
  "pytest-dsl.projectRoot": "",
  "pytest-dsl.enableAutoCompletion": true,
  "pytest-dsl.cacheTimeout": 300,
  "pytest-dsl.keywordsJsonPath": "",
  "pytest-dsl.treeViewAutoExpand": true,
  "pytest-dsl.showParameterCount": true,
  "pytest-dsl.enableSmartInsert": true,
  "pytest-dsl.maxSearchResults": 50
}
```

### 配置说明
- `pythonPath`: Python解释器路径
- `projectRoot`: 项目根目录（留空自动检测）
- `enableAutoCompletion`: 启用自动补全
- `cacheTimeout`: 关键字缓存超时时间（秒）
- `keywordsJsonPath`: 关键字文件路径
- `treeViewAutoExpand`: 自动展开收藏夹分类
- `showParameterCount`: 显示参数数量
- `enableSmartInsert`: 启用智能插入
- `maxSearchResults`: 搜索结果最大数量

## 🎹 快捷键

| 功能 | Windows/Linux | macOS |
|------|---------------|-------|
| 显示关键字列表 | `Ctrl+Alt+K` | `Cmd+Alt+K` |
| 插入关键字 | `Ctrl+Alt+I` | `Cmd+Alt+I` |
| 智能搜索 | `Ctrl+Alt+S` | `Cmd+Alt+S` |
| 插入参数模板 | `Ctrl+Alt+T` | `Cmd+Alt+T` |
| 分类筛选 | `Ctrl+Alt+F` | `Cmd+Alt+F` |

## 📋 支持的关键字格式

扩展支持以下JSON格式的关键字定义：

```json
{
  "summary": {
    "total_count": 99,
    "category_counts": {
      "builtin": 18,
      "custom": 81
    }
  },
  "keywords": [
    {
      "name": "HTTP请求",
      "category": "builtin",
      "source_info": {
        "type": "builtin",
        "name": "pytest-dsl内置",
        "display_name": "pytest-dsl内置",
        "module": "pytest_dsl.keywords.http_keywords"
      },
      "parameters": [
        {
          "name": "客户端",
          "mapping": "client",
          "description": "客户端名称",
          "default": "default"
        }
      ],
      "documentation": "执行HTTP请求..."
    }
  ]
}
```

## 🔧 开发与贡献

### 本地开发
```bash
# 克隆仓库
git clone https://github.com/felix-1991/pytest-dsl-vscode-extension.git

# 安装依赖
npm install

# 编译
npm run compile

# 打包
npm run package
```

### 目录结构
```
src/
├── extension.ts          # 扩展主入口
├── keywordProvider.ts    # 关键字数据提供者
├── keywordTreeProvider.ts # 关键字树视图提供者
├── completionProvider.ts # 自动补全提供者
└── keywordEditor.ts      # 关键字编辑器
```

## 📝 更新日志

### v0.1.1 (最新)
- ✨ 新增关键字分类浏览器
- ✨ 添加收藏夹功能
- ✨ 智能搜索和过滤
- ✨ 参数模板自动生成
- ✨ 树状结构显示
- ✨ 上下文菜单支持
- 🔧 优化关键字加载性能
- 🔧 增强错误处理机制

### v0.1.0
- 🎉 初始版本发布
- 基础语法高亮
- 关键字自动补全
- 基本关键字管理

## 🤝 贡献指南

欢迎提交Issue和Pull Request！

1. Fork 这个仓库
2. 创建你的特性分支 (`git checkout -b feature/AmazingFeature`)
3. 提交你的更改 (`git commit -m 'Add some AmazingFeature'`)
4. 推送到分支 (`git push origin feature/AmazingFeature`)
5. 打开一个Pull Request

## 📄 许可证

本项目基于 MIT 许可证 - 查看 [LICENSE](LICENSE) 文件了解详情。

## 📧 联系方式

- **作者**: felix-1991
- **仓库**: [GitHub](https://github.com/felix-1991/pytest-dsl-vscode-extension)
- **问题反馈**: [Issues](https://github.com/felix-1991/pytest-dsl-vscode-extension/issues)

---

⭐ 如果这个扩展对你有帮助，请在GitHub上给个星标！