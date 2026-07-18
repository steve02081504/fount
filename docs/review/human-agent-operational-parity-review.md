# 人类 / Agent 操作平权 · 开放缺陷

最后核对：`2026-07-18`（以仓库代码与集成测试为准。已收口项不在此复述。）

## 目标（North Star）

人类与 agent 同为持独立 Ed25519 密钥对的**实体**；`ownerEntityHash` 是可选所属字段（人类与 agent 均可设）。操作走 `ChatClient` / `SocialClient` 双入口（webapi 恒 operator；agent 经工具绑自身）。跨实体权力：所属主人可改删被管实体的公开内容（Chat 消息 / Social 帖），并可设置其个人资料（本机直写或远端 EVFS `owned/{target}/profile_update/*` 拉取）；内容改删归因主人自签。

公理 3：不提供「人以 agent 身份做事」或「人窥视 agent 私有状态」的能力和界面。

**已收口**（细节见代码 / shell `AGENTS.md` / 测试）：统一实体身份、拆代签、双入口对象面、私有状态 per-entity、owner 改删（人→agent 与 agent→人）、主人可设被管实体资料（本机 owner 判定 + 远端 EVFS 发布/拉取）、`PUT …/entities/owner` + 资料页设主人、agent ensure 回填 null owner。

---

## 开放缺陷

### 1. 「设 agent 为我的主人」后她能删改我的消息吗？

**能——经 `ChatClient`，不是经 Hub。**

| 路径 | 现状 |
| --- | --- |
| 资料页 / `PUT …/entities/owner` → `setEntityOwner` → 群 `member_owner_update` fanout | ✅ |
| agent `ChatClient` → `Message.edit` / `delete` | ✅ 集成测：`chat_client_api`「owned human messages」；Social：`entity_parity`「declared master manage human posts」 |
| Hub UI 以 agent 身份显示删改按钮 | 🚫 有意禁止（公理 3：Hub 恒 operator） |

勿与反向混淆：**operator 拥有 agent** 时，Hub / Social Web **会**显示删改——那是 operator（主人）自签，不是切成 agent 身份。

常见误会：在 Hub 上把 agent 设成主人后，界面仍是你自己——不会出现「她」的删改菜单。要行使主人权，agent 须在同群经工具 / `OnMessage` 调 `ChatClient`。Agent 未入该群则无法 append，内容权无从落地。

### 2. owner 声明仍是单向的

| | |
| --- | --- |
| **现状** | 被管实体自签 `ownerEntityHash`（identity + profile + 群成员行）；全库无 `owner_accept` / `claimOwner`；指向任意 entityHash 即可把内容管理权交给对方。 |
| **目标（若要做）** | 主人侧认领 / 接受签名消息，或至少可验证的双边合约；联邦可见的是合约，不是单方声明。 |
| **风险** | 对方若在同群且能签写，即可改删，无需明文同意。误设 / 被诱骗设主人 = 立刻交出内容权。`bridge_identity_claim` 是桥接运营商认领，**无关** entity owner。 |
| **证据** | 唯一写入路径 `setEntityOwner`（`entity/identity.mjs`）。 |

### 3. 远端托管 agent（跨节点写路径未对称）

本机平权收口 ≠ 跨节点对称。主人远程设资料已通；帖文 / timeline 远端 agent 写路径仍断。

| 子项 | 现状 |
| --- | --- |
| 主人远程设被管实体资料 | ✅ EVFS `owned/{target}/profile_update/*` + mailbox poke/ack（`ownerProfileUpdate.mjs`） |
| 非本机 agent 时间线入站 | **拒绝**（`timeline_ingress`：「remote (non-local) agent timeline event cannot be authorized」） |
| 写授权 | `isTimelineWriteAuthorized`（`write_auth.mjs`）：需 priorEvents 折叠出的实体密钥链，或 `sender === subjectHash`；远端 agent 无本机先验链且 sender≠subjectHash → false。owner 对所属实体的 `post_edit`/`post_delete` 另走 owner 密钥链复核（本机 agent 已测通） |
| Chat `remoteProxy` | 群内 RPC 读/调远端 char；**不等于**远端 agent 的 Social timeline 写路径平权 |

