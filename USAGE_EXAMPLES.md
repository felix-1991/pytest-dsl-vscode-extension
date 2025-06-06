# pytest-DSL VSCode 扩展使用示例

## 🚀 快速开始示例

### 1. 基本关键字浏览

#### 打开关键字浏览器
在VSCode资源管理器中，您会看到"pytest-DSL 关键字"面板：

```
📁 pytest-DSL 关键字
├── ⭐ 收藏夹 (3个关键字)
│   ├── 🔧 HTTP请求
│   ├── 🔧 JSON断言  
│   └── 🔍 点击元素
├── 🔧 内置关键字 (18个关键字)
│   ├── 🔧 HTTP请求
│   ├── 🔧 JSON提取
│   ├── 🔧 JSON断言
│   └── ...
└── 🔍 自定义关键字 (81个关键字)
    ├── 🔍 上传文件
    ├── 🔍 保存认证状态
    └── ...
```

#### 查看关键字详情
点击任意关键字，会在右侧打开详情面板，显示：
- 关键字名称和分类
- 参数列表和说明
- 使用示例
- 来源信息

### 2. 智能搜索示例

#### 搜索HTTP相关关键字
1. 按 `Ctrl+Alt+S` (Mac: `Cmd+Alt+S`) 打开搜索
2. 输入 "HTTP"
3. 看到匹配结果：

```
🔍 搜索结果 (3个匹配)
├── 🔧 HTTP请求 [内置关键字] pytest-dsl内置
│   └── 参数: 8个 | 执行HTTP请求...
├── 🔍 HTTP上传文件 [自定义关键字] pytest-dsl  
│   └── 参数: 4个 | 上传文件到HTTP服务器...
└── 🔍 HTTP下载文件 [自定义关键字] pytest-dsl
    └── 参数: 3个 | 从HTTP服务器下载文件...
```

#### 选择操作
选择关键字后，可以选择操作：
- 📥 插入关键字
- 📥 插入带参数模板  
- 👁️ 查看详情
- 📝 编辑关键字
- ⭐ 添加到收藏夹

### 3. 关键字插入示例

#### 基本插入
使用 `Ctrl+Alt+I` 插入关键字：

**插入前**:
```dsl
# 发送GET请求获取用户信息
|
```

**选择"HTTP请求"关键字后**:
```dsl  
# 发送GET请求获取用户信息
HTTP请求|
```

#### 参数模板插入
使用 `Ctrl+Alt+T` 插入带参数的模板：

**插入前**:
```dsl
# 发送GET请求获取用户信息  
|
```

**选择"HTTP请求"关键字后**:
```dsl
# 发送GET请求获取用户信息
HTTP请求[
    客户端=${1:default}
    配置=${2:请求配置}
    会话=${3:会话名称} 
    保存响应=${4:响应变量名}
    禁用授权=${5:false}
    模板=${6:模板名称}
    断言重试次数=${7:0}
    断言重试间隔=${8:1}
]|
```

使用Tab键可以在参数间跳转。

### 4. 收藏夹管理示例

#### 添加收藏
1. 在关键字浏览器中右键点击"HTTP请求"
2. 选择"切换收藏状态"
3. 关键字会显示⭐图标并出现在收藏夹分类中

#### 使用收藏的关键字
插入关键字时，收藏的关键字会优先显示：

```
🔍 选择要插入的关键字 (⭐ 表示收藏)
├── ⭐ HTTP请求 [内置关键字]
├── ⭐ JSON断言 [内置关键字] 
├── ⭐ 点击元素 [自定义关键字]
├── 🔧 JSON提取 [内置关键字]
└── ...
```

## 📝 实际项目示例

### 项目结构
```
my-dsl-project/
├── keywords.json          # 关键字定义文件
├── tests/
│   ├── login.dsl         # 登录测试用例
│   ├── api_test.dsl      # API测试用例  
│   └── ui_test.dsl       # UI测试用例
└── config/
    └── environments.yaml  # 环境配置
```

### 示例：编写登录测试用例

#### 1. 创建新的DSL文件
创建 `tests/login.dsl`

#### 2. 使用关键字浏览器
在关键字浏览器中展开分类，查看可用的关键字

#### 3. 编写测试用例
```dsl
@name: "用户登录测试"
@description: "测试用户登录功能"
@tags: ["login", "ui"]

# 打开登录页面
导航到页面[
    URL=https://example.com/login
]

# 输入用户名
输入文本[
    定位器=input[name="username"]
    文本=testuser
]

# 输入密码  
输入文本[
    定位器=input[name="password"]
    文本=testpass
]

# 点击登录按钮
点击元素[
    定位器=button[type="submit"]
]

# 验证登录成功
元素应该可见[
    定位器=.welcome-message
    超时时间=10
]
```

