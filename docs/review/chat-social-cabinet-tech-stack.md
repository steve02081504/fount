# Chat / Social / Cabinet 技术栈审阅

最后核对：`2026-07-18`。对象：三壳**仍开放**的实现债——设计别扭点、死代码、可合并架构。**不是**产品差距（产品见同目录 gap 档）。证据以 import 图与代码阅读为准。

写法：[docs/AGENTS.md](../AGENTS.md)。

近期已落地、不再占篇幅：死符号清理、可信 Markdown + 敏感媒体 + 展示名对齐、Hub `reloadChannel`、WS 出站 `hub/stream/outbound.mjs`、`jsonlInboxStore`；view-log 导航补拉；Social `composerState`/`composerPublish` + `chatApi`、`friendsList` dismiss、`hub/gestures/`；ChatClient 按域拆工厂、`registerChatRoutes`、search/pins dismiss 对齐、`channelActions` 主区/线程分槽；Cabinet 前端按 Hub 模式拆分；`volatileSlots` 解耦 gesture；**本波**：threadDrawer 复用 `messageSurface`（MessagePipeline + bind）、`composerAttachmentFields`（CW/sensitive）、Social `mutedKeywords` → `createShellJsonNamespace`、`reactionWire` / `renderTrustedPostMarkdown` 命名消歧。

---

## 结论摘要

| 优先级 | 动作 | 状态 |
| --- | --- | --- |
| P3 | 拆 Cabinet `public/index.mjs`；Social composer 已拆 | **已落地** |
| P4 | ChatClient 按域拆方法工厂（对齐 SocialClient） | **已落地** |
| P5 | 收敛 view-log / raw 双读；导航补拉勿绕过 viewer 滤镜 | **已落地** |
| P6 | 收敛 `channelActionsContext`；threadDrawer 复用消息面管道 | **已落地**（分槽 + `messageSurface` / thread MessagePipeline） |
| 小 | Hub dismiss 统一；CW/sensitive 薄层；命名消歧；mutedKeywords namespace | **已落地** |
| 慎做 | Chat DAG ↔ Social Timeline 事件内核合并 | 大工程；联邦规则要统一改时再动 |

---

## 一、设计别扭（为何丑 · 如何改）

### 1. Chat HTTP 路由多处注册 — 最小已落地

`main.mjs` 只调 `registerChatRoutes(router)`（内部分发 `setGroupEndpoints` + `setEndpoints`）；stickers 导出已改为 `registerStickerRoutes`。深度扁平化 / 机器可读路由表仍可选。

---

### 2. view-log vs raw 双读路径 — 已落地

Hub 主读 `GET …/view-log`；导航/编辑补拉 `POST …/view-log/batch-get`（`getChannelViewLogByEventIds` / `ensureMessageLoaded`）。Raw `GET …/messages` / `POST …/messages/batch-get` / `pin-context` 仅治理/审计。

---

### 3. Cabinet 前端 — 已拆

`index.mjs` 仅 bootstrap；`cabinetStore`（`state.mjs`）+ 域模块；`keyboard.mjs` 仍为纯快捷键匹配。

---

### 4. Social composer — 已拆

`composerState.mjs` + `composerPublish.mjs` + 薄 `composer.mjs` barrel；CW/sensitive DOM 读写走 chat `shared/composerAttachmentFields.mjs`。

---

### 5. `channelActionsContext` + threadDrawer 渲染 — 已落地

主区 / 线程抽屉分槽；线程经 `messages/messageSurface.mjs`（`createMessageSurfacePipeline` + `bindMessageSurface`）复用主区 MessagePipeline / paint·bind，不再手写 `replaceChildren` 全量循环。

---

### 6. 浏览器相对 import 路径地狱

**位置**：Hub AGENTS 用整段说明 `../src` vs `../../src` vs `/parts/shells:chat/...`

**为何丑**：Shell 挂在 `/parts/shells:chat/...` 下，相对路径错一层就 404 整图；Social 跨壳被迫用绝对 URL。

