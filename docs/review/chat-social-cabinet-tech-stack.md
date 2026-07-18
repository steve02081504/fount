# Chat / Social / Cabinet 技术栈审阅

最后核对：`2026-07-18`。对象：三壳实现债——设计别扭点、死代码、可合并架构。**不是**产品差距（产品见同目录 gap 档）。证据以 import 图与代码阅读为准。

写法：[docs/AGENTS.md](../AGENTS.md)。

---

## 结论摘要

| 优先级 | 动作 | 收益 |
| --- | --- | --- |
| P0 | 删 `fountMessageMarkdown*.mjs`、`mailboxApi.mjs`（零引用） | 去混淆 |
| P1 | 合并 `resolveSensitiveMedia` + 可信 Markdown 挂载 + Social `authorLabel`→`resolveDisplayName` | 消双份维护 |
| P2 | Chat WS 出站并入 `hub/stream/`；去掉 `messageRefresh` 的 `loadMessages` 参数套娃 | 降认知负担 |
| P3 | 拆 Cabinet `public/index.mjs`（~1300 行）、Social `composer.mjs`（~530 行） | 可维护性 |
| P4 | ChatClient 按域拆方法工厂（对齐 SocialClient）；inbox 存储原语抽取 | 架构收敛 |
| 慎做 | Chat DAG ↔ Social Timeline 事件内核合并 | 大工程；联邦规则要统一改时再动 |

---

## 一、设计别扭（为何丑 · 如何改）

### 1. Hub 消息刷新：自己传自己

**位置**：`hub/messages/messages.mjs` → `messageRefresh.mjs`（~450 行）→ `messageVirtualList.mjs` / `channelMessageStore.mjs`

**为何丑**：每个导出把 `loadMessages` 和 `syncCtx`（内部再调 `syncChannelActionsContext(loadMessages)`）层层下传，形成「自己传自己」的递归依赖。查「谁真正刷新 DOM」要跳 3–4 层。

**改进**：模块级绑定 `reloadChannel`（ESM 循环 import 已允许），子模块只 `import { reloadChannel }`，去掉每层 `(loadMessages, syncCtx)` 参数。

---

### 2. Chat 双 WebSocket 出站层

**位置**：
- `public/src/groupWsClient.mjs` — `setActiveWebSocket` / `sendWebsocketMessage` / `reportTyping` / `stopGeneration`
- `hub/stream/connection.mjs` — 连接生命周期 + wire 分发

**为何丑**：`connection.mjs` 建连后仍 `setActiveWebSocket(socket)` 喂旧单例；typing / stop 走 `groupWsClient`，channel_message 走 `handlers/`。同一物理 socket 两套入口。

**改进**：废弃 `groupWsClient` 全局，出站 API 迁入 `hub/stream/outbound.mjs`；调用方改为从 `stream/` 导入。

---

### 3. Chat HTTP 路由三处注册

**位置**：`src/endpoints.mjs`、`src/group/endpoints.mjs`、`src/entity/endpoints.mjs`

**为何丑**：查「这个 URL 谁挂的」要翻三个文件；与 `group/routes/*.mjs` 不对称。

**改进**：`main.mjs` 只调一个 `registerChatRoutes(router)` 内部分发；或从 `llms.txt` 生成机器可读路由表。

---

### 4. view-log vs raw messages 双读路径

**位置**：`GET …/view-log` vs `GET …/messages`；Hub 主读 view-log，导航补拉可能打 raw

**为何丑**：可见性过滤 / world·persona 钩子 / `hasMore` 只在 view-log 完整。两条语义并存，bug 常出在「用错 API」。

**改进**：前端 `groupChannel.mjs` 只暴露 `getChannelViewLog`；raw 仅 `channelMessageStore.ensureMessageLoaded` 内部使用；类型上区分 `ViewLogRow` / `RawDagRow`。

---

### 5. Cabinet 前端上帝文件

**位置**：`cabinet/public/index.mjs`（~**1300** 行）

**为何丑**：单文件持有导航栈、选中态、解锁 token、历史、剪贴板、快捷键、远端浏览、属性面板、撤销删除等；与 Chat Hub 已拆成 `wiring/` / `sidebar/` / `messages/` 的风格反差极大。

**改进**：按 Hub 模式拆 `state.mjs` / `navigation.mjs` / `keyboard.mjs` / `entryGrid.mjs` / `remoteBrowse.mjs`；`index.mjs` 只 bootstrap。

---

### 6. Social composer 职责过载

**位置**：`social/public/src/composer.mjs`（~**530** 行）

