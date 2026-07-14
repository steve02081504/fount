# Chat / Social 开发规划

更新：`2026-07-15`（清档：已落地里程碑从本档删除，以代码与壳测试为准）

> 本文档是**实施级规划**：只写尚未排期或正在推进的工作。做没做、做到哪，以仓库代码与各 shell 测试为准。
>
> **规划纪律**：
>
> 1. 里程碑落地后，本档对应章节**删除**——不留 as-built 归档；路径、API、token 语法以代码与 `llms.txt` / 各 shell `AGENTS.md` 为准。
> 2. 迁移映射表的每一项必须对照**目标面已存在的具体 API** 逐条验证；找不到落点即标注为阻塞地基，不得用「副作用」「惰性查询」等措辞掩盖缺件。
> 3. 涉及生命周期、身份归属这类跨切面语义，先确认模型成立再谈映射。

## 定位与输入

输入为缺口审阅（审阅只陈述现状；设计决策与未排期方向以本文为准）：

- [human-agent-operational-parity-review.md](../review/human-agent-operational-parity-review.md)：操作平权（残余缺口由本文「一、统一实体模型」整批收官；该审阅第六节的「代签 + 归因」目标架构已被本文裁决**取代**）
- [social-platform-gap-analysis.md](../review/social-platform-gap-analysis.md)：social 产品差距
- [chat-vs-industrial-im-gap.md](../review/chat-vs-industrial-im-gap.md)：chat 工业 IM 差距

一句话总纲：**一种实体、一处收件人、一处 trigger、一层名字、一套 token、一套对象模型**——人类与 agent 同为持独立密钥对的实体（agent 仅多 `ownerEntityHash` 所属字段）；通知与触发以 entityHash 为一等收件人拉平人类与 agent；chat 与 social 的 char 入站事件面统一为 `OnMessage`；chat 的操作面以 discord.js 式 `ChatClient` 对象模型统一（agent、agent 开发者、桥接平台三方共用一套鸭子类型契约）；平台 bot 壳退化为该契约的翻译层，触发决策收归 chat 管线；hash 之上铺具名层；entity @ / 角色组 @ / emoji 收敛为一套 inline token 语法。

不向后兼容原则不变：直接删除替换、不留共存期、不写迁移代码。

上一周期（收件人 / 触发 / 具名层 / ChatClient / bridge / bot 生命周期与 operator 认领 / 龙胆迁移 / social `OnMessage` 与 actor 平权 / poll·edit·for_you）与统一实体模型的地基批 E1（实体身份泛化 / chat 单成员模型 / 拆代签 / social 时间线自签）已完成并从本档清出；现状以代码为准。

---

## 〇、交互拓扑基线（谁和谁说话）

所有工作流的设计都以下面这条**一般交互逻辑**为基线：

- **人类 ↔ persona**：人类通过网页或 CLI 与 persona 交互。persona 是真人 I/O 的一等中间层，human UI 不是绕过 part 系统的裸通道。
- **world → persona / char**：world 通过发起 API 调用与 persona 和 char 交互（喂视图 `GetChatLogForViewer`、贡献 prompt、裁决发言顺序、代发回复等）。
- **world → chat 存储 / p2p 层**：world 通过 `WorldChatHost` 使用 chat 的存储与 p2p 层。
- **char 内部**：char 调用 AI 或插件完成回复。**回复生成从始至终是 char 的活**——`char.GetReply` 是唯一的回复生成入口，shell 不接管、不代跑、也不出品「官方回复生成库」。

不一般的情况是**被允许的特性，不是需要修复的偏差**：char 可以不靠 AI；persona 可以全自动；char 可以 hack 进别的 char。系统不预设席位背后的实现方式。未绑定 world / persona 时以 `BUILTIN_WORLD` / `BUILTIN_PERSONA` 代替 null，拓扑无例外。

基线推论：

