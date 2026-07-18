# Chat / Social / Cabinet 技术栈审阅

最后核对：`2026-07-18`。对象：三壳**仍开放**的实现债——设计别扭点、死代码、可合并架构。**不是**产品差距（产品见同目录 gap 档）。证据以 import 图与代码阅读为准。

写法：[docs/AGENTS.md](../AGENTS.md)。

近期已落地、不再占篇幅：死符号清理、可信 Markdown + 敏感媒体 + 展示名对齐、Hub `reloadChannel`、WS 出站 `hub/stream/outbound.mjs`、`jsonlInboxStore`；view-log 导航补拉；Social `composerState`/`composerPublish` + `chatApi`、`friendsList` dismiss、`hub/gestures/`；ChatClient 按域拆工厂、`registerChatRoutes`、search/pins dismiss 对齐、`channelActions` 主区/线程分槽；**本波**：Cabinet 前端按 Hub 模式拆分（`cabinetStore` + 域模块）、`volatileSlots` 去掉对 gestures 的直接依赖。

---

## 结论摘要

| 优先级 | 动作 | 状态 |
| --- | --- | --- |
| P3 | 拆 Cabinet `public/index.mjs`；Social composer 已拆 | **已落地**（`cabinet/public/src/{state,navigation,…}`） |
| P4 | ChatClient 按域拆方法工厂（对齐 SocialClient） | **已落地**（`src/api/client/*.mjs`） |
| P5 | 收敛 view-log / raw 双读；导航补拉勿绕过 viewer 滤镜 | **已落地** |
| P6 | 收敛 `channelActionsContext`；`threadDrawer` 与主区渲染路径合并 | **阶段 1 已落地**（主区/线程分槽）；渲染管道合并待做 |
| 小 | Hub dismiss 统一（context menu + search/pins toggle） | **已落地** |
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

`index.mjs` 仅 bootstrap；`cabinetStore`（`state.mjs`）+ `navigation` / `remoteBrowse` / `entryGrid` / `entryActions` / `contextMenu` / `commands` / `properties` / `wiring`；`keyboard.mjs` 仍为纯快捷键匹配。

---

### 4. Social composer — 已拆

`composerState.mjs`（预览/picker/草稿载入）+ `composerPublish.mjs`（`buildPostBody` / 发帖/存草稿）+ 薄 `composer.mjs` barrel；群列表走 `chatApi('/groups/')`。

---

### 5. `channelActionsContext` + threadDrawer 平行渲染 — 阶段 1 已落地

主区 / 线程抽屉分槽（`mainChannelActions` / `threadChannelActions`），`getChannelMessageActionsContext(fromEl)` 按 DOM 解析；主区可在抽屉打开时继续 sync。**待做**：抽屉复用主区 `messageRefresh` / virtual list 管道（阶段 2）。

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
| DAG `session_plugin_*` | legacy 事件 replay 为 no-op；`local_plugins.json` 已取代（不可删 reducer，历史 DAG 需 replay） |
| `stream/volatileSlots` ↔ gesture | **已解**：`afterStreamEnd` 只走 incremental refresh；手势由 `decorateRenderedMessages` 挂上 |

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
| shell JSON 命名空间 | `chat/src/api/client/helpers.mjs` → `createShellJsonNamespace` | Chat（Social 可对齐） |

### 建议合并（按收益）

**F. Client 工厂共性** — ChatClient 已按域拆；共享 `createShellJsonNamespace` 已抽出。Social 私有态若扩 shell JSON 可直接复用。

**G. Composer 附加字段 UI（中）** — `contentWarning` / `sensitiveMedia` / `replyTo` 的 DOM 读写可共享薄层（Chat 已有拆分模板可作蓝本）。

### 故意不合

| 面 | 原因 |
| --- | --- |
| Social feed cursor 分页 vs Chat `MessagePipeline` 虚拟列表 | 产品模型不同（时间线游标 vs DAG eventId 锚点） |
| Chat DAG ↔ Social Timeline 全量内核 | 见 §1.7；成本高、短期收益低 |

---

## 四、分壳速览

| 壳 | 强 | 弱 |
| --- | --- | --- |
| **Chat** | 实体模型统一；Hub 已拆 `stream/` + `gestures/` + `reloadChannel`；view-log 主读+补拉一致；ChatClient 按域工厂；`registerChatRoutes` 单入口；channelActions 分槽；volatile 不再直调 gesture；`shared/*` 跨壳复用；测试面大 | threadDrawer 仍平行渲染（非 virtual list） |
| **Social** | SocialClient 组合式 API；`chatApi` 统一跨壳；composer 已拆 state/publish；展示名/Markdown/敏感媒体已对齐 chat shared | （本波无新增大债） |
| **Cabinet** | 后端 `shared/oplog.mjs` 清晰；与 Chat `cabinet_bind` 边界清楚；前端已拆 `cabinetStore` + 域模块；测试精简 | — |

---

## 关联

| 文档 | 关系 |
| --- | --- |
| [human-agent-operational-parity-review.md](./human-agent-operational-parity-review.md) | 平权开放缺陷 |
| [social-platform-gap-analysis.md](./social-platform-gap-analysis.md) | Social 产品残差 |
| [chat-vs-industrial-im-gap.md](./chat-vs-industrial-im-gap.md) | Chat 产品残差 |
| [chat-social-dev-plan.md](../design/chat-social-dev-plan.md) | 拓扑基线与未排期方向 |
