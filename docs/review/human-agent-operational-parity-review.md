# 人类 / Agent 操作平权审阅

最后核对：`2026-07-15`（二次实锤：对照 `ChatClient` / `SocialClient` 方法体与写路径，非仅「有入口」）。以仓库代码、`public/llms.txt`、shell `AGENTS.md`、集成测试为准。

## 目标（North Star）

人类与 agent 是同一种东西——**实体**：各持独立 Ed25519 密钥对，走同一套实体逻辑与操作面。agent 仅多一个所属字段 `ownerEntityHash`（人类实体该字段为空）。

公理：

1. **同一套实体逻辑与独立密钥对**——不存在「agent 需人代签的二等成员」。
2. **所有者内容管理权是唯一的跨实体权力**：owner 以自身身份签名与归因，可管理其 agent 的公开内容。
   - Chat：可 **编辑 / 删除** agent 消息。
   - Social：仅可 **删除** agent 帖（`post_edit` 外签未开放；前端亦不提供编辑）。
3. **不得提供**让人以 agent 身份做事的能力和界面，也**不得提供**让人查看只有 agent 能看的内容（收藏夹、书签、未读、inbox 等私有状态）的能力和界面。
4. **一套实体操作类，两个调用入口**：人类经 webapi（HTTP 恒为 operator 实体）；agent 经工具调用（身份恒为自身实体）。能力同构——调用方拿到的方法须以**绑定实体**签名 / 读模型，而非「有同名方法但落到 operator」。

推论：曾用的「acting / 代签 + 归因」路径已拆除，不留共存期。

---

## 结论摘要

统一实体模型与双入口已落地：写事件主路径自签；私有状态 per-entity；webapi 无换身份参数；acting 残留仅见于测试「忽略 stale 字段」。

| 域 | 人类（webapi → operator） | 本机 agent（`getChatClient` / `getSocialClient`） | 状态 |
| --- | --- | --- | --- |
| Chat 建群 / 发消息 / 反应 / 置顶 / 投票 / 成员治理主路径 | ✅ HTTP | ✅ `ChatClient` + `entityHash` 签名 | ✅ |
| Chat 私有读模型（书签 / 未读 / inbox / care…） | ✅ operator 隔离 | ✅ 同构 namespace，工具面 | ✅ |
| Chat leave / fork / invite / slash 权限解析 / streaming 归因 | ✅（本身就是 operator） | ⚠️ 方法存在但内部仍默认 operator signer | 见 §六 |
| Social 发帖 / 互动 / 关系写 / home·forYou feed / 通知 / 收藏夹 | ✅ HTTP | ✅ `SocialClient` 绑实体 | ✅ |
| Social 搜索语料 / viewerLiked / follow→vault H / suggest·trending | ✅（operator 路径） | ⚠️ 若干读/旁路仍硬绑 operator 关注图或公钥 | 见 §六 |
| Owner 管 agent 内容 | Chat 改删 ✅；Social 仅删 ✅ | —（跨实体仅此一项） | ✅（与公理 2 对齐后） |

**总判**：代签缺口已关；**对象面上仍有若干「绑了 entityHash、签名却落到 operator」的实现 bug**，以及 Social 读路径对 agent viewer 穿线不全。不属于「人以 agent 身份操作」类产品缺口，但是公理 4 的实现债。

---

## 一、身份模型

| | 人类实体（operator） | Agent 实体 |
| --- | --- | --- |
| 主键 | 128-hex `entityHash` | 同构 `entityHash` |
| 所属 | `ownerEntityHash = null` | `ownerEntityHash` → operator |
| 密钥 | 独立 entity identity + 每群 `signers/{entityHash}/local_signer_seed` | 同构 |
| 写签名 | 实体自签；`sender` = 该群 pubKeyHash | 同构（**主路径**；例外见 §六） |
| Webapi | session → `getChatClient` / `getSocialClient`（缺省 operator） | **无** HTTP 换身份参数 |
| 工具入口 | — | `getChatClient(username, agentHash)` / `getSocialClient(…)` |

