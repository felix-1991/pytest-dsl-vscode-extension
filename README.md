# pytest-DSL VSCode 扩展

这是一个为 pytest-DSL 语言提供支持的 VSCode 扩展，提供语法高亮、自动补全、关键字管理等功能。

## 功能特性

### 🎨 语法高亮
- 支持 `.dsl` 和 `.auto` 文件的语法高亮
- 高亮显示关键字、变量、注释、控制流等语法元素
- 支持元数据注解（@name、@description、@remote等）
- 支持远程服务器调用语法（alias|[关键字]）
- 支持三重引号字符串和YAML内联语法
- 支持变量引用和捕获语法高亮

### 🔧 关键字管理
- **显示关键字列表** (`Ctrl+Alt+K` / `Cmd+Alt+K`)
  - 查看所有可用的关键字
  - 按类别筛选（内置、自定义、远程）
  - 搜索和过滤功能
  
- **插入关键字** (`Ctrl+Alt+I` / `Cmd+Alt+I`)
  - 快速插入关键字到当前光标位置
  - 自动生成参数模板
  - 智能光标定位

- **可视化编辑器**
  - 图形化界面编辑关键字参数
  - 实时预览生成的代码
  - 参数验证和提示

### ⚡ 自动补全
- 输入 `[` 时自动触发关键字补全
- 支持远程服务器调用语法补全（alias|[关键字]）
- 智能参数补全和类型验证
- 支持代码片段和Tab跳转
- 内置丰富的代码片段模板

### 🔄 数据管理
- 从JSON文件读取关键字数据，提供稳定的关键字支持
- 支持生成关键字JSON文件
- 缓存关键字数据提高性能
- 支持手动刷新关键字缓存

## 安装要求

1. **VSCode** 1.74.0 或更高版本
2. **关键字JSON文件** - 项目根目录下需要有关键字JSON文件

## 安装方法

### 方法一：从源码安装

1. 克隆或下载此项目
2. 在项目目录中运行：
   ```bash
   npm install
   npm run compile
   ```
3. 在 VSCode 中按 `F5` 启动扩展开发主机
4. 或者打包安装：
   ```bash
   npm install -g vsce
   vsce package
   code --install-extension pytest-dsl-support-0.1.0.vsix
   ```

### 方法二：开发模式

1. 在 VSCode 中打开此项目
2. 按 `F5` 启动扩展开发主机
3. 在新窗口中测试扩展功能

## 配置选项

在 VSCode 设置中可以配置以下选项：

```json
{
  "pytest-dsl.pythonPath": "python",
  "pytest-dsl.projectRoot": "",
  "pytest-dsl.enableAutoCompletion": true,
  "pytest-dsl.cacheTimeout": 300,
  "pytest-dsl.keywordsJsonPath": "",
  "pytest-dsl.remoteServerEnabled": true,
  "pytest-dsl.yamlConfigSupport": true,
  "pytest-dsl.autoImportRemoteServers": false
}
```

### 配置说明

- `pythonPath`: Python 解释器路径，默认为 "python"
- `projectRoot`: pytest-dsl 项目根目录，留空则自动检测
- `enableAutoCompletion`: 是否启用自动补全，默认为 true
- `cacheTimeout`: 关键字缓存超时时间（秒），默认为 300
- `keywordsJsonPath`: 关键字JSON文件路径（相对于项目根目录），留空则自动查找
- `remoteServerEnabled`: 是否启用远程服务器支持，默认为 true
- `yamlConfigSupport`: 是否启用YAML配置支持，默认为 true  
- `autoImportRemoteServers`: 是否自动导入YAML文件中定义的远程服务器，默认为 false

## 使用方法

### 1. 查看关键字列表

- 使用快捷键 `Ctrl+Alt+K` (Windows/Linux) 或 `Cmd+Alt+K` (Mac)
- 或者在命令面板中搜索 "显示关键字列表"
- 选择关键字查看详细信息

### 2. 插入关键字

- 使用快捷键 `Ctrl+Alt+I` (Windows/Linux) 或 `Cmd+Alt+I` (Mac)
- 或者在命令面板中搜索 "插入关键字"
- 选择要插入的关键字，自动生成代码模板

### 3. 可视化编辑

- 在关键字列表中选择 "编辑关键字"
- 在图形界面中填写参数
- 点击 "插入到编辑器" 生成代码

### 4. 自动补全

- 在 `.dsl` 文件中输入 `[` 触发关键字补全
- 选择关键字后自动补全参数
- 使用 Tab 键在参数间跳转

### 5. 关键字数据管理

#### 数据来源

扩展只从项目根目录下的JSON文件读取关键字数据。如果找不到JSON文件，扩展会显示错误提示，指导用户创建关键字文件。

