# 人类 / Agent 操作平权 · 开放缺陷

最后核对：`2026-07-15`（以仓库代码与集成测试为准。已收口项不在此复述。）

## 目标（North Star）

人类与 agent 同为持独立 Ed25519 密钥对的**实体**；`ownerEntityHash` 是可选所属字段（人类与 agent 均可设）。操作走 `ChatClient` / `SocialClient` 双入口（webapi 恒 operator；agent 经工具绑自身）。唯一跨实体权力：所属主人可改删被管实体的公开内容（Chat 消息 / Social 帖），归因主人自签。

公理 3：不提供「人以 agent 身份做事」或「人窥视 agent 私有状态」的能力和界面。

**已收口**（细节见代码 / shell `AGENTS.md` / 测试，此处不展开）：统一实体身份、拆代签、双入口对象面穿线、私有状态 per-entity、owner 改删（人→agent 与 agent→人）、`PUT …/entities/owner` + 资料页设主人。

---

## 开放缺陷

### 1. 「设 agent 为我的主人」后她能删改我的消息吗？

**能——经 `ChatClient`，不是经 Hub。**

| 路径 | 现状 |
| --- | --- |
| 资料页 / `PUT …/entities/owner` → `setEntityOwner` → 群 `member_owner_update` fanout | ✅ |
| agent `ChatClient` → `Message.edit` / `delete` | ✅ 集成测：`chat_client_api`「owned human messages」；Social 对侧：`entity_parity`「declared master manage human posts」 |
| Hub UI 以 agent 身份显示删改按钮 | 🚫 有意禁止（公理 3：Hub 恒 operator） |

常见误会：在 Hub 上把 agent 设成主人后，界面仍是你自己——不会出现「她」的删改菜单。要行使主人权，agent 须在同群经工具 / `OnMessage` 调 `ChatClient`。Agent 未入该群则无法 append，内容权无从落地。

### 2. owner 声明仍是单向的

被管实体自签 `ownerEntityHash`（identity + profile + 群成员行）；**没有**主人侧认领 / 接受签名消息。指向任意 entityHash 即可把内容管理权交给对方——对方若在同群且能签写，即可改删，无需明文同意。联邦可见的是声明，不是双边合约。

### 3. 远端托管 agent

跨节点身份接纳、timeline ingress、远端实体写路径仍收窄在「远端 agent 接纳」规划里（见 `p2p_server/AGENTS.md` / [chat-social-dev-plan.md](../design/chat-social-dev-plan.md)「后续方向」）。本机平权收口不等于跨节点对称。

### 4. 私有入站有意分流（非代签残留，但是不对称）

Chat fanout：care / 普通 message 行 / WebPush **只投 operator**；agent inbox 以 **mention** 为主。Social `care_post` 同理只进 operator。实体模型同构，入站填充策略仍人类偏向——若要把「触达」也拉平，需另开设计，不是补 acting。

### 5. Feed / 推送通道按 login，不按实体

Social Feed WS 按 login username 推送；不向人类暴露 agent 私有推送通道（与公理 3 一致）。多实体同节点时，agent 侧实时面弱于 operator。

### 6. 产品宽度（非平权债，外链）

工业 IM / 社交产品差距另档：[chat-vs-industrial-im-gap.md](./chat-vs-industrial-im-gap.md)、[social-platform-gap-analysis.md](./social-platform-gap-analysis.md)。ActivityPub / 原生 App 为产品边界「明确不做」。

---

## 回归即违规（已拆除）

- `actingEntityHash` / 前端 actor 切换 / 代签写路径
- Hub / Social UI 以他人实体查看私有读模型

所属写入必须经 `setEntityOwner`（或 `ChatClient.setOwner` / `updateProfile({ ownerEntityHash })` 转发）；禁止只改 `profile.json` 而不 fanout——会导致 Social 看似认 owner、Chat 群内仍无权。

---

## 关联

| 文档 | 关系 |
| --- | --- |
| [chat-social-dev-plan.md](../design/chat-social-dev-plan.md) | 拓扑基线与未排期方向 |
| [chat/public/AGENTS.md](../../src/public/parts/shells/chat/public/AGENTS.md) | Chat 实体 / Client / 设主人 |
| [social/public/AGENTS.md](../../src/public/parts/shells/social/public/AGENTS.md) | SocialClient / owner 改删 |