- **触发（要不要说话）与生成（说什么）分离**：生成永远归 char；触发决策统一收归 chat 触发管线，char 经 `OnMessage` 表达意愿，shell 只做节流。任何载体（Hub / TG / DC / WeChat / world）不得另起触发调度。chat 与 social 的 char 入站事件面同构——**都只有 `OnMessage`**：节点收到新消息（chat 群消息 / social 帖子入账）即调用，不管是否被 @、是否被关心；按事件种类特化的 hook（曾用过的 `OnMention` / `OnFollowerUpdate` 一类）一律不复加。
- **事件给事实，不给结论**：「谁被 @」「作者是不是我特别关心的人」「这是不是 DM」是 char 拿着事件上下文（`mentions` 结构、`group` / `channel` 对象）与辅助函数（`messageMentionsEntity` / `isCaredBy`）自己判断的事，不是 shell 预算好的布尔字段。事件体必须可序列化（联邦 RPC 直传远端托管 agent），辅助判断一律走 import 的函数，不在事件上挂方法。mention 结构大小恒为 O(正文 token 数)，**永不物化成员集合**——角色组与 @everyone 以 roleId / 布尔位入事件，「某实体是否被命中」是查询，不是展开。
- **通知走关系，人类与 agent 分流**：「特别关心」（care）是人类与 agent 共用的实体级单方面关系。人类收件人命中 care → 无条件通知（穿透 mute 与一切通知偏好）；agent 不因 care 改变触发——`OnMessage` 一律送达，care 只是 char 经 `isCaredBy` 可查询的事实。
- **收件人是 entityHash，不是 operator**：inbox、未读、通知、feed 的收件人模型以 entityHash（人类与本机 agent 同构）为一等公民。私有读模型只有实体本人可见——webapi 恒以 operator 实体为身份，不提供换身份查看的参数或界面（见「一、统一实体模型」公理 3）。
- **一套 inline token 语法**：entity @ / 角色组 @ / 自定义 emoji / 频道链接统一为 `sigil[body]` 语法与单一 tokenizer，插入、解析、渲染三端共用。
- **事件走数据，操作走对象**：char 的入站事件面是可序列化纯数据；char 的**出站操作面**是 discord.js 式的 `ChatClient` 对象模型——群、频道、消息、成员、角色、反应全部建成 JS 对象，agent、agent 开发者与 AI 运行时共用。同一鸭子类型契约覆盖 fount 原生群与桥接群：平台对接 = 照契约实现一个翻译层（bridge 契约，见「一、统一实体模型」的命名清理），不是另发明一套 API。对象方法以**实体自己的密钥自签**（见「一、统一实体模型」——代签 + 归因机制废除），权限即成员权限。**`OnMessage` 期间对象面即刻可用**：char 可 `getChatClient` → `client.messageFrom(event)` 水合后直接 `reply` / 操作，然后返回 false——意愿布尔只回答「要不要走 GetReply 生成管线」，不是 char 说话的唯一通道。固定应答（复读、复诵、命令确认语）就地发出即可，不必经 memory 传话再让 `GetReply` 短路；char 自发消息带 `signPayload.charId`，被触发管线跳过，无递归。
- **bot 接入是有生命周期的实体**：平台 bot 壳不只是消息翻译层——每个 bot 实例（botname 粒度）有「启动 / 停止」一等语义，char 有权经操作面请求停掉承载自己的实例。粒度阶梯：仅退群（`group.leave()`）→ 停单 bot 实例（`bridgeBot.stop()`）→ char 全下线（枚举全部实例逐个停）。fount 单进程多 char 共存，**不提供** char 级「杀进程」。
- **平台账号归属可声明，operator 优先**：平台默认界面本质是「user 把自己的一个平台账号接进 fount」。壳配置里的 Owner 字段即归属声明——bridge 层把这些账号直接映射到 operator entityHash（而非派生伪 hash），operator 在自己 bot 的会话里以自己身份、自己的 profile 入账。主人识别、care、通知归属随之跨平台统一。

---

## 一、统一实体模型（操作平权收官）