#### 4. 使用智能搜索
- 搜索"输入" → 找到"输入文本"关键字
- 搜索"点击" → 找到"点击元素"关键字  
- 搜索"验证" → 找到各种断言关键字

#### 5. 使用参数模板
对于复杂的关键字，使用参数模板功能：

按 `Ctrl+Alt+T`，选择"HTTP请求"：
```dsl
HTTP请求[
    客户端=default
    配置={
        "request": {
            "method": "POST",
            "url": "/api/login",
            "json": {
                "username": "testuser",
                "password": "testpass"
            }
        },
        "assert": {
            "status_code": 200,
            "jsonpath": {
                "$.success": true
            }
        }
    }
    保存响应=login_response
]
```

### 示例：API测试用例

#### 使用收藏夹快速访问
将常用的API相关关键字添加到收藏夹：
- HTTP请求
- JSON提取  
- JSON断言
- 等待条件

#### 编写API测试
```dsl
@name: "用户API测试"
@description: "测试用户管理API"

# 获取用户列表
HTTP请求[
    客户端=api_client
    配置={
        "request": {
            "method": "GET", 
            "url": "/api/users"
        },
        "assert": {
            "status_code": 200
        }
    }
    保存响应=users_response
]

# 提取第一个用户ID
JSON提取[
    JSON数据=${users_response}
    JSONPath=$.data[0].id
    变量名=first_user_id
]

# 获取用户详情
HTTP请求[
    客户端=api_client
    配置={
        "request": {
            "method": "GET",
            "url": "/api/users/${first_user_id}"
        },
        "assert": {
            "status_code": 200
        }
    }
    保存响应=user_detail
]

# 验证用户信息
JSON断言[
    JSON数据=${user_detail}
    JSONPath=$.data.id
    预期值=${first_user_id}
    操作符===
]
```

## 🎯 高级使用技巧

### 1. 自定义关键字分类
如果您有自己的关键字库，确保在JSON文件中正确设置category：

```json
{
  "name": "我的自定义关键字",
  "category": "custom",
  "source_info": {
    "type": "custom",
    "display_name": "我的库"
  }
}
```

### 2. 批量操作
- 使用分类筛选功能快速找到特定类型的关键字
- 在搜索结果中使用多次操作
- 利用收藏夹管理常用关键字集合

### 3. 参数模板自定义
可以在设置中配置参数模板的格式：

```json
{
  "pytest-dsl.enableSmartInsert": true,
  "pytest-dsl.parameterPlaceholderFormat": "${index}:{description}"
}
```

### 4. 性能优化
- 定期清理无效的收藏项
- 设置合适的缓存超时时间
- 限制搜索结果数量以提升响应速度

## 📚 更多示例

### 数据驱动测试
```dsl
@name: "数据驱动登录测试"
@parameterize: [
  {"username": "user1", "password": "pass1", "expected": true},
  {"username": "user2", "password": "pass2", "expected": false}
]

# 登录测试参数化
HTTP请求[
    客户端=web_client
    配置={
        "request": {
            "method": "POST",
            "url": "/login",
            "json": {
                "username": "${username}",
                "password": "${password}"
            }
        }
    }
    保存响应=login_result
]

# 条件验证
如果 ${expected} == true 则执行[
    JSON断言[
        JSON数据=${login_result}
        JSONPath=$.success
        预期值=true
    ]
]否则[
    JSON断言[
        JSON数据=${login_result}
        JSONPath=$.success
        预期值=false
    ]
]
```

### 复杂UI交互
```dsl
@name: "复杂表单填写"

# 使用收藏的关键字快速编写
点击元素[定位器=.add-user-btn]
等待元素可见[定位器=#user-form]

输入文本[定位器=#name, 文本=张三]
输入文本[定位器=#email, 文本=zhangsan@example.com]

选择下拉选项[
    定位器=#department
    选项标签=技术部
]

上传文件[
    定位器=#avatar-upload
    文件路径=./test-data/avatar.jpg
]

点击元素[定位器=#save-btn]
等待元素可见[定位器=.success-message]
```

---

💡 **提示**: 这些示例展示了如何有效使用新功能来提高pytest-DSL开发效率。您可以根据项目需求调整和扩展这些示例。 