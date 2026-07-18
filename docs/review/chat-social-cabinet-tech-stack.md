# Chat / Social / Cabinet 技术栈审阅

最后核对：`2026-07-18`。对象：三壳**仍开放**的实现债——设计别扭点、死代码、可合并架构。**不是**产品差距（产品见同目录 gap 档）。证据以 import 图与代码阅读为准。

写法：[docs/AGENTS.md](../AGENTS.md)。

近期已落地、不再占篇幅：死符号清理（`fountMessageMarkdown*` / `mailboxApi` / `groupWsClient`）、可信 Markdown + 敏感媒体 + 展示名对齐、Hub `reloadChannel`、WS 出站 `hub/stream/outbound.mjs`、`jsonlInboxStore`。

---

## 结论摘要

| 优先级 | 动作 | 状态 |
| --- | --- | --- |
| P3 | 拆 Cabinet `public/index.mjs`（**1359** 行）、Social `composer.mjs`（**567** 行） | 待做 |
| P4 | ChatClient 按域拆方法工厂（对齐 SocialClient；现 `client.mjs` **494** 行单 duck） | 待做 |
| P5 | 收敛 view-log / raw 双读；导航补拉勿绕过 viewer 滤镜 | 待做 |
| P6 | 拆 `channelActionsContext` 可变单例；`threadDrawer` 与主区渲染路径合并 | 待做 |
| 小 | Hub 菜单手写 dismiss → `contextMenuDismiss`；composer 裸 `fetch` → `chatApi`；gesture 目录归并 | 待做 |
| 慎做 | Chat DAG ↔ Social Timeline 事件内核合并 | 大工程；联邦规则要统一改时再动 |

---

## 一、设计别扭（为何丑 · 如何改）

### 1. Chat HTTP 路由多处注册

**位置**：`main.mjs` 调 `setGroupEndpoints` + `setEndpoints`；后者再挂 `entity/endpoints.mjs`；另有 `stickers/endpoints.mjs`。

**为何丑**：查「这个 URL 谁挂的」要翻四处；与 `group/routes/*.mjs` 不对称。

**改进**：`main.mjs` 只调一个 `registerChatRoutes(router)` 内部分发；或从 `llms.txt` 生成机器可读路由表。

---

### 2. view-log vs raw 双读路径

**位置**：`GET …/view-log` vs `POST …/messages/batch-get`；Hub 主读 view-log，导航补拉走 raw（`channelMessageStore.ensureMessageLoaded` → `getChannelMessages`）。

**为何丑**：可见性过滤 / world·persona 钩子 / `hasMore` 只在 view-log 完整。跳转到被滤掉的父消息时，引用条更易显示 `…`。两条语义并存，bug 常出在「用错 API」。

**改进**：前端 `groupChannel.mjs` 只暴露 `getChannelViewLog`；raw 仅治理/审计内部使用；类型上区分 `ViewLogRow` / `RawDagRow`。导航补拉也应走 viewer 投影（或明确标注「可能越权于 viewer」）。

---

### 3. Cabinet 前端上帝文件

**位置**：`cabinet/public/index.mjs`（**1359** 行）

**为何丑**：单文件持有导航栈、选中态、解锁 token、历史、剪贴板、快捷键、远端浏览、属性面板、撤销删除等；与 Chat Hub 已拆成 `wiring/` / `sidebar/` / `messages/` 的风格反差极大。

**改进**：按 Hub 模式拆 `state.mjs` / `navigation.mjs` / `keyboard.mjs` / `entryGrid.mjs` / `remoteBrowse.mjs`；`index.mjs` 只 bootstrap。

---

### 4. Social composer 职责过载

**位置**：`social/public/src/composer.mjs`（**567** 行）

**为何丑**：发帖 UI、媒体、poll、群引用、定时、草稿入口、`uploadSocialMedia`、`visibilityPicker`、甚至裸 `fetch('/api/parts/shells:chat/groups/')` 全堆一处；同壳已有 `chatApi()`。

**改进**：抽出 `composerState.mjs` / `composerPublish.mjs`；群列表统一走 `chatApi`。对照 Chat 已拆的 `composerFiles` / `composerExtras` / `composerReply` / `messageSend`。

---

### 5. `channelActionsContext` 可变单例 + threadDrawer 平行渲染

**位置**：`hub/messages/messageActionsState.mjs`；`hub/threadDrawer.mjs`（**272** 行）也调 `setChannelMessageActionsContext` 并自管 `renderChannelMessageBlock`。

**为何丑**：与 Hub AGENTS「禁止 appContext 注入」原则相悖（主区/线程抽屉多态的例外），无类型、静默 `null` 时 `appendMessageToContext` 直接 return。抽屉与主区各走一套消息装配，改一处易漏另一处。

**改进**：显式 `mainChannelActions` / `threadDrawerActions` 两个导出，或按容器 `WeakMap` 绑定；抽屉复用主区 `messageRefresh` / virtual list 管道，只换 channelId。

---

### 6. 浏览器相对 import 路径地狱

**位置**：Hub AGENTS 用整段说明 `../src` vs `../../src` vs `/parts/shells:chat/...`

**为何丑**：Shell 挂在 `/parts/shells:chat/...` 下，相对路径错一层就 404 整图；Social 跨壳被迫用绝对 URL。