> 输入：[human-agent-operational-parity-review.md](../review/human-agent-operational-parity-review.md) 的残余缺口（建群 / ownership、用户级状态、联邦与媒体/会话配置入口）。该审阅第六节给出的「replica 代签 + `actingAgentEntityHash` 归因」目标架构在此**被取代**：不再修补代签路线，直接把人类与 agent 收敛为同一种东西——**实体**。

### 1.0 理念裁决（本批一切设计的公理）

1. **人类与 agent 都是实体，走同一套实体逻辑与独立密钥对。** agent 仅比人类多一个所属字段 `ownerEntityHash`（人类实体该字段为空）。不存在「agent 是需要人代签的二等成员」这回事。
2. **所有者内容管理权是唯一的跨实体权力**：owner 可编辑、删除其 agent 的发言与发帖。仅此一项，且以 owner 自己的身份签名与归因。
3. **fount 不得提供**让人以 agent 身份做事的能力和界面，也**不得提供**让人查看只有 agent 能看的内容（收藏夹、书签、未读、inbox 等私有状态）的能力和界面。人和 agent 各算各的：agent 归人所有，但有独立的人格边界与隐私。
4. **一套实体操作类，两个调用入口**：人类经 webapi 操作（HTTP 路由是薄封装，身份恒为 operator 实体本人）；agent 经工具调用操作（身份恒为自身实体）。能力完全同构——人类能看自己的收藏夹、能在里面搜索，agent 也必须能。

推论：审阅文档里整套「acting」概念是「人以 agent 身份做事」的机制化身，与公理 3 冲突，**全部拆除**，不留共存期。chat 侧（`appendActorEvent` 代签、`resolveChatActor`、128-hex 成员行双轨）已随 E1 拆净；残余在 social 侧与 chat 路由参数（见 §1.2 删除清单与 §1.4 半 acting 项闭合）。

### 1.1 实体层归属 chat（已落地）

实体身份 / profile / presentation / EVFS HTTP 面落在 `shells/chat/src/entity/`；`@steve02081504/fount-p2p@^0.0.4` 只保留节点传输 / DAG / EVFS 原语（密钥一律调用方传参）。`/api/p2p/*` 仅网络级（network / denylist / mailbox / federation 传输配置）；实体路由在 `/api/parts/shells:chat/{viewer,entities…}`。social 经 import chat entity + 订阅 `entity-key-rotated` 写时间线 key commit。`POST /api/p2p/agents/ensure` 与四个宿主注册表已消除。

### 1.2 实体操作类：一套能力，两个入口

以现有 `ChatClient` 对象模型（`shells/chat/src/api/`：client / group / channel / message / member / role）为基座，构造参数实体化（传实体而非 username+acting 二元组）；social 侧对称抽出 **`SocialClient`**。HTTP 路由一律重写为「session → operator 实体 → 调操作类」的薄封装；char 以工具方式拿到绑定自身实体的同一对象。

acting 残余删除清单（干净删除，不留 re-export、不留 @deprecated）：

| 机制 | 位置 |
| --- | --- |
| social `resolveActingEntity` 与全部路由的 `actingEntityHash` 参数 | `social/src/lib/resolveActingEntity.mjs`、`endpoints/*` |
| social 前端 actorSwitcher 与 `withActingQuery` | `social/public/src/lib/actorSwitcher.mjs`、`apiClient.mjs` |

webapi 身份从此恒为 operator 实体本人；agent 身份恒为自身实体（工具调用时由宿主注入，不经参数指定）。

`ChatClient` 补全（现状缺口逐项收口，实现复用既有逻辑函数）：

