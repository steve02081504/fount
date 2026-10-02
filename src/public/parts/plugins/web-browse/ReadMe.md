# Web browse

`BeforeReply` 还会扫描最近二十条有效上下文中的图片附件，每次最多五张新图片，使用本地解码器识别多个二维码（包括反色二维码），不调用 AI。识别出的文字持久进入上下文；其中 HTTP(S) 链接同轮自动进入下述元信息预读，重复链接只抓取一次。图片以内容 SHA-256 去重，未发现二维码和识别失败也保存状态；同图换名、重生成或重启不会重复解析。单图上限 20 MiB，解码时最长边缩放到 2048 像素。图片识别和链接抓取分别计入各自的每轮上限，剩余链接会在后续生成继续预读。

`BeforeReply` 预读最近五条用户/角色消息中新提及的 HTTP(S) 链接，每次最多五个。预读只抓取标题、描述、Open Graph / Twitter 标签、图标及文件响应头；不调用 AI。每个响应限时五秒，最多读取 1 MiB。结果通过 `AddLongTimeLog` 同时进入本轮 `chat_log` 和持久历史；稳定 ID 及 `extension.pluginData['web-browse'].urls` 防止跨生成重复抓取，失败也记入历史。原始消息和资料与元信息均保留，界面使用代码围栏展示外部文本。

主动工具默认使用角色指定的 AI 服务源，未指定时继承当前生成的 `args.ai_source`：

```xml
<web-browse>
  <url>https://example.com/page</url>
  <question>网页说明了哪些限制？</question>
</web-browse>
```

摘要只含网页正文、问题及总结指令，不携带角色历史或其他工具。没有可用 AI 时注明并返回原文；配置错误、抓取失败和摘要失败会报告工具错误。

使用 `summarize="false"`（或 `"0"`）跳过 AI，获取抓取并清理后的 Markdown 正文；仍应用输出大小护栏，超限原文保存到文件。

```xml
<web-browse summarize="false">
  <url>https://example.com/page</url>
</web-browse>
```

角色服务源覆盖通过 `interfaces.plugins.GetServiceSource({ pluginName, serviceType, ...args })` 返回实例或服务部件名。此插件请求 `pluginName: 'web-browse', serviceType: 'AI'`；`web-search` 请求 `serviceType: 'search'`，默认使用用户默认搜索源。
