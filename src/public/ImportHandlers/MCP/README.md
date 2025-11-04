# MCP (Model Context Protocol) 导入器

这个导入器允许你将 MCP 服务器配置导入为独立的 fount 插件。每个 MCP 服务器会成为一个单独的插件，可以独立启用或禁用。

## 特性

- ✅ **完整的 MCP 协议支持**：基于 mcp.el 实现，支持 MCP 2024-11-05 协议
- ✅ **多种资源类型**：支持 Tools、Prompts 和 Resources
- ✅ **XML 调用语法**：使用简洁的 XML 格式调用 MCP 功能
- ✅ **模板化架构**：使用 Template 文件夹，配置与代码分离
- ✅ **独立插件**：每个 MCP 服务器转换为独立插件，可单独管理

## 使用方法

### 1. 准备 MCP 配置文件

创建一个 JSON 配置文件，定义你的 MCP 服务器：

```json
{
  "mcpServers": {
    "filesystem": {
      "command": "npx",
      "args": [
        "-y",
        "@modelcontextprotocol/server-filesystem",
        "C:\\Users\\YourName\\Documents"
      ],
      "env": {
        "NODE_ENV": "production"
      }
    },
    "omniparser_autogui": {
      "command": "uv",
      "args": [
        "--directory",
        "D:\\CLONED_PATH\\omniparser-autogui-mcp",
        "run",
        "omniparser-autogui-mcp"
      ],
      "env": {
        "PYTHONIOENCODING": "utf-8",
        "OCR_LANG": "en"
      }
    }
  }
}
```

### 2. 导入配置

通过 fount 的安装界面（install shell）导入你的配置：

1. 打开 fount 安装界面（通常在 `/shells/install/`）
2. 选择文本导入或文件导入
3. 粘贴你的 JSON 配置或上传配置文件
4. 导入器会自动为每个服务器创建插件

### 3. 启用插件

导入后，每个 MCP 服务器会变成一个名为 `mcp_<服务器名>` 的插件。

## MCP 功能

### Tools（工具）

调用 MCP 工具来执行操作：

```xml
<mcp-tool name="read_file">
  <path>/path/to/file.txt</path>
</mcp-tool>
```

### Prompts（提示模板）

使用 MCP 服务器提供的提示模板：

```xml
<mcp-prompt name="code_review">
  <code>function hello() { console.log('Hello'); }</code>
  <language>javascript</language>
</mcp-prompt>
```

### Resources（资源）

读取 MCP 服务器暴露的资源：

```xml
<mcp-resource uri="file:///path/to/document.txt"/>
```

## 工作原理

### 架构设计

```text
src/public/ImportHandlers/MCP/
├── main.mjs              # 导入处理器
├── mcp_client.mjs        # MCP 客户端（参考 mcp.el）
├── Template/             # 插件模板文件夹
│   ├── main.mjs          # 插件主文件（加载 data.json）
│   └── data.json         # 插件配置数据（会被替换）
└── README.md
```

### 导入流程

1. 解析 MCP 配置 JSON
2. 为每个服务器复制 Template 文件夹
3. 生成 data.json 配置文件
4. 插件启动时加载配置并连接 MCP 服务器

### 插件生命周期

1. **Load**: 启动 MCP 客户端，初始化连接
2. **GetPrompt**: 向 AI 提供 Tools/Prompts/Resources 描述
3. **ReplyHandler**: 解析 XML 调用并执行
4. **Unload**: 停止 MCP 客户端

## MCP 客户端实现

基于优秀的 mcp.el 实现，支持：

- ✅ JSON-RPC 2.0 协议
- ✅ Stdio 连接方式
- ✅ 完整的初始化流程
  - initialize → initialized
  - 获取 capabilities
  - 列举 tools/prompts/resources
- ✅ 通知处理（notifications/message）
- ✅ 错误处理和超时机制

## AI 使用示例

### 使用文件系统工具

```text
AI: 让我读取那个文件的内容

<mcp-tool name="read_file">
  <path>C:\Users\User\Documents\notes.txt</path>
</mcp-tool>

我已经读取了文件内容...
```

### 使用提示模板

```text
AI: 让我用代码审查模板检查这段代码

<mcp-prompt name="code_review">
  <code>const x = 1; console.log(x)</code>
  <language>javascript</language>
</mcp-prompt>

根据模板的审查结果...
```

### 读取资源

```text
AI: 让我查看那个文档

<mcp-resource uri="file:///C:/docs/specification.md"/>

根据文档内容...
```

## 配置格式

### 完整配置示例

```json
{
  "mcpServers": {
    "server_name": {
      "command": "executable_name",
      "args": ["arg1", "arg2"],
      "env": {
        "VAR_NAME": "value"
      }
    }
  }
}
```

### 字段说明

- `command`: 启动 MCP 服务器的命令（必需）
- `args`: 命令参数数组（可选）
- `env`: 环境变量对象（可选）

## 常见 MCP 服务器

### 1. Filesystem Server

```json
{
  "mcpServers": {
    "filesystem": {
      "command": "npx",
      "args": [
        "-y",
        "@modelcontextprotocol/server-filesystem",
        "/allowed/directory"
      ]
    }
  }
}
```

### 2. SQLite Server

```json
{
  "mcpServers": {
    "sqlite": {
      "command": "npx",
      "args": [
        "-y",
        "@modelcontextprotocol/server-sqlite",
        "/path/to/database.db"
      ]
    }
  }
}
```

### 3. Python MCP Server

```json
{
  "mcpServers": {
    "python_tools": {
      "command": "python",
      "args": ["-m", "your_mcp_server"],
      "env": {
        "PYTHONIOENCODING": "utf-8"
      }
    }
  }
}
```

## 故障排除

### 插件无法启动

1. 检查 MCP 服务器命令和路径
2. 确认环境变量正确
3. 查看 fount 日志和 MCP stderr 输出
4. 验证 MCP 服务器程序已安装

### 工具调用失败

1. 确认工具名称和参数正确
2. 检查 MCP 服务器是否支持该工具
3. 查看错误消息了解详情

### 连接超时

1. 增加超时时间（当前 60 秒）
2. 检查 MCP 服务器启动时间
3. 确认服务器正常响应

## 技术细节

### MCP 协议版本

- 支持: `2024-11-05`
- 客户端: fount v0.0.1

### 通信方式

- Stdio（标准输入/输出）
- JSON-RPC 2.0

### 超时设置

- 请求超时: 60 秒
- 初始化等待: 2 秒

## 参考资料

- [MCP 官方文档](https://modelcontextprotocol.io/)
- [mcp.el](https://github.com/lizqwerscott/mcp.el) - 优秀的 Emacs MCP 客户端实现
- [MCP Servers 列表](https://github.com/modelcontextprotocol/servers)

## 更新日志

### v0.0.2

- ✅ 重构为 Template 方式
- ✅ 改进 MCP 客户端（参考 mcp.el）
- ✅ 添加 Prompts 和 Resources 支持
- ✅ 使用 XML 调用语法
- ✅ 完善初始化流程

### v0.0.1

- 初始版本
- 基础 Tools 支持
