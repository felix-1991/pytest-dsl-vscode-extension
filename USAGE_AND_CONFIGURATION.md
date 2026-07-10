# pytest-DSL VS Code 扩展使用与配置指南

本文说明当前扩展已经支持的语言能力、Python 环境配置、YAML 配置选择、单文件运行和步进调试方式。

## 1. 使用前准备

项目使用的 Python 环境中需要安装包含 workbench 调试能力的 `pytest-dsl`：

```bash
python -m pip install pytest-dsl
```

推荐在项目根目录创建 `.venv` 或 `venv`。扩展查找 Python 的顺序为：

1. `pytest-dsl.pythonPath` 明确配置的解释器；
2. 项目 `.venv`；
3. 项目 `venv`；
4. `PYTEST_DSL_PYTHON`、`PYTHON` 环境变量；
5. PATH 中的 `python3`、`python`，Windows 下还会尝试 `py -3`。

如果显式配置的解释器不可用，扩展不会悄悄改用其他解释器，而是直接提示配置错误。

## 2. 安装和打开项目

可以从 VS Code 扩展市场安装，也可以安装本地 VSIX：

```bash
code --install-extension pytest-dsl-support-0.3.0.vsix
```

使用 VS Code 打开 pytest-dsl 项目目录，然后打开以下任一文件：

- `.dsl`：可编辑、运行和调试；
- `.auto`：可编辑、运行和调试；
- `.resource`：可编辑并参与补全、悬停和定义跳转，但不能整文件运行。

## 3. 编辑器能力

扩展当前提供：

- DSL 语法高亮；
- 关键字、参数、`${...}` 变量和元数据补全；
- 关键字及变量悬停说明；
- 跳转到 `.resource`、Python 关键字或 YAML 变量定义；
- 未知关键字、缺失参数、重复参数和未闭合变量诊断；
- 关键字分类浏览、搜索、收藏和参数模板插入。

常用编辑快捷键：

| 功能 | Windows/Linux | macOS |
|---|---|---|
| 显示关键字 | `Ctrl+Alt+K` | `Cmd+Alt+K` |
| 插入关键字 | `Ctrl+Alt+I` | `Cmd+Alt+I` |
| 搜索关键字 | `Ctrl+Alt+S` | `Cmd+Alt+S` |
| 插入参数模板 | `Ctrl+Alt+T` | `Cmd+Alt+T` |

## 4. 选择 YAML 配置

打开 pytest-DSL 文件后，VS Code 状态栏会出现：

```text
Config: 自动
```

或者：

```text
Config: local
Config: base.yaml +2
```

点击状态栏项目即可打开配置选择器。

### 4.1 自动模式

`Config: 自动` 表示运行或调试时不传递 `--yaml-vars`，由 pytest-dsl 使用自身的默认配置加载规则。

在自动模式下，编辑器变量补全和定义跳转会使用项目根目录 `config/` 下的默认 YAML 文件。

“清除选择”应通过重新选择“自动使用 pytest-dsl 默认配置”完成。自动模式不等于完全禁用配置加载。

### 4.2 多选配置文件

选择“选择配置文件…”后，扩展会扫描：

```text
config/**/*.yaml
config/**/*.yml
```

以下目录会被忽略：

```text
.git
.venv
venv
node_modules
dist
build
.pytest_cache
__pycache__
```

扩展会尝试使用项目 Python 对 YAML 进行语法校验。发现语法错误时会显示错误原因并阻止使用；如果 Python 运行环境暂时不可用，则由后续 pytest-dsl 启动检查报告具体错误。

多个配置文件按照选择器中的显示顺序传给 pytest-dsl：

```bash
python -m pytest_dsl.cli tests/demo.dsl \
  --yaml-vars config/base.yaml \
  --yaml-vars config/local.yaml
```

后加载的配置可以覆盖前面文件中的同名顶层变量。

状态栏选择会保存在 VS Code 当前工作区状态中，不会自动修改 `.vscode/settings.json` 或项目文件。

### 4.3 配置方案

需要经常切换本地、测试、预发布等环境时，推荐在 `.vscode/settings.json` 中定义有序配置方案：

```json
{
  "pytest-dsl.configProfiles": {
    "local": [
      "config/base.yaml",
      "config/local.yaml"
    ],
    "test": [
      "config/base.yaml",
      "config/test.yaml",
      "config/remote_servers.yaml"
    ]
  },
  "pytest-dsl.activeConfigProfile": "local"
}
```

数组顺序就是 YAML 加载顺序。`activeConfigProfile` 仅在当前工作区尚未通过状态栏保存过选择时作为默认方案。

也可以通过命令面板执行：

```text
pytest-DSL: 管理配置方案
```

### 4.4 兼容 yamlVars