**改进**：中长期 import map / `@chat/hub/...` 别名；短期保持 AGENTS 文档即可。

---

### 7. Chat DAG ↔ Social Timeline 平行宇宙

**位置**：`chat/src/chat/dag/`（多 reducer）vs `social/src/timeline/`（`reducers` / `append` / `sync` / `materialize`）

**为何丑**：同为 append-only 事件 + reducer 物化 + 联邦 ingress，概念重叠但零共享；改 ingress 校验要改两套。

**改进**：仅当联邦规则要统一改时，再抽薄层 `EventLogStore { append, materialize, reducers }`。**短期不合并也可接受**——产品模型（群频道 vs 个人时间线）本就不同。

---

## 二、死代码与冗余

### 遗留 / 风格冗余

| 项 | 说明 |
| --- | --- |
| Social composer 裸 `fetch` chat groups | 同壳已有 `chatApi()`（`composer.mjs` ~L172） |
| Hub 部分菜单手写 dismiss | `search` / `friendsList` / `presence` / `pinsBookmarks` 仍手写 `document.addEventListener('click')`；AGENTS 已要求用 `contextMenuDismiss.mjs` |
| DAG `session_plugin_*` | legacy 事件 replay 为 no-op；`local_plugins.json` 已取代 |
| `stream/volatileSlots.mjs` ↔ gesture | 出站已进 `outbound.mjs`，volatile 仍耦合 `chatGestures.mjs` |

### 命名误导（非死代码）

- Social `display.mjs` 的 `renderMarkdown` 与 `pages/scripts/features/markdown` 的同名函数**签名不同**（Social 为薄包装；`authorLabel` 仍作导出别名，内部已委托 `resolveDisplayName`）
- `hub/messages/reactions.mjs`（wire）vs `messages/render/reactions.mjs`（HTML）同名不同责

---

## 三、可合并为更通用架构（不损功能）

### 已共享、应继续扩展

| 模块 | 路径 | 使用者 |
| --- | --- | --- |
| 头像 / hash 纹理 | `chat/public/shared/{hashAvatar,entityAvatar}.mjs` | Hub、Social、Cabinet |
| 人物卡 | `chat/public/shared/entityProfileCard.mjs` | 三壳 |
| 可信 Markdown | `chat/public/shared/trustedMarkdown.mjs` | Hub bio、Social posts/bio |
| 别名 | `chat/public/shared/aliases.mjs` | Hub、Social |
| @id | `shared/entityHash.mjs` → `formatEntityAtId` | 三壳 |
| AV relay | `shared/avRelayClient.mjs` | Hub call、Social live |
| inline token | `shared/inlineTokenSyntax.mjs` | Chat、Social composer |
| inbox JSONL | `chat/src/chat/lib/jsonlInboxStore.mjs` | Chat + Social inbox |
| 敏感媒体 | chat `messageFields.mjs`；Social `mediaRefs.mjs` 再导出 | 两壳 |

### 建议合并（按收益）

**F. Client 工厂共性（中）** — Social 的 `createPostsMethods` 组合式更清晰；Chat `src/api/client.mjs`（**494** 行）巨型 duck 可按域拆 `createGroupMethods` 等对齐。共享 `createShellJsonNamespace(username, shell, entityHash, dataName, shape)` 给私有状态命名空间。

**G. Composer 附加字段 UI（中）** — `contentWarning` / `sensitiveMedia` / `replyTo` 的 DOM 读写可共享薄层（Chat 已有拆分模板可作蓝本）。

**H. Gesture 目录（小）** — `chatGestures.mjs` 与 `emojiPickerGestures.mjs` → `hub/gestures/`。

### 故意不合

| 面 | 原因 |
| --- | --- |
| Social feed cursor 分页 vs Chat `MessagePipeline` 虚拟列表 | 产品模型不同（时间线游标 vs DAG eventId 锚点） |
| Chat DAG ↔ Social Timeline 全量内核 | 见 §1.7；成本高、短期收益低 |

---

## 四、分壳速览

| 壳 | 强 | 弱 |
| --- | --- | --- |
| **Chat** | 实体模型统一；Hub 已拆 `stream/`（含 outbound）+ `reloadChannel`；`shared/*` 跨壳复用；测试面大 | ChatClient 单文件膨胀；路由多处注册；view-log/raw 双读；threadDrawer 平行渲染 |
| **Social** | SocialClient 组合式 API；`chatApi` 避免重复路由；展示名/Markdown/敏感媒体已对齐 chat shared | `composer.mjs` 上帝模块；裸 fetch 群列表 |
| **Cabinet** | 后端 `shared/oplog.mjs` 清晰；与 Chat `cabinet_bind` 边界清楚；测试精简 | 前端 `index.mjs` 单文件承载几乎全部 UI |

---

## 关联

| 文档 | 关系 |
| --- | --- |
| [human-agent-operational-parity-review.md](./human-agent-operational-parity-review.md) | 平权开放缺陷 |
| [social-platform-gap-analysis.md](./social-platform-gap-analysis.md) | Social 产品残差 |
| [chat-vs-industrial-im-gap.md](./chat-vs-industrial-im-gap.md) | Chat 产品残差 |
| [chat-social-dev-plan.md](../design/chat-social-dev-plan.md) | 拓扑基线与未排期方向 |