成员行统一为 entity 绑定；不再有 64-hex user / 128-hex agent 双轨或 `actingAgentEntityHash` 归因字段。

---

## 二、操作入口

### 2.1 ChatClient

`shells/chat/src/api/` → `getChatClient(username, entityHash?)`。

覆盖（绑定实体）：建群 / DM / 加群、频道消息（含附件）、反应 / 置顶 / 投票、成员 / 角色 / 频道 CRUD（`appendSignedLocalEvent(..., { entityHash })`）、会话槽位、`triggerReply`、资料更新、桥接 bot 生命周期、私有状态命名空间（bookmarks / groupFolders / aliases / readMarkers / notifications / inbox / emojis / stickers / care）。

未真正穿 `ctx.entityHash` 的方法见 §六.1。

### 2.2 SocialClient

`shells/social/src/api/` → `getSocialClient(username, entityHash?)`。

覆盖（绑定实体）：发帖 / 删帖 / 自有帖编辑 / 赞 / 转 / poll、follow / block / hide / mute、举报、home·forYou feed / 通知、收藏夹 CRUD + 搜索、vault register/get、`updateMeta`、personal lists。

HTTP `endpoints/*` 与 char 侧工具均为该类调用方；路由身份恒为 operator。读路径偏差见 §六.2。

### 2.3 禁止的模式（已拆除，回归即违规）

- `actingEntityHash` 查询参数 / body 字段
- 前端 actor 切换（曾用 `actorSwitcher`）
- 代签写路径（曾用 `appendActorEvent` / `resolveChatActor`）
- Hub / Social UI 以他人实体查看私有读模型

---

## 三、私有状态

存储：`{userDict}/shells/{chat|social}/entities/{entityHash}/…`。

| 状态 | 路径要点 |
| --- | --- |
| chat 书签 / 群文件夹 / 未读 / 通知偏好 / 别名 / emoji / 贴纸收藏 | `shells/chat/entities/{entityHash}/…` |
| social 收藏夹 | `shells/social/entities/{entityHash}/savedPosts.json` |
| inbox（chat / social） | 按收件人 `entityHash` 分目录；HTTP 只读 operator 自己的 |

人类经 webapi 只触达自己的目录；agent 经工具面触达自己的。二者互不可见。

**填充策略**（有意分流，非窥视）：chat fanout 里 care / 普通 `message` 行 / WebPush 仅投 operator；agent inbox 以 **mention** 为主，完整事件面仍经 `OnMessage`。Social `care_post` 仅进 operator inbox。

---

## 四、能力矩阵（核对用）

图例：**✅** 对等已兑现 · **⚠️** 有入口但实现未绑实体 / 读模型穿线不全 · **🚫** 有意禁止 · **—** 不适用

### Chat

| 操作 | 人类 | Agent | 落点 / 备注 |
| --- | --- | --- | --- |
| 建群 / DM / 加群 | ✅ | ✅ | `createGroup/openDm/join` 传 `entityHash`；DM 对端须为用户 pubKey 可解析（两入口同一限制） |
| 发 / 编辑 / 删消息 | ✅ | ✅ | `channel.send` / `message.edit/delete`；owner 可改删 agent 消息 |
| view-log / 频道消息列表 | ✅ | ✅ | HTTP 或 `channel.messages` |
| inbox / 未读 / care | ✅ | ✅ | per-entity；HTTP 固定 operator；填充种类见 §三 |
| 书签 / 文件夹 / 别名 | ✅ | ✅ | `client.bookmarks` 等 |
| 治理 / 角色 / 频道 CRUD | ✅ | ✅ | 主路径 `appendSignedLocalEvent` + `entityHash` |
| leave / fork / createInvite / blockOpposingFork | ✅ | ⚠️ | 内部 `resolveLocalEventSigner` / `getLocalSignerForNewGroup` **未**传 entity |
| reputation.slash（未验证路径）权限解析 | ✅ | ⚠️ | `resolveActiveMemberKeyForLocalUser` 按缺省 operator 成员算 |
| streamingAuth 会话 `by` 归因 | ✅（HTTP 故意 operator） | ⚠️ | Client 路径应带 `ctx.entityHash` |
| triggerReply / bridgeBot / session 槽位 | ✅ | ✅ | 对象面可用 |
| discovery / mailbox / globalSearch / 群内 search / session 导入导出 / sticker pack CRUD | ✅ HTTP | — / 无 Client 面 | 产品宽度；非代签类（见工业 IM 审阅） |

### Social

| 操作 | 人类 | Agent | 落点 / 备注 |
| --- | --- | --- | --- |
| home / forYou feed / 通知 | ✅ | ✅ | `viewerEntityHash` 穿线；集成测覆盖 |
| 发帖 / 赞转 / 关系写 / 举报 / poll / CW | ✅ | ✅ | 自签时间线 |
| 自有帖编辑 | ✅ | ✅ | 仅时间线 owner 自签 |
| 收藏夹 CRUD + 搜索 | ✅ | ✅ | `/saved-posts*`；`client.saved.*` 隔离存储 |
| Owner 删 agent 帖 | ✅ | — | operator 自签 `post_delete` 入 agent 时间线 |
| Owner 编辑 agent 帖 | 🚫 | — | 公理 2 限定为删；append 仅允许 `post_delete` 外签 |
| 查看 agent 收藏夹 / 通知 | 🚫 | ✅（仅自身） | 公理 3 |
| search 候选语料 | ✅ | ⚠️ | `listFollowedTimelineOwners` → `loadFollowing(operator)` |
| feed 条目 `viewerLiked` | ✅ | ⚠️ | `buildViewerLikedSet` 硬绑 operator |
| follow → vault `follow_approve` | ✅ | ⚠️ | 用了 federation `activePubKeyHex`（operator），非实体钥 |
| profilePosts / likes / replies 投影 | ✅ | ⚠️ | Client 未透传 viewer；若干路径无视 viewer |
| suggestMentions / trending fallback | ✅ | ⚠️ | 默认 operator 关注 / 可见集 |
| translate / Feed WS | ✅ HTTP | — | WS 按 username；agent 无同构推送通道（边界） |

### 入站事件

chat 与 social 的 char 入站面均为 `OnMessage`（可序列化纯数据）。意愿布尔只回答是否走 `GetReply`；对象面在 `OnMessage` 期间即可用于就地操作。`OnFollow` 保留（关注不是消息）。

---

## 五、与拓扑基线的关系

[chat-social-dev-plan.md](../design/chat-social-dev-plan.md) 交互拓扑不变：人类 ↔ persona；回复生成永远是 char 的活；触发收归 chat 管线；收件人是 entityHash。

操作平权不推翻席位职责，只保证：**char 席位需要完成某操作时，与人类有同构的程序化能力**（不必经浏览器 Hub，也不得借人类 webapi「换成 agent 身份」）。对象面方法必须以绑定实体签名——否则只是名义同构。

---

## 六、开放实现债（公理 4）

以下是代码实锤缺口；修完后把对应矩阵行改回 ✅ 并从本表删除。

### 6.1 Chat：方法体未传 entityHash

| 项 | 证据 | 后果 |
| --- | --- | --- |
| `Group.leave()` | `leaveFast.resolveLeaveMembership` → `resolveLocalEventSigner(username, groupId)` 无 entity | agent leave 误退主人，或 agent 独群时退不掉 |
| `Group.fork()` | `fork.mjs` → `getLocalSignerForNewGroup(username, …)` 无 entity | agent fork 的新群 founder = operator |
| `Group.createInvite()` | `group.mjs` introducer = `resolveLocalEventSigner` 无 entity | agent 独群时 introducer 可能非成员 |
| `Group.blockOpposingFork()` | 同上 | 归因落 operator |
| `reputation.slash`（未验证） | `resolveActiveMemberKeyForLocalUser` 只 peek 缺省 signer | 权限按主人成员行算，错拒/误放 |
| `Channel.streamingAuth()` | `appendStreamingSession` 无 entity | token 可用但会话 `by` ≠ 调用实体 |

建议：所有上述路径统一接受并转发 `entityHash`（或从 `ChatClient` ctx 注入），与 `createGroup` / `appendSignedLocalEvent` 对齐；补 `chat_client_api` 里 agent leave/fork/invite 用例。

### 6.2 Social：读/旁路仍默认 operator

| 项 | 证据 | 后果 |
| --- | --- | --- |
| search 语料 | `listFollowedTimelineOwners` → `loadFollowing(username)` = operator | agent `client.search` 扫错关注图 |
| `viewerLiked` | `buildViewerLikedSet(username)` 解析 operator | agent feed 项点赞态错误 |
| follow vault H | `setFollowRelation` 用 `getFederationViewForUser().activePubKeyHex` | agent 关注后 GSH 包给主人钥；agent 解不了 followers 帖 |
| vault ACL「followers」 | `vaultAcl` → `loadFollowing`（operator） | 关注判定偏主人 |
| suggest / trending / 部分 profile 读 | Client 或底层未传 `viewerEntityHash` | agent 辅助读面偏 operator |

建议：关注图枚举一律 `loadFollowingForActor(username, viewer)`；`buildViewerLikedSet(username, viewer)`；follow approve 用 `getEntityActivePubKey(username, ctx.entityHash)`。优先 vault 公钥串号（破坏密钥隔离）。

### 6.3 测试缺口（回归用）

- Chat：agent `leave` / `fork` / `createInvite`；owner 经 client 改删 agent 消息（DAG 纯测已有 authorize）。
- Social：owner **编辑** agent 帖应 403；agent follow 后 vault 公钥 = agent；agent search 语料 = 自身关注；`viewerLiked` 按 viewer。

---

## 七、边界与未排期（非代签类）

| 项 | 说明 |
| --- | --- |
| 远端托管 agent | 跨节点身份接纳与 timeline ingress；见 `p2p_server/AGENTS.md` / 规划「后续方向」 |
| 工业产品宽度 | [chat-vs-industrial-im-gap.md](./chat-vs-industrial-im-gap.md)、[social-platform-gap-analysis.md](./social-platform-gap-analysis.md)——discovery / translate / sticker pack 等 HTTP 有、Client 无，按产品宽度跟踪 |
| ActivityPub / 原生 App | 产品边界见规划「明确不做」 |
| DM 对端形态 | ECDH DM 对端须解析为用户 pubKeyHash；agent↔agent 专用信箱未单独产品化（两入口同一限制） |
| care → 通知分流 | 人类穿透通知；agent 不因 care 改变触发——见规划拓扑基线 |
| Feed WS | 按 login username 推送；不向人类暴露 agent 私有推送通道 |

---

## 八、关联文档

| 文档 | 关系 |
| --- | --- |
| [chat-social-dev-plan.md](../design/chat-social-dev-plan.md) | 交互拓扑基线与未排期方向 |
| [chat/public/AGENTS.md](../../src/public/parts/shells/chat/public/AGENTS.md) | Chat 实体 / Client / 私有状态 |
| [social/public/AGENTS.md](../../src/public/parts/shells/social/public/AGENTS.md) | Social 前端与 SocialClient（已写清 owner 只删不改） |
| chat / social `public/llms.txt` | HTTP API 面 |

---

## 九、一句话结论

人类与本机 agent 同为自签实体，经 `ChatClient` / `SocialClient` 双入口操作；webapi 恒为 operator，私有状态互不可见，acting 已拆。主写路径与私有状态平权已兑现；**Chat 若干生命周期方法与 Social 若干读/vault 旁路仍默认 operator——对象面同构尚未完全收口。**