原有配置仍然支持：

```json
{
  "pytest-dsl.yamlVars": [
    "config/base.yaml",
    "config/local.yaml"
  ]
}
```

生效优先级为：

1. 状态栏保存的项目选择；
2. `activeConfigProfile` 指定的方案；
3. `yamlVars`；
4. pytest-dsl 自动加载。

## 5. 运行当前文件

运行前扩展会自动保存当前文件。

触发方式：

- 点击文件顶部 CodeLens 的“运行当前文件”；
- 点击编辑器标题区域的运行按钮；
- 编辑器右键选择“运行当前文件”；
- 命令面板执行 `pytest-DSL: 运行当前文件`；
- 使用快捷键 `Ctrl+F5`。

普通运行使用状态栏当前配置。

如果只想为本次运行临时选择配置，使用：

```text
pytest-DSL: 使用配置运行当前文件…
```

临时选择不会覆盖状态栏保存的项目默认选择。

## 6. 调试当前文件

扩展使用与 Pytest DSL Studio 相同的 `pytest_dsl.workbench.runner` 结构化调试协议。

开始调试：

- `F5`：从文件开始调试；
- `Alt+F5`：从光标所在行开始调试；
- 点击文件顶部“调试当前文件”；
- 点击 DSL 步骤上方“从此处调试”；
- 命令面板执行 `pytest-DSL: 调试当前文件`。

从指定行调试时，该行之前的步骤仍会正常执行，只是不暂停。

暂停后的控制：

| 操作 | 快捷键 | 说明 |
|---|---|---|
| 下一步 | `F10` | 执行当前步骤并在下一步暂停 |
| 继续 | `F5` | 后续步骤不再逐步暂停 |
| 停止 | `Shift+F5` | 终止当前运行或调试任务 |

调试暂停时，当前 DSL 行会高亮，状态栏会出现“单步”“继续”“停止”按钮。

单次选择配置调试使用：

```text
pytest-DSL: 使用配置调试当前文件…
```

## 7. 查看运行输出

打开：

```text
查看 → 输出 → pytest-DSL
```

输出面板会显示：

- 项目根目录；
- 当前配置方案及 YAML 加载顺序；
- 实际 Python 解释器；
- 完整执行命令；
- pytest-dsl 标准输出和错误输出；
- 关键字跟踪信息；
- 调试步骤和最终退出状态。

示例：

```text
项目: /workspace/demo
配置: local
  1. config/base.yaml
  2. config/local.yaml
Python: /workspace/demo/.venv/bin/python
命令: /workspace/demo/.venv/bin/python -m pytest_dsl.cli tests/demo.dsl --yaml-vars config/base.yaml --yaml-vars config/local.yaml
```

## 8. 推荐项目配置

常规单项目推荐：

```json
{
  "pytest-dsl.pythonPath": "",
  "pytest-dsl.projectRoot": "",
  "pytest-dsl.configProfiles": {
    "local": [
      "config/base.yaml",
      "config/local.yaml"
    ],
    "test": [
      "config/base.yaml",
      "config/test.yaml"
    ]
  },
  "pytest-dsl.activeConfigProfile": "local",
  "pytest-dsl.enableExecutionCodeLens": true,
  "pytest-dsl.enableAutoCompletion": true
}
```

需要指定项目解释器时：

```json
{
  "pytest-dsl.pythonPath": "/workspace/demo/.venv/bin/python"
}
```

Windows 示例：

```json
{
  "pytest-dsl.pythonPath": "C:\\workspace\\demo\\.venv\\Scripts\\python.exe"
}
```

多根工作区会根据当前活动 DSL 文件选择对应工作区目录；如需覆盖，可在对应工作区文件夹范围配置 `pytest-dsl.projectRoot`。

## 9. 常见问题

### 找不到安装了 pytest-dsl 的 Python

确认目标环境可以执行：

```bash
python -c "import pytest_dsl; import pytest_dsl.workbench.runner"
```

然后将该解释器写入 `pytest-dsl.pythonPath`，或者把虚拟环境放在项目 `.venv`/`venv`。

### 配置文件不存在

扩展会在执行前拦截缺失路径。检查配置方案路径是否相对于 `pytest-dsl.projectRoot`。

### YAML 配置修改后补全没有刷新

保存 YAML 文件后重新触发补全；也可以执行：

```text
pytest-DSL: 刷新项目配置文件
```

### `.resource` 为什么不能运行

`.resource` 是关键字和资源定义文件，不是完整测试入口。它参与编辑、补全和跳转，但整文件运行仅支持 `.dsl` 与 `.auto`。

### F5 被其他调试扩展占用

确保当前活动编辑器语言为 pytest-DSL。也可以通过 CodeLens、编辑器右键或命令面板显式启动。
