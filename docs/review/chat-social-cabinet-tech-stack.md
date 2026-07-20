# Chat / Social / Cabinet 技术栈审阅

最后核对：`2026-07-18`。对象：三壳**仍开放**的实现债——设计别扭点、可合并架构。**不是**产品差距（产品见同目录 gap 档）。证据以 import 图与代码阅读为准。

写法：[docs/AGENTS.md](../AGENTS.md)。

---

## 结论摘要

| 优先级 | 动作 | 状态 |
| --- | --- | --- |
| 中 | import map / `@chat/hub/...` 别名，缓解相对路径地狱 | 中长期；短期 AGENTS 文档即可 |
| 慎做 | Chat DAG ↔ Social Timeline 事件内核合并 | 大工程；联邦规则要统一改时再动 |

---

## 一、设计别扭（为何丑 · 如何改）

### 1. 浏览器相对 import 路径地狱

**位置**：Hub AGENTS 用整段说明 `../src` vs `../../src` vs `/parts/shells:chat/...`

**为何丑**：Shell 挂在 `/parts/shells:chat/...` 下，相对路径错一层就 404 整图；Social 跨壳被迫用绝对 URL。

**改进**：中长期 import map / `@chat/hub/...` 别名；短期保持 AGENTS 文档即可。

---

### 2. Chat DAG ↔ Social Timeline 平行宇宙

**位置**：`chat/src/chat/dag/` vs `social/src/timeline/`

**为何丑**：同为 append-only 事件 + reducer 物化 + 联邦 ingress，概念重叠但零共享。

**改进**：仅当联邦规则要统一改时，再抽薄层 `EventLogStore`。**短期不合并也可接受**。

---

## 二、可合并为更通用架构（不损功能）

### 已共享（继续扩展时优先复用）

`chat/public/shared/{hashAvatar,entityAvatar,entityProfileCard,trustedMarkdown,composerAttachmentFields,aliases}.mjs`；`shared/{entityHash,avRelayClient,inlineTokenSyntax}.mjs`；`chat/src/chat/lib/jsonlInboxStore.mjs`；`createShellJsonNamespace`（`chat/src/api/client/helpers.mjs`）。

### 故意不合

| 面 | 原因 |
| --- | --- |
| Social feed cursor 分页 vs Chat `MessagePipeline` 虚拟列表 | 产品模型不同 |
| Chat DAG ↔ Social Timeline 全量内核 | 见 §1.2 |
| replyTo / quoteRef UI 硬合并 | 产品模型不同 |

---

## 三、分壳速览

| 壳 | 强 | 弱 |
| --- | --- | --- |
| **Chat** | 实体模型统一；Hub stream/gestures；view-log 主读；ChatClient 工厂；channelActions 分槽；thread → messageSurface；`shared/*` 跨壳 | 相对 import 路径脆弱 |
| **Social** | SocialClient 组合式；composer / mutedKeywords / CW 与 chat helpers 对齐 | 同左；Timeline 与 Chat DAG 无共享 |
| **Cabinet** | 后端 oplog；前端 cabinetStore + 域模块 | — |

---

## 关联

| 文档 | 关系 |
| --- | --- |
| [human-agent-operational-parity-review.md](./human-agent-operational-parity-review.md) | 平权开放缺陷 |
| [social-platform-gap-analysis.md](./social-platform-gap-analysis.md) | Social 产品残差 |
| [chat-vs-industrial-im-gap.md](./chat-vs-industrial-im-gap.md) | Chat 产品残差 |
| [chat-social-dev-plan.md](../design/chat-social-dev-plan.md) | 拓扑基线与未排期方向 |
