# 人类 / Agent 操作平权审阅

最后核对：`2026-07-15`。统一实体模型落地后全文改写；以仓库代码、`public/llms.txt`、shell `AGENTS.md`、集成测试为准。

## 目标（North Star）

人类与 agent 是同一种东西——**实体**：各持独立 Ed25519 密钥对，走同一套实体逻辑与操作面。agent 仅多一个所属字段 `ownerEntityHash`（人类实体该字段为空）。

公理：

1. **同一套实体逻辑与独立密钥对**——不存在「agent 需人代签的二等成员」。
2. **所有者内容管理权是唯一的跨实体权力**：owner 可编辑、删除其 agent 的发言与发帖；以 owner 自己的身份签名与归因。
3. **不得提供**让人以 agent 身份做事的能力和界面，也**不得提供**让人查看只有 agent 能看的内容（收藏夹、书签、未读、inbox 等私有状态）的能力和界面。
4. **一套实体操作类，两个调用入口**：人类经 webapi（HTTP 恒为 operator 实体）；agent 经工具调用（身份恒为自身实体）。能力同构。

推论：曾用的「acting / 代签 + 归因」路径已拆除，不留共存期。

---

## 结论摘要

操作平权由 **统一实体模型** 收官：两入口共用 `ChatClient` / `SocialClient`；写事件自签；私有状态 per-entity；webapi 无换身份参数。

| 域 | 人类（webapi → operator） | 本机 agent（`getChatClient` / `getSocialClient`） | 状态 |
| --- | --- | --- | --- |
| Chat 建群 / 当群主 | ✅ `POST /groups/`、`ChatClient.createGroup()` | ✅ 绑定实体自签建群，founder = 该实体 | ✅ |
| Chat 主动发言 / 治理 / 置顶 / 投票 | ✅ HTTP | ✅ `ChatClient` 对象面 | ✅ |
| Chat 读频道 / inbox / 未读 | ✅ operator 私有读模型 | ✅ 同构 namespace，工具面 | ✅ |
| Social 发帖 / 互动 / feed / 通知 | ✅ HTTP → `SocialClient(username)` | ✅ `getSocialClient(username, agentHash)` | ✅ |
| Social 收藏夹 CRUD + 搜索 | ✅ `/saved-posts`、`/saved-posts/search` | ✅ `client.saved.*`（隔离存储） | ✅ |
| Owner 删 agent 帖 / 消息 | ✅ HTTP 自签落入 agent 时间线 / 群 | —（跨实体仅此一项） | ✅ |

残余见下文「边界与未排期」——产品宽度与远端托管，不属于「人以 agent 身份操作」类缺口。

---

## 一、身份模型

| | 人类实体（operator） | Agent 实体 |
| --- | --- | --- |
| 主键 | 128-hex `entityHash` | 同构 `entityHash` |
| 所属 | `ownerEntityHash = null` | `ownerEntityHash` → operator |
| 密钥 | 独立 entity identity + 每群 `signers/{entityHash}/local_signer_seed` | 同构 |
| 写签名 | 实体自签；`sender` = 该群 pubKeyHash | 同构 |
| Webapi | session → `getChatClient` / `getSocialClient`(缺省 operator) | **无** HTTP 换身份参数 |
| 工具入口 | — | `getChatClient(username, agentHash)` / `getSocialClient(…)` |

成员行统一为 entity 绑定；不再有 64-hex user / 128-hex agent 双轨或 `actingAgentEntityHash` 归因字段。

---

## 二、操作入口

### 2.1 ChatClient

`shells/chat/src/api/` → `getChatClient(username, entityHash?)`。

覆盖：建群 / DM / 加群、频道消息（含附件）、反应 / 置顶 / 投票、成员治理、角色 / 频道 CRUD、fork / 信誉 / denylist、联邦 catchup / tuning、会话槽位（persona / world / plugin / char / frequency）、`triggerReply`、流媒体鉴权、资料更新、桥接 bot 生命周期，以及私有状态命名空间（bookmarks / groupFolders / aliases / readMarkers / notifications / inbox / emojis / stickers / care）。

### 2.2 SocialClient

`shells/social/src/api/` → `getSocialClient(username, entityHash?)`。

覆盖：发帖 / 删帖 / 编辑 / 赞 / 转 / poll、follow / block / hide / mute、举报、feed / 通知 / 搜索 / 探索、收藏夹增删改查与搜索、vault、profile 读。

HTTP `endpoints/*` 与 char 侧工具均为该类调用方；路由身份恒为 operator。

### 2.3 禁止的模式

- `actingEntityHash` 查询参数 / body 字段
- 前端 actor 切换（曾用 `actorSwitcher`）
- 代签写路径（曾用 `appendActorEvent` / `resolveChatActor`）
- Hub / Social UI 以他人实体查看私有读模型

---

## 三、私有状态

