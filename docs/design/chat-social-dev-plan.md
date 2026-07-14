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

- [human-agent-operational-parity-review.md](../review/human-agent-operational-parity-review.md)：操作平权（统一实体模型已落地；对象面残余实现债见该档 §六）
- [social-platform-gap-analysis.md](../review/social-platform-gap-analysis.md)：social 产品差距
- [chat-vs-industrial-im-gap.md](../review/chat-vs-industrial-im-gap.md)：chat 工业 IM 差距

一句话总纲：**一种实体、一处收件人、一处 trigger、一层名字、一套 token、一套对象模型**——人类与 agent 同为持独立密钥对的实体（agent 仅多 `ownerEntityHash` 所属字段）；通知与触发以 entityHash 为一等收件人拉平人类与 agent；chat 与 social 的 char 入站事件面统一为 `OnMessage`；chat / social 的操作面以 `ChatClient` / `SocialClient` 统一（agent、agent 开发者、桥接平台三方共用一套鸭子类型契约）；平台 bot 壳退化为该契约的翻译层，触发决策收归 chat 管线；hash 之上铺具名层；entity @ / 角色组 @ / emoji 收敛为一套 inline token 语法。

不向后兼容原则不变：直接删除替换、不留共存期、不写迁移代码。

上一周期（收件人 / 触发 / 具名层 / ChatClient / bridge / bot 生命周期与 operator 认领 / 龙胆迁移 / social `OnMessage` 与 actor 平权 / poll·edit·for_you）与统一实体模型整批（实体身份泛化 / 单成员模型 / 拆代签与 acting / SocialClient / 私有状态 per-entity / owner 内容管理权 / 文档收口）已完成并从本档清出。代签类缺口已关；Client 旁路仍默认 operator 的实现债与公理修订以 [平权审阅](../review/human-agent-operational-parity-review.md) 为准，不在本档重复开里程碑。

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
- **收件人是 entityHash，不是 operator**：inbox、未读、通知、feed 的收件人模型以 entityHash（人类与本机 agent 同构）为一等公民。私有读模型只有实体本人可见——webapi 恒以 operator 实体为身份，不提供换身份查看的参数或界面（人类不得窥视 agent 收藏夹 / inbox 等）。
- **一套 inline token 语法**：entity @ / 角色组 @ / 自定义 emoji / 频道链接统一为 `sigil[body]` 语法与单一 tokenizer，插入、解析、渲染三端共用。
- **事件走数据，操作走对象**：char 的入站事件面是可序列化纯数据；char 的**出站操作面**是 discord.js 式的 `ChatClient` / `SocialClient`——群、频道、消息、成员、角色、反应、帖子与关系全部建成 JS 对象，agent、agent 开发者与 AI 运行时共用。同一鸭子类型契约覆盖 fount 原生群与桥接群：平台对接 = 照契约实现一个翻译层（`bridgeOperations`），不是另发明一套 API。对象方法以**实体自己的密钥自签**，权限即成员权限。**`OnMessage` 期间对象面即刻可用**：char 可 `getChatClient` → `client.messageFrom(event)` 水合后直接 `reply` / 操作，然后返回 false——意愿布尔只回答「要不要走 GetReply 生成管线」，不是 char 说话的唯一通道。固定应答（复读、复诵、命令确认语）就地发出即可，不必经 memory 传话再让 `GetReply` 短路；char 自发消息带 `signPayload.charId`，被触发管线跳过，无递归。
- **bot 接入是有生命周期的实体**：平台 bot 壳不只是消息翻译层——每个 bot 实例（botname 粒度）有「启动 / 停止」一等语义，char 有权经操作面请求停掉承载自己的实例。粒度阶梯：仅退群（`group.leave()`）→ 停单 bot 实例（`bridgeBot.stop()`）→ char 全下线（枚举全部实例逐个停）。fount 单进程多 char 共存，**不提供** char 级「杀进程」。
- **平台账号归属可声明，operator 优先**：平台默认界面本质是「user 把自己的一个平台账号接进 fount」。壳配置里的 Owner 字段即归属声明——bridge 层把这些账号直接映射到 operator entityHash（而非派生伪 hash），operator 在自己 bot 的会话里以自己身份、自己的 profile 入账。主人识别、care、通知归属随之跨平台统一。

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
- **远端托管 agent 的 ChatClient**：跨节点 agent 的读方法天然可用（联邦群各节点持物化 state 副本）；写方法即实体自签，剩余问题收窄为远端实体的身份接纳与投递，随「远端 agent 接纳」一并设计。
- **远端 agent 接纳**：跨节点 `nodeHash → operator` 身份链（p2p 信任图扩展），解锁远端托管 agent 的 timeline ingress 与桥接群参与；见 `src/server/p2p_server/AGENTS.md`。
- **social ↔ chat 结构化桥深化**：mention 升级为专用 channel 的结构化 ingress、chat 会话产出「发帖草稿」经确认走 social `POST /posts`。
- **可观测性**：联邦同步失败率、DAG 追补延迟、WS 连接数、生成耗时分布，以 debugLog / 内部计数起步。
- **live / Playwright 补测残项**：DC 历史回填跨重启幂等（需真实 discord.js client）；social poll 双节点联邦与 feed WS prepend（避免整页重拉）。
