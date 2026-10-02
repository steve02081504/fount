# 通用插件的角色扩展

角色声明 `interfaces.plugins`，宿主通过 `src/scripts/plugin_context.mjs` 调用。扩展属于请求中的角色，不修改插件全局实例，成就 ID 与统计规则留在角色中。

```js
interfaces: {
  plugins: {
    async OnEvent(event, args) {
      if (event.status === 'succeeded') recordRoleStatistics(event)
    },
    GetServiceSource({ pluginName, serviceType }) {
      if (pluginName === 'web-browse' && serviceType === 'AI') return 'reader'
      if (pluginName === 'web-search' && serviceType === 'search') return mySearchSource
      // undefined：AI 继承 args.ai_source；搜索使用用户默认搜索源。
    },
    GetPrompt({ pluginName, ownerContext }) {
      return pluginName === 'file-operations' ? '角色目录：/path/to/char' : undefined
    },
  },
}
```

## 事件

事件结构是 `{ id, pluginName, type, status?, tool?, call?, data?, error? }`：

- `activated`：实际装配的插件，每请求在 BeforeReply 前通知一次。
- `tool`：管线处理调用的 `started`、`succeeded`、`failed`、`pending`。
- `background`：异步完成、计时器到期或浏览器/JS callback。

工具的 call 含标签、属性、正文。角色原生 handler、内部内容 handler 和失败后跳过的调用不发插件工具事件。实际执行的新调用有新 ID，重新生成并再次执行工具算新操作；复用同一 inline 求值缓存时复用事件 ID，不重复计数。流式 inline 求值可能早于 handler 分派；started 表示开始处理该调用，不是权限拦截点。观察者异常只报告，不改变工具结果。

后台注册返回 `pending: true`，不能记成成功。生产者向 `registerTask` 传入 `eventContext: args` 和 `meta: { pluginName, tool }`，结算时即使被 await 消费也会通知角色。持久通知的 `extension.pluginEvent` 带同一 ID。角色应持久化已计数 ID，防止历史通知或进程重启重复计数。

后台事件仍采用追加日志、shell 唤醒的调度方式。无唤醒接口时保存日志，角色之后读取频道时收到事件。计时器和浏览器来源标志保存在 extension 中，不恢复直接 GetReply 的并发重入路径。

## 服务源与主人提示

GetServiceSource 可返回源实例、短名称或 `serviceSources/<类型>/<名称>`。undefined/null 继承默认；明确配置的源缺失或接口无效时报错。现有消费者：web-browse 的 AI、web-search 的 search、sub-agent 的 AI；子代理标签/批次显式 ai-source 优先。其他插件可用同一解析器支持更多服务类型。

龙胆支持 `pluginServiceSources: { 'web-browse': { AI: 'reader' }, 'web-search': { search: 'engine' } }` 配置，同时保留既有 `AIsources['web-browse']` 专用源。未配置时遵循宿主默认。

code-execution、file-operations、browser-integration 使用 getPluginOwnerPrompt。主人取角色自签的 ownerEntityHash，消息须满足可信归因及作者匹配；未验证时提示保护拥有者的机器、文件、隐私和账号。角色附加提示收到同一 ownerContext。这是 prompt 引导，不新增执行权限门槛。

## 网页和代码

`<web-browse summarize="false">` 返回抓取后的 Markdown 原文，缺省为 AI 总结。自动 URL 预读只读元信息，通过 BeforeReply 持久固定，不调用 AI。

本机 run-js 与 inline-js 共享请求 workspace、chat_log、workdir 和插件 JS 上下文。相对 fs 路径仍相对进程目录，使用 workdir 构造绝对路径。fount-api 生成前准备密钥，JS 变量注入也确保首轮可用。

`<wait-screen machine="0" monitor="0">1</wait-screen>` 等待后捕获目标屏幕，图片写入工具日志；无显示环境或显示器不存在时报工具失败。附件通过共享 file_object.mjs 结合内容/名称推断 MIME、解析 HTTP Content-Disposition 文件名，并保留描述。