**改进**：中长期 import map / `@chat/hub/...` 别名；短期保持 AGENTS 文档即可。

---

### 7. Chat DAG ↔ Social Timeline 平行宇宙

**位置**：`chat/src/chat/dag/` vs `social/src/timeline/`

**为何丑**：同为 append-only 事件 + reducer 物化 + 联邦 ingress，概念重叠但零共享。

**改进**：仅当联邦规则要统一改时，再抽薄层 `EventLogStore`。**短期不合并也可接受**。

---

## 二、死代码与冗余

### 遗留 / 风格冗余

| 项 | 说明 |
| --- | --- |
| DAG `session_plugin_*` | legacy 事件 replay 为 no-op；`local_plugins.json` 已取代（不可删 reducer，历史 DAG 需 replay） |
| `stream/volatileSlots` ↔ gesture | **已解** |

### 命名（本波已消歧）

- Social `display.renderTrustedPostMarkdown`（`renderMarkdown` 暂留别名）
- Hub `messages/reactionWire.mjs`（点击委托）vs `messages/render/reactions.mjs`（HTML）

---

## 三、可合并为更通用架构（不损功能）

### 已共享、应继续扩展

| 模块 | 路径 | 使用者 |
| --- | --- | --- |
| 头像 / hash 纹理 | `chat/public/shared/{hashAvatar,entityAvatar}.mjs` | Hub、Social、Cabinet |
| 人物卡 | `chat/public/shared/entityProfileCard.mjs` | 三壳 |
| 可信 Markdown | `chat/public/shared/trustedMarkdown.mjs` | Hub bio、Social posts/bio |
| Composer CW/sensitive | `chat/public/shared/composerAttachmentFields.mjs` | Hub、Social |
| 别名 | `chat/public/shared/aliases.mjs` | Hub、Social |
| @id | `shared/entityHash.mjs` → `formatEntityAtId` | 三壳 |
| AV relay | `shared/avRelayClient.mjs` | Hub call、Social live |
| inline token | `shared/inlineTokenSyntax.mjs` | Chat、Social composer |
| inbox JSONL | `chat/src/chat/lib/jsonlInboxStore.mjs` | Chat + Social inbox |
| 敏感媒体 | chat `messageFields.mjs`；Social `mediaRefs.mjs` 再导出 | 两壳 |
| shell JSON 命名空间 | `chat/src/api/client/helpers.mjs` → `createShellJsonNamespace` | Chat + Social `mutedKeywords` |

### 建议合并（按收益）

（本波 G/F 已落地。）replyTo / quoteRef UI 硬合并仍不建议（产品模型不同）。

### 故意不合

| 面 | 原因 |
| --- | --- |
| Social feed cursor 分页 vs Chat `MessagePipeline` 虚拟列表 | 产品模型不同 |
| Chat DAG ↔ Social Timeline 全量内核 | 见 §1.7 |

---

## 四、分壳速览

| 壳 | 强 | 弱 |
| --- | --- | --- |
| **Chat** | 实体模型统一；Hub 已拆 stream/gestures；view-log 主读+补拉；ChatClient 工厂；channelActions 分槽；thread 复用 messageSurface；`shared/*` 跨壳复用 | — |
| **Social** | SocialClient 组合式；composer 已拆；CW/sensitive 与 mutedKeywords 对齐 chat helpers | （本波无新增大债） |
| **Cabinet** | 后端 oplog 清晰；前端已拆 cabinetStore + 域模块 | — |

---

## 关联

| 文档 | 关系 |
| --- | --- |
| [human-agent-operational-parity-review.md](./human-agent-operational-parity-review.md) | 平权开放缺陷 |
| [social-platform-gap-analysis.md](./social-platform-gap-analysis.md) | Social 产品残差 |
| [chat-vs-industrial-im-gap.md](./chat-vs-industrial-im-gap.md) | Chat 产品残差 |
| [chat-social-dev-plan.md](../design/chat-social-dev-plan.md) | 拓扑基线与未排期方向 |