**为何丑**：发帖 UI、媒体、poll、群引用、定时、草稿入口、`uploadSocialMedia`、`visibilityPicker`、甚至裸 `fetch('/api/parts/shells:chat/groups/')` 全堆一处；同壳已有 `chatApi()`。

**改进**：抽出 `composerState.mjs` / `composerPublish.mjs`；群列表统一走 `chatApi`。对照 Chat 已拆的 `composerFiles` / `composerExtras` / `composerReply` / `messageSend`。

---

### 7. `channelActionsContext` 可变单例

**位置**：`hub/messages/messageActionsState.mjs`

**为何丑**：与 Hub AGENTS「禁止 appContext 注入」原则相悖（主区/线程抽屉多态的例外），无类型、静默 `null` 时 `appendMessageToContext` 直接 return。

**改进**：显式 `mainChannelActions` / `threadDrawerActions` 两个导出，或按容器 `WeakMap` 绑定。

---

### 8. 浏览器相对 import 路径地狱

**位置**：Hub AGENTS 用整段说明 `../src` vs `../../src` vs `/parts/shells:chat/...`

**为何丑**：Shell 挂在 `/parts/shells:chat/...` 下，相对路径错一层就 404 整图；Social 跨壳被迫用绝对 URL。

**改进**：中长期 import map / `@chat/hub/...` 别名；短期保持 AGENTS 文档即可。

---

### 9. Chat DAG ↔ Social Timeline 平行宇宙

**位置**：`chat/src/chat/dag/`（多 reducer）vs `social/src/timeline/`（`reducers` / `append` / `sync` / `materialize`）

**为何丑**：同为 append-only 事件 + reducer 物化 + 联邦 ingress，概念重叠但零共享；改 ingress 校验要改两套。

**改进**：仅当联邦规则要统一改时，再抽薄层 `EventLogStore { append, materialize, reducers }`。**短期不合并也可接受**——产品模型（群频道 vs 个人时间线）本就不同。

---

### 10. 死符号与文档/代码不同步风险

**位置**：`fountMessageMarkdown.mjs` 仍在仓库，但 `paintEntityProfileBio` / Hub 消息渲染均已直调 `renderMarkdownAsString`；Hub AGENTS 已写对路径。

**为何丑**：留着零引用模块会引诱后来者「从旧入口接」，再写出第二套 sanitize 管线。

**改进**：删死文件（见 §二）；信任模型以 `hub/AGENTS.md` + `public/AGENTS.md` 现行为准，勿再发明并行 markdown 入口。

---

## 二、死代码与冗余

### 已验证死代码（全仓库零外部引用）

| 路径 | 符号 | 证据 |
| --- | --- | --- |
| `chat/public/src/lib/fountMessageMarkdown.mjs` + `fountMessageMarkdownPlugins.mjs` | `processFountMessageMarkdown` | 仅互相引用；现用 `pages/scripts/features/markdown` + `hub/messages/render/markdown.mjs` + `paintEntityProfileBio` |
| `chat/public/src/api/mailboxApi.mjs` | `fetchMailboxSummary` | 零 import；后端 `endpoints/mailbox.mjs` 与 live 测直接打 HTTP，Hub 从未展示 pendingCount |

**处置**：删文件；若要做联邦 pending 横幅，再接 API，勿留空壳。

### 逐字重复（双份维护）

| 逻辑 | A | B |
| --- | --- | --- |
| `resolveSensitiveMedia` | `chat/public/shared/messageFields.mjs` | `social/src/lib/mediaRefs.mjs`（实现相同） |
| 可信 Markdown 挂载 | `paintEntityProfileBio` | Social `display.mjs` 的 `renderMarkdown` / `mountMarkdown` |
| 展示名 | `shared/nameResolve.mjs` → `resolveDisplayName` | Social `authorLabel`（fallback 格式不一致：`entityHashLabel` vs `formatHashShort(8,4)`） |

### 遗留 / 风格冗余

| 项 | 说明 |
| --- | --- |
| `groupWsClient.mjs` | 与 `stream/connection.mjs` 重叠，属未删干净的旧出站层 |
| Social composer 裸 `fetch` chat groups | 同壳已有 `chatApi()` |
| Hub 部分菜单手写 dismiss | `search` / `friendsList` / `presence` / `pinsBookmarks` 仍手写 `document.addEventListener('click')`；AGENTS 已要求用 `contextMenuDismiss.mjs` |
| DAG `session_plugin_*` | legacy 事件 replay 为 no-op；`local_plugins.json` 已取代 |