#### 支持的JSON文件名

扩展会自动查找以下文件名（按优先级排序）：
- `pytest-dsl-keywords.json`
- `keywords.json`
- `pytest_dsl_keywords.json`
- `.pytest-dsl-keywords.json`

#### 生成关键字JSON文件

如果您的项目中没有关键字JSON文件，可以通过以下方式生成：

1. 确保您的Python环境中已安装pytest-dsl
2. 在命令面板中搜索 "生成关键字JSON文件"
3. 扩展会执行 `pytest-dsl-list` 命令并将结果保存为JSON文件
4. 生成的文件将保存在项目根目录下

#### 自定义JSON文件路径

您可以在设置中指定自定义的JSON文件路径：

```json
{
  "pytest-dsl.keywordsJsonPath": "config/my-keywords.json"
}
```

#### JSON文件格式

关键字JSON文件应包含以下结构（参考 `example-keywords.json`）：

```json
{
  "summary": {
    "total_count": 总关键字数量,
    "category_counts": {
      "分类名": 该分类的关键字数量
    }
  },
  "keywords": [
    {
      "name": "关键字名称",
      "category": "关键字分类",
      "parameters": [
        {
          "name": "参数显示名",
          "mapping": "参数映射名",
          "description": "参数描述"
        }
      ],
      "documentation": "关键字说明文档",
      "remote": {
        "alias": "别名",
        "original_name": "原始名称"
      }
    }
  ]
}
```

## 示例

### DSL 文件示例

```dsl
@name: "HTTP请求测试"
@description: "测试HTTP请求功能"
@tags: ["http", "api"]

# 设置变量
base_url = "https://api.example.com"

# 发送HTTP请求
[HTTP请求], 客户端: default, 配置: {
    "request": {
        "method": "GET",
        "url": "${base_url}/users"
    },
    "assert": {
        "status_code": 200
    }
}

# 条件判断
if response.status_code == 200 do
    [打印], 内容: "请求成功"
else
    [打印], 内容: "请求失败"
end
```

## 故障排除

### 常见问题

1. **关键字列表为空**
   - 检查是否存在关键字JSON文件
   - 如果没有JSON文件，请使用"生成关键字JSON文件"命令创建
   - 确认 pytest-dsl 已正确安装（用于生成JSON文件）
   - 检查项目根目录配置

2. **自动补全不工作**
   - 确认文件扩展名为 `.dsl` 或 `.auto`
   - 检查自动补全设置是否启用
   - 尝试刷新关键字缓存

3. **生成关键字文件失败**
   - 检查 Python 路径配置
   - 确认 pytest-dsl-list 命令可用
   - 在dsl自动化项目根目录下执行 pytest-dsl-list命令生成keyword.json文件

### 调试方法

1. 打开 VSCode 开发者工具 (`Help > Toggle Developer Tools`)
2. 查看控制台输出
3. 检查扩展日志信息

## 开发贡献

欢迎提交 Issue 和 Pull Request！

### 开发环境设置

1. 克隆项目：
   ```bash
   git clone <repository-url>
   cd pytest-dsl-vscode-extension
   ```

2. 安装依赖：
   ```bash
   npm install
   ```

3. 编译代码：
   ```bash
   npm run compile
   ```

4. 启动开发：
   ```bash
   # 在 VSCode 中按 F5 启动扩展开发主机
   ```

### 项目结构

```
pytest-dsl-vscode-extension/
├── src/                    # TypeScript 源码
│   ├── extension.ts        # 扩展主入口
│   ├── keywordProvider.ts  # 关键字提供者
│   ├── completionProvider.ts # 自动补全提供者
│   └── keywordEditor.ts    # 可视化编辑器
├── syntaxes/              # 语法高亮定义
│   └── pytest-dsl.tmLanguage.json
├── out/                   # 编译输出
├── package.json           # 扩展配置
├── tsconfig.json          # TypeScript 配置
└── README.md             # 说明文档
```

## 测试扩展功能

### 测试正常工作流程

1. 确保项目根目录下有关键字JSON文件（如 `keywords.json`）
2. 打开一个 `.dsl` 文件
3. 按 `Ctrl+Alt+K` (或 `Cmd+Alt+K`) 查看关键字列表
4. 按 `Ctrl+Alt+I` (或 `Cmd+Alt+I`) 插入关键字

### 测试错误提示功能

1. 临时重命名或删除关键字JSON文件
2. 尝试使用关键字相关功能
3. 应该看到错误提示，提示创建关键字文件
4. 点击"生成关键字文件"按钮（需要pytest-dsl环境）

## 许可证

MIT License