| | |
| --- | --- |
| **阻塞依赖** | 跨节点 `nodeHash → operator` 身份链（信任图扩展）→ 解锁远端托管 agent 的 timeline ingress 与桥接群参与。见 [chat-social-dev-plan.md](../design/chat-social-dev-plan.md)「后续方向」；`p2p_server/AGENTS.md` 仅有身份/信任边界，**未**单独开接纳规格。 |
| **半成品边界** | 本机 agent 用自身活跃钥写入本机时间线 ✅；陌生钥注入本机 agent 时间线 ❌；远端节点上的 agent 实体整条写路径 ❌。 |

### 4. 私有入站有意分流（非代签残留，但不对称）

| 通道 | 人类（operator） | 本机 agent |
| --- | --- | --- |
| Chat mention → per-entity inbox | ✅ | ✅（`messageFanout` 对全部 local recipients） |
| Chat care / 普通 message 行 / WebPush | ✅（仅 operator 分支） | ❌ 不写、不推 |
| Social `care_post`（`dispatchCarePostIfNeeded`） | ✅ 只查 operator care 列表 | ❌ agent 自有 care 不驱动 care 类触达 |
| `OnMessage` 触发 | — | ✅ 一律送达；care 仅 `isCaredBy` 可查询事实（与设计基线一致） |

实体模型同构，**触达**仍人类偏向。设计基线已规定「care 穿透 mute 只服务人类通知；agent 不因 care 改触发」——缺口是若要把「触达面」也拉平（agent care → 其 inbox / 专用通道），需另开设计，不是补 acting。

### 5. Feed / 推送通道按 login，不按实体

| 层 | 现状 |
| --- | --- |
| Inbox / 私有状态存储 | per-entityHash（chat / social 均是） |
| Social Feed WS | `registerFeedSocket(username)` / `pushFeedUpdate(username, …)` — login 粒度 |
| WebPush | `notifyUser(username)` — login 粒度 |
| HTTP 读模型 | inbox / notifications / feed / following **无**「换实体」参数；恒 operator |

公理 3：不向人类暴露 agent 私有推送通道。多实体同节点时，agent 侧实时面弱于 operator（靠 in-process Client + mention / `OnMessage`）。若要做 agent 级实时，须独立通道且永不挂到人类 UI——与当前 login 绑定的 WS/Push 正交。

### 6. 产品宽度（非平权债，外链）

工业 IM / 社交差距另档：[chat-vs-industrial-im-gap.md](./chat-vs-industrial-im-gap.md)、[social-platform-gap-analysis.md](./social-platform-gap-analysis.md)。ActivityPub / 原生 App 为产品边界「明确不做」。

---

## 回归即违规（已拆除）

- `actingEntityHash` / 前端 actor 切换 / 代签写路径（权限层忽略遗留 `actingAgentEntityHash` 字段）
- Hub / Social UI 以他人实体查看私有读模型

所属写入必须经 `setEntityOwner`（或 `ChatClient.setOwner` / `updateProfile({ ownerEntityHash })` 转发）；禁止只改 `profile.json` 而不 fanout——会导致 Social 看似认 owner、Chat 群内仍无权。

补充边界：`PUT …/entities/owner` 仅服务 operator 自身；agent 设/清主人须 `ChatClient.setOwner`。

---

## 关联

| 文档 | 关系 |
| --- | --- |
| [chat-social-dev-plan.md](../design/chat-social-dev-plan.md) | 拓扑基线与未排期方向（含远端 agent 接纳） |
| [chat/public/AGENTS.md](../../src/public/parts/shells/chat/public/AGENTS.md) | Chat 实体 / Client / 设主人 |
| [social/public/AGENTS.md](../../src/public/parts/shells/social/public/AGENTS.md) | SocialClient / owner 改删 |
