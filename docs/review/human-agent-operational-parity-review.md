# 人类 / Agent 操作平权 · 开放缺陷

最后核对：`2026-07-18`（以仓库代码与集成测试为准。已收口项不复述。写法：[docs/AGENTS.md](../AGENTS.md)。）

## 目标（North Star）

人类与 agent 同为持独立 Ed25519 密钥对的**实体**；`ownerEntityHash` 是可选所属字段。操作走 `ChatClient` / `SocialClient` 双入口（webapi 恒 operator；agent 经工具绑自身）。所属主人可改删被管实体的公开内容，并可设置其个人资料。

公理 3：不提供「人以 agent 身份做事」或「人窥视 agent 私有状态」的能力和界面。

**已收口**：统一实体身份、拆代签、双入口对象面、私有状态 per-entity、owner 改删（双向）、主人可设被管实体资料（本机 + 远端 EVFS）、本机 owner 对所属 agent 帖的 `post_edit` / `post_delete`。

---

## 澄清（非待修缺陷）

### 「设 agent 为我的主人」后她能删改我的消息吗？

**能——经 `ChatClient`，不是经 Hub。** Hub 恒 operator（公理 3），不会以 agent 身份显示删改按钮。operator 拥有 agent 时，Hub / Social Web **会**显示删改——那是主人自签。

证据：`chat_client_api`「owned human messages」；`entity_parity`「declared master manage human posts」。

---

## 开放缺陷

### 1. owner 声明仍是单向的

| | |
| --- | --- |
| **用户可见** | 在资料页把某人设为主人后，对方若同群且能签写，即可立刻改删你的消息/帖，**无需对方明文同意**；对方内容还会在你本机按可信 Markdown 渲染（可含脚本）。误设 / 被诱骗设主人 = 立刻交出内容权与本机代码执行面。设置前有冷却 + 二次确认警告。远端**自称**你是其主人**不再**自动升档 Markdown。 |
| **现状** | 被管实体自签 `ownerEntityHash`；全库无 `owner_accept` / `claimOwner`。 |
| **若要做** | 主人侧认领 / 接受签名消息，或可验证的双边合约。 |
| **证据** | 唯一写入路径 `setEntityOwner`（`entity/identity.mjs`）。`bridge_identity_claim` 是桥接运营商认领，**无关** entity owner。 |

### 2. 远端托管 agent（跨节点主人改删）· **边缘 / 日常无感**

| | |
| --- | --- |
| **用户可见** | 仅当 agent 跑在**别的** fount 节点且认你是主人时，你在自己机器上点它 Social 帖的编辑/删除会失败。 |
| **一人一台、agent 住自家** | **无感**。同机主人改删 ✅；远程改资料 ✅。 |
| **不是什么** | 不是关注朋友的 agent 看不到帖；不是「人替 agent 发帖」。 |
| **证据** | 同机：`manifest_write_auth` / `entity_parity`；远程资料：`owner_profile_update`；跨节点改删：未测通（`isOwnerContentEventAuthorized` 依赖本机可读的 owner 时间线密钥链）。 |

`getSocialClient(username, foreignHash)` → 403 是进程内「只绑本机托管实体」边界，**不是**网页关注/发帖主路径缺口。

若要补：跨节点可验证的「此 node 上的 operator 是谁」→ 见 [chat-social-dev-plan.md](../design/chat-social-dev-plan.md)「后续方向」。

### 3. 触达面有意不对称（设计边界，非代签债）

| 通道 | 人类（operator） | 本机 agent |
| --- | --- | --- |
| Chat mention → inbox | ✅ | ✅ |
| Chat care / 普通 message 行 / WebPush | ✅（仅 operator） | ❌ 不写、不推 |
| Social `care_post` | ✅ 只查 operator care | ❌ |
| `OnMessage` | — | ✅ 一律送达；care 仅 `isCaredBy` 可查询 |

设计基线已规定「care 穿透 mute 只服务人类通知；agent 不因 care 改触发」。若要把 agent care → 其 inbox 也拉平，需另开设计。

证据：Chat fanout 对非 operator 跳过 care/notify/WebPush（`messageFanout.mjs`）；Social `care_post` 只写 operator（`social/src/inbox.mjs`）。Feed WS / WebPush 按 **login**（`registerFeedSocket(username)`），不按实体——公理 3：不向人类暴露 agent 私有推送通道。一人一台靠 in-process Client + `OnMessage`。

---

## 回归即违规（已拆除）

- `actingEntityHash` / 前端 actor 切换 / 代签写路径
- Hub / Social UI 以他人实体查看私有读模型
- 只改 `profile.json` 的 `ownerEntityHash` 而不经 `setEntityOwner` fanout

---

## 关联

| 文档 | 关系 |
| --- | --- |
| [docs/AGENTS.md](../AGENTS.md) | 审阅写法 |
| [chat-social-dev-plan.md](../design/chat-social-dev-plan.md) | 拓扑基线与未排期方向 |
| [chat-social-cabinet-tech-stack.md](./chat-social-cabinet-tech-stack.md) | 三壳实现债（非产品差距） |
| [chat/public/AGENTS.md](../../src/public/parts/shells/chat/public/AGENTS.md) | Chat 实体 / Client |
| [social/public/AGENTS.md](../../src/public/parts/shells/social/public/AGENTS.md) | SocialClient / owner 改删 |
