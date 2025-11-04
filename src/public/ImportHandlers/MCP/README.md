# MCP (Model Context Protocol) 导入器

这个导入器允许你将 MCP 服务器配置导入为独立的 fount 插件。每个 MCP 服务器会成为一个单独的插件，可以独立启用或禁用。

## 功能

- 将 MCP 服务器配置转换为 fount 插件
- 每个 MCP 服务器作为独立插件运行
- 支持通过 stdio 与 MCP 服务器通信
- 自动将 MCP 工具暴露给 AI 角色
- 处理工具调用并将结果返回给 AI

## 使用方法

### 1. 准备 MCP 配置文件

创建一个 JSON 配置文件，定义你的 MCP 服务器：

```json
{
  "mcpServers": {
    "omniparser_autogui_mcp": {
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
4. 导入器会自动识别 MCP 配置并为每个服务器创建插件

### 3. 启用插件

导入后，每个 MCP 服务器会变成一个名为 `mcp_<服务器名>` 的插件。你可以：

- 在聊天设置中启用/禁用这些插件
- 为不同的聊天会话配置不同的 MCP 工具集

## 工作原理

### 插件生成

导入器会为每个 MCP 服务器生成一个插件，包含：

1. **main.mjs** - 插件主文件
2. **mcp_config.json** - MCP 服务器配置

### 与 AI 的集成

生成的插件实现了两个关键接口：

#### 1. `interfaces.chat.GetPrompt`

向 AI 提供可用工具的描述：

```
# Available MCP Tools from <服务器名>

You have access to the following tools...
```

#### 2. `interfaces.chat.ReplyHandler`

检测 AI 回复中的工具调用并执行：

```
AI 回复: "我将使用工具..."
```mcp-call
{
  "tool": "tool_name",
  "args": { ... }
}
```
```

插件会自动：
1. 解析工具调用
2. 执行 MCP 工具
3. 将结果添加到聊天上下文
4. 触发 AI 重新生成回复以整合结果

## MCP 客户端实现

导入器使用自定义的 MCP 客户端 (`mcp_client.mjs`)，它：

- 通过 stdio 与 MCP 服务器通信
- 支持 JSON-RPC 2.0 协议
- 实现 MCP 2024-11-05 协议版本
- 自动处理初始化和工具列表

## 配置格式

```typescript
{
  "mcpServers": {
    "<服务器名>": {
      "command": string,      // 启动命令
      "args": string[],       // 命令参数
      "env": {                // 环境变量（可选）
        "<变量名>": string
      }
    }
  }
}
```

## 故障排除

### 插件无法启动

- 确保 MCP 服务器的启动命令和路径正确
- 检查环境变量是否正确设置
- 查看 fount 日志中的错误信息

### 工具调用失败

- 确认 MCP 服务器支持请求的工具
- 检查工具参数是否符合要求
- 查看 MCP 服务器的 stderr 输出

## 架构说明

这个导入器遵循 fount 的"更解耦"设计原则：

- ✅ 每个 MCP 服务器是独立的插件
- ✅ 可以单独启用/禁用
- ✅ 不需要中心化的 MCP 管理器
- ✅ 易于安装和移除

## 注意事项

- MCP 服务器作为子进程运行（使用 `Deno.Command`）
- 每个插件在 Load 时启动其 MCP 服务器，在 Unload 时停止
- 工具调用有 30 秒超时限制
- 确保你的 MCP 服务器程序已正确安装且可执行