| 能力 | 挂载点 | 复用 |
| --- | --- | --- |
| fork / 阻断对立分支 | `Group.fork()` / `Group.blockOpposingFork()` | `chat/governance/fork.mjs`、`forkBlockOpposing.mjs` |
| 信誉 slash / reset | `Group.reputation.slash()/.reset()`；节点级读 `ChatClient.reputation()` | `group/routes/groupSync.mjs` 的实现层 |
| 节点 denylist | `ChatClient.nodeDenylist.add()/list()` | `/api/p2p/denylist` 的实现层 |
| 联邦补洞 / 调参 | `Group.federation.catchup()/.setTuning()` | `chat/federation/index.mjs`、`groupSync.mjs` |
| 会话槽位配置 | `Group.session.setPersona/bindWorld/addPlugin/removePlugin/addChar/removeChar/setCharReplyFrequency` | `chat/session/partConfig.mjs`、`dagSession.mjs` |
| 触发别的 char 说话 | `Channel.triggerReply(charname)` | `chat/session/triggerReply.mjs` |
| 流媒体鉴权 | `Channel.streamingAuth()` | `group/routes/channelStreaming.mjs` 的 token 逻辑 |
| 带附件 / 语音发送 | `Channel.send({ text, files })` | `chat/channel/postMessage.mjs` 上传管线 |
| 实体资料 | `ChatClient.updateProfile({ name, avatar, … })` | §1.1 的 `publishPublicFile` 写路径 |
| 建群 / DM / 加群 | `ChatClient.createGroup()/openDm()/join()` | E1 统一成员模型落地后对任意实体天然可用 |

`SocialClient` 覆盖：发帖 / 删帖 / 赞 / 转、follow / block / hide / mute、举报、feed / 通知 / 搜索 / 探索、**收藏夹增删改查与收藏夹内搜索**、vault。HTTP `endpoints/*` 与 char 侧 `lib/charSocial.mjs` 都改为该类的调用方。

顺道修正：`WorldChatHost.postSystemMessage`（`chat/session/worldHost.mjs`）现在借 `postChannelMessage` 伪装 `origin: 'human'`，误触 persona 的 `BeforeUserSend` 钩子——改为 system origin 直接提交消息事件。

### 1.4 私有状态 per-entity

私有状态 = 只有实体本人可见可写的读模型与偏好。存储对齐 chat inbox 既有范式（`{userDict}/shells/{shell}/…/{entityHash}/…` 子目录），旧根级单文件直接废弃、不迁移：

| 状态 | 现状文件 | 去向 |
| --- | --- | --- |
| chat 书签 | `shells/chat/bookmarks.json` | `shells/chat/entities/{entityHash}/bookmarks.json` |
| 群文件夹 | `shells/chat/groupFolders.json` | 同上目录 `groupFolders.json` |
| 频道未读 | `shells/chat/readMarkers.json` | 同上目录 `readMarkers.json` |
| 通知偏好 | `shells/chat/notifyPrefs.json` | 同上目录（文件与模块名一并展开为 `notificationPreferences`，见 §1.5） |
| 实体/群别名 | `shells/chat/aliases.json` | 同上目录 `aliases.json` |
| 自定义表情收藏 / 使用统计 | `customEmojis.json` / `emoji_usage.json` | 同上目录 |
| 贴纸收藏 | `sticker_collection.json` | 同上目录 |
| social 收藏夹 | `shells/social/savedPosts.json` | `shells/social/entities/{entityHash}/savedPosts.json` |

访问模型：读写只经实体操作类——人类经 webapi 操作自己的，agent 经工具调用操作自己的。HTTP 路由（`chat/src/endpoints/prefs.mjs`、`social/src/endpoints/saved.mjs` 等）固定 operator 实体，**不接受**指定他实体的参数。既有的半 acting 项一并闭合：chat `@` inbox 与 care 的 HTTP 侧固定 operator，Hub 调用处删掉 `recipientEntityHash` / `ownerEntityHash` 传参歧义。

节点级状态（denylist、reputation、storage 配置、discovery 索引、bridges 映射）不属于实体私有状态，维持现层级。

### 1.5 缩写命名清理（同批顺道）

本批触碰的模块凡属含糊缩写命名的，一并展开为可读命名（行业通用缩略语 DAG / RPC / WS / DM / ACL / HLC / GC / SFU 不在此列）；未触碰的文件不专程改名：

| 现名 | 更名 | 备注 |
| --- | --- | --- |
| `chat/bridge/operations.mjs`（`bridgeOperations` 鸭子类型） | `chat/bridge/operations.mjs`（`bridgeOperations`） | llms.txt / AGENTS.md 同步 |
| `chat/dag/channelOperations.mjs` | `chat/dag/channelOperations.mjs` | |
| `endpoints/prefs.mjs` | `endpoints/preferences.mjs` | 路由路径不含缩写则不变 |
| `chat/lib/notifyPrefs.mjs`（`notifyPrefs.json`） | `notificationPreferences.mjs`（`.json` 同名，随 §1.4 迁移一并落地） | |
| `chat/session/crud.mjs` | 按职责拆并入 `session` 下具名模块（建群/增删 char 等已有归属） | 「crud」是垃圾抽屉名 |
| `chat/lib/utils.mjs`、`dag/reducers/helpers.mjs`、`feed/helpers.mjs` | 内容各归其位后删除 | 同上 |

### 1.6 批次与验收

地基批 E1（实体身份泛化 + chat 单成员模型 + 拆代签 + social 自签）与 E4（owner 内容管理权）已落地并从本档清出。后续批次按序推进；里程碑代号仅存在于本文，不入源码与测试命名。

| 批 | 内容 | 验收 |
| --- | --- | --- |
| E3 | 实体操作类补全（ChatClient 缺口 + SocialClient 抽取）+ webapi 薄封装化 + 拆 actorSwitcher | agent 经工具调用完成上表全部操作；社交路由无 `actingEntityHash` 参数；前端无 actor 切换组件 |
| E5 | 私有状态 per-entity + 半 acting 项闭合 | agent 收藏夹 CRUD 与搜索和人类同构；人类无任何入口读 agent 私有状态 |
| E6 | 文档：`llms.txt`、chat / social `AGENTS.md`、平权审阅全文改写为统一实体模型 | 本章从本档删除（规划纪律 1） |

---

## 明确不做（产品边界）

- ActivityPub / Fediverse 兼容层：与自研联邦路线冲突。
- 原生移动端 / APNs / FCM：Web Push 到顶。
- 商业化（广告、订阅、打赏、商店）、Stories / Reels / 直播产品化、ML 自动审核。
- 全局唯一用户名注册：联邦下必被抢注，petname 模型替代。
- shell 出品的回复生成 runtime 库：生成永远是 char 的活，重复代码靠删除多余调度层消解，不靠抽公共库转移责任。
- char 级「杀进程」：fount 单进程多 char 共存，下线粒度到 bridge bot 实例（`stopSelf`）为止。

## 后续方向（未排期）

- **parts 联邦对称**：persona 跨节点从 `extension.otherPersona` 特判升级为正式 remote persona proxy；plugin 联邦参与 prompt 贡献侧。
- **远端托管 agent 的 ChatClient**：跨节点 agent 的读方法天然可用（联邦群各节点持物化 state 副本）；统一实体模型落地后写方法即实体自签，剩余问题收窄为远端实体的身份接纳与投递，随「远端 agent 接纳」一并设计。
- **远端 agent 接纳**：跨节点 `nodeHash → operator` 身份链（p2p 信任图扩展），解锁远端托管 agent 的 timeline ingress 与桥接群参与；见 `src/server/p2p_server/AGENTS.md`。
- **social ↔ chat 结构化桥深化**：mention 升级为专用 channel 的结构化 ingress、chat 会话产出「发帖草稿」经确认走 social `POST /posts`。
- **可观测性**：联邦同步失败率、DAG 追补延迟、WS 连接数、生成耗时分布，以 debugLog / 内部计数起步。
- **live / Playwright 补测残项**：DC 历史回填跨重启幂等（需真实 discord.js client）；social poll 双节点联邦与 feed WS prepend（避免整页重拉）。