### 命名误导（非死代码）

- Social `display.mjs` 的 `renderMarkdown` 与 `pages/scripts/features/markdown` 的同名函数**签名不同**
- `hub/messages/reactions.mjs`（wire）vs `messages/render/reactions.mjs`（HTML）同名不同责

---

## 三、可合并为更通用架构（不损功能）

### 已共享、应继续扩展

| 模块 | 路径 | 使用者 |
| --- | --- | --- |
| 头像 / hash 纹理 | `chat/public/shared/{hashAvatar,entityAvatar}.mjs` | Hub、Social、Cabinet |
| 人物卡 | `chat/public/shared/entityProfileCard.mjs` | 三壳 |
| 别名 | `chat/public/shared/aliases.mjs` | Hub、Social |
| @id | `shared/entityHash.mjs` → `formatEntityAtId` | 三壳 |
| AV relay | `shared/avRelayClient.mjs` | Hub call、Social live |
| inline token | `shared/inlineTokenSyntax.mjs` | Chat、Social composer |

### 建议合并（按收益）

**A. 可信 Markdown（小）** — `chat/public/shared/trustedMarkdown.mjs`：

```js
export async function renderTrustedMarkdownHtml(markdown, authorHash, trustCtx)
export async function mountTrustedMarkdown(host, markdown, authorHash, trustCtx)
```

删除 Social `display.mjs` 内重复；`paintEntityProfileBio` 内部调用同一实现。

**B. `resolveSensitiveMedia`（小）** — Social `mediaRefs.mjs` 改为从 `messageFields.mjs` 再导出或直引。

**C. 展示名（小）** — Social `authorLabel` → 薄包装 `resolveDisplayName(...)`，消除 fallback 分叉。

**D. Inbox 存储原语（中）** — Chat `lib/inbox.mjs` 与 Social `inbox.mjs` 同为 `{userDict}/shells/{shell}/inbox/{entityHash}/events.jsonl` + `read.json`。抽 `appendJsonl` / `getSeenAt` / `setSeenAt`；各自保留 `derive*Row` 与通知聚合（Social 更复杂）。

**E. Chat WS 出站合一（中）** — 见 §1.2。

**F. Client 工厂共性（中）** — Social 的 `createPostsMethods` 组合式更清晰；Chat `src/api/client.mjs` 巨型 duck 可按域拆 `createGroupMethods` 等对齐。共享 `createShellJsonNamespace(username, shell, entityHash, dataName, shape)` 给私有状态命名空间。

**G. Composer 附加字段 UI（中）** — `contentWarning` / `sensitiveMedia` / `replyTo` 的 DOM 读写可共享薄层（Chat 已有拆分模板可作蓝本）。

**H. Gesture 目录（小）** — `chatGestures.mjs`（末条角色消息滑切分支 + 右滑回复；由 `messageVirtualList` / `volatileSlots` 调用）与 `emojiPickerGestures.mjs` → `hub/gestures/`。

### 故意不合

| 面 | 原因 |
| --- | --- |
| Social feed cursor 分页 vs Chat `MessagePipeline` 虚拟列表 | 产品模型不同（时间线游标 vs DAG eventId 锚点） |
| Chat DAG ↔ Social Timeline 全量内核 | 见 §1.9；成本高、短期收益低 |

---

## 四、分壳速览

| 壳 | 强 | 弱 |
| --- | --- | --- |
| **Chat** | 实体模型统一；Hub 已拆 `stream/handlers`、`messages/actions`；`shared/*` 跨壳复用；测试面大 | 消息刷新回调链；WS 双层；ChatClient 单文件膨胀；路由三处注册 |
| **Social** | SocialClient 组合式 API；`chatApi` 避免重复路由；联邦文档齐 | `composer.mjs` 上帝模块；`display.mjs` 与 chat shared 重复 |
| **Cabinet** | 后端 `shared/oplog.mjs` 清晰；与 Chat `cabinet_bind` 边界清楚；测试精简 | 前端 `index.mjs` 单文件承载几乎全部 UI |

---

## 关联

| 文档 | 关系 |
| --- | --- |
| [human-agent-operational-parity-review.md](./human-agent-operational-parity-review.md) | 平权开放缺陷 |
| [social-platform-gap-analysis.md](./social-platform-gap-analysis.md) | Social 产品残差 |
| [chat-vs-industrial-im-gap.md](./chat-vs-industrial-im-gap.md) | Chat 产品残差 |
| [chat-social-dev-plan.md](../design/chat-social-dev-plan.md) | 拓扑基线与未排期方向 |
