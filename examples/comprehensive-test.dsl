@name: "pytest-dsl综合功能示例"
@description: "展示pytest-dsl所有语法特性的综合测试文件"
@tags: ["example", "comprehensive", "api", "ui"]
@author: "pytest-dsl-extension"
@date: "2024-01-01"

# 导入远程服务器
@remote: "http://api-server:8270/" as api
@remote: "http://ui-server:8270/" as ui

# 全局变量定义
base_url = "https://api.example.com"
timeout = 30
retry_count = 3

# 环境变量引用
api_key = "${API_KEY}"
username = "${TEST_USER}"

# HTTP API测试
[打印], 内容: "开始API测试"

# 使用内置关键字
result = [HTTP请求], 客户端: "default", 配置: '''
    method: GET
    url: ${base_url}/health
    headers:
        Authorization: "Bearer ${api_key}"
    timeout: ${timeout}
    asserts:
        - ["status", "eq", 200]
        - ["jsonpath", "$.status", "eq", "ok"]
    captures:
        response_time: ["response_time"]
'''
[打印], 内容: 要打印的文本内容]

[打印], 内容: "API_KEY: ${api_key}"

# 远程服务器调用
api|[HTTP请求], 客户端: "default", 配置: '''
    method: POST
    url: /api/users
    request:
        json:
            name: "测试用户"
            email: "test@example.com"
    asserts:
        - ["status", "eq", 201]
        - ["jsonpath", "$.id", "exists"]
    captures:
        user_id: ["jsonpath", "$.id"]
'''

# 条件判断
if result.status_code == 200 do
    [打印], 内容: "API测试成功"
    
    # 使用远程UI服务器
    ui|[打开浏览器], 浏览器: "chrome", 无头模式: false
    ui|[访问页面], 地址: "${base_url}/users/${api_result.captures.user_id}"
    
    # 等待元素
    ui|[等待元素], 选择器: "#user-info", 超时: 10
    
    # 验证页面内容
    user_info = ui|[获取文本], 选择器: "#user-info"
    
    if user_info contains "测试用户" do
        [打印], 内容: "UI验证成功"
    else
        [打印], 内容: "UI验证失败", 级别: "ERROR"
    end
    
    ui|[关闭浏览器]
else
    [打印], 内容: "API测试失败，跳过UI测试", 级别: "WARNING"
end

# 循环处理
test_data = ["user1", "user2", "user3"]

for user in test_data do
    [打印], 内容: "处理用户: ${user}"
    
    # 批量创建用户
    api|[HTTP请求], 客户端: "default", 配置: '''
        method: POST
        url: /api/users
        request:
            json:
                name: "${user}"
                email: "${user}@example.com"
        asserts:
            - ["status", "eq", 201]
    '''
end

# 自定义关键字调用
[生成随机数], 最小值: 1, 最大值: 1000

# 字符串操作
[拼接字符串], 前缀: "测试", 中间: "-", 后缀: "完成"

# 文件操作
[写入文件], 路径: "test_results.txt", 内容: '''
测试执行结果:
- API测试: 成功
- UI测试: 成功  
- 批量用户创建: 成功
执行时间: ${result.captures.response_time}ms
'''

# 数据库操作示例
[执行SQL], 连接: "test_db", 语句: '''
    SELECT COUNT(*) as user_count 
    FROM users 
    WHERE created_at >= CURRENT_DATE
''', 结果变量: "user_count"

[打印], 内容: "今日创建用户数: ${user_count}"

# 最终清理
[打印], 内容: "测试完成，开始清理资源"

# 删除测试数据
api|[HTTP请求], 客户端: "default", 配置: '''
    method: DELETE
    url: /api/users/test-data
    asserts:
        - ["status", "eq", 204]
'''

[打印], 内容: "所有测试已完成" 