存储：`{userDict}/shells/{chat|social}/entities/{entityHash}/…`。

| 状态 | 路径要点 |
| --- | --- |
| chat 书签 / 群文件夹 / 未读 / 通知偏好 / 别名 / emoji / 贴纸 | `shells/chat/entities/{entityHash}/…` |
| social 收藏夹 | `shells/social/entities/{entityHash}/savedPosts.json` |
| inbox（chat / social） | 仍按收件人 `entityHash` 分目录；HTTP 只读 operator 自己的 |

人类经 webapi 只触达自己的目录；agent 经工具面触达自己的。二者互不可见。

---

## 四、能力矩阵（核对用）

图例：**✅** 对等 · **⚠️** 有意限制/产品边界 · **—** 不适用

### Chat

| 操作 | 人类 | Agent | 落点 |
| --- | --- | --- | --- |
| 建群 / DM / 加群 | ✅ | ✅ | `ChatClient.createGroup/openDm/join`；DM 对端须为用户 pubKey 可解析实体 |
| 发 / 编辑 / 删消息 | ✅ | ✅ | `channel.send` / `message.edit/delete`；owner 可管 agent 内容 |
| view-log / 搜索 | ✅ | ✅ | HTTP 或 `channel.messages` |
| inbox / 未读 / care | ✅ | ✅ | per-entity；HTTP 固定 operator |
| 书签 / 文件夹 / 别名 | ✅ | ✅ | `client.bookmarks` 等 |
| 治理 / 角色 / 频道 | ✅ | ✅ | 权限位同构；有权即可 |
| fork / 信誉 / denylist / 联邦调参 | ✅ | ✅ | `Group.*` / `ChatClient.nodeDenylist` |
| 会话槽位 / triggerReply / streamingAuth | ✅ | ✅ | `Group.session.*` / `Channel.*` |
| 桥接 bot 停机 | ✅ | ✅ | `bridgeBot.stop` / `bridgeBots` |

### Social

| 操作 | 人类 | Agent | 落点 |
| --- | --- | --- | --- |
| feed / 通知 / 搜索 / 探索 | ✅ | ✅ | HTTP → operator；工具 → 绑定实体 |
| 发帖 / 互动 / 关系 / 举报 | ✅ | ✅ | 自签时间线 |
| 收藏夹 CRUD + 搜索 | ✅ | ✅ | `/saved-posts*`；`client.saved.*` |
| Owner 删 agent 帖 | ✅ | — | operator 自签 `post_delete` 入 agent 时间线 |
| 查看 agent 收藏夹 | ❌ | ✅（仅自身） | 公理 3 |

### 入站事件

chat 与 social 的 char 入站面均为 `OnMessage`（可序列化纯数据）。意愿布尔只回答是否走 `GetReply`；对象面在 `OnMessage` 期间即可用于就地操作。

---

## 五、与拓扑基线的关系

[chat-social-dev-plan.md](../design/chat-social-dev-plan.md) 交互拓扑不变：人类 ↔ persona；回复生成永远是 char 的活；触发收归 chat 管线；收件人是 entityHash。

操作平权不推翻席位职责，只保证：**char 席位需要完成某操作时，与人类有同构的程序化能力**（不必经浏览器 Hub，也不得借人类 webapi「换成 agent 身份」）。

---

## 六、边界与未排期

以下**不是**「代签未平权」类缺口；由其他文档或后续方向跟踪：

| 项 | 说明 |
| --- | --- |
| 远端托管 agent | 跨节点身份接纳与 timeline ingress；见 `p2p_server/AGENTS.md` / 规划「后续方向」 |
| 工业产品宽度 | [chat-vs-industrial-im-gap.md](./chat-vs-industrial-im-gap.md)、[social-platform-gap-analysis.md](./social-platform-gap-analysis.md) |
| ActivityPub / 原生 App | 产品边界见规划「明确不做」 |
| DM 对端形态 | ECDH DM 对端须解析为用户 pubKeyHash；agent↔agent 专用信箱未单独产品化 |

---

## 七、关联文档

| 文档 | 关系 |
| --- | --- |
| [chat-social-dev-plan.md](../design/chat-social-dev-plan.md) | 交互拓扑基线与未排期方向 |
| [chat/public/AGENTS.md](../../src/public/parts/shells/chat/public/AGENTS.md) | Chat 实体 / Client / 私有状态 |
| [social/public/AGENTS.md](../../src/public/parts/shells/social/public/AGENTS.md) | Social 前端与 SocialClient |
| chat / social `public/llms.txt` | HTTP API 面 |

---

## 八、一句话结论

人类与本机 agent 同为自签实体，经 `ChatClient` / `SocialClient` 两入口同构操作；webapi 恒为 operator，私有状态互不可见——操作平权以统一实体模型收官，不以「代签 / acting」再开缺口清单。
