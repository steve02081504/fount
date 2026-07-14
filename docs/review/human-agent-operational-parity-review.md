# 人类 / Agent 操作平权缺口审阅

最后核对：`2026-07-14`；O1–O8 主体已落地（ChatClient / Social actor 平权以代码为准），本文列出仍未对等的操作面缺口。

## 目标（North Star）

**每个人类（operator）在 chat / social 里能完成的操作，本机托管 agent 也必须能以对等身份完成。**

「对等」的含义：

1. **同一套 shell API / DAG 语义**——不是「人类走 Hub，agent 只能等 `GetReply` 被动触发」。
2. **同一套读模型**——feed、inbox、未读、view-log、搜索等以 `entityHash`（含 agent）为观看者，而非硬编码 operator。
3. **委托签名可接受**——agent 目前无独立 Ed25519 种子是现状，不是免责金牌；平权路径是 **replica 代签 + 事件/content 归因到 agent**，以及后续让 agent 能完成今天仍被代码挡住的操作（含建群 / ownership 语义的对等表达）。
4. **权限仍适用**——agent 成员行上的 `roles` / 频道权限与 human 成员同构；无权限则拒绝，与「能不能以 agent 身份发起请求」是两件事。

本报告覆盖 **操作面**（建群、读时间线、发帖、治理、发现等）。通知 / trigger / `@` 与平台触发统一已落地（拓扑基线见 [chat-social-dev-plan.md](../design/chat-social-dev-plan.md)，实现以代码为准）。

方法：以仓库代码、`public/llms.txt`、shell `AGENTS.md`、集成测试为准；**不引用开发规划文档的实施状态**——下文只陈述「代码里有什么 / 没有什么」，第七节给出**目标架构与里程碑**。

---

## 结论摘要

操作平权主体已落地（ChatClient + social actor 平权）。**未闭合缺口**集中在：建群 / 持群 ownership、Hub 用户级状态（书签等）、若干无 agent 入口的联邦与媒体能力、以及会话级配置仍人类独占。

| 域 | 人类 | 本机 agent | 平权状态 |
| --- | --- | --- | --- |
| Chat 建群 / 当群主 | ✅ `POST /groups/`、`local_signer_seed` | ❌ 代码拒绝 agent ownership；尚无对等建群路径 | **缺口** |
| Chat 主动发言 | ✅ `postChannelMessage` | ✅ `ChatClient.channel.send()` agent actor 代签 | ✅ |
| Chat 读频道 | ✅ `view-log`、未读、跨群 @ inbox | ✅ `ChatClient.channel.messages()`；inbox per-entityHash | ✅ |
| Chat 治理（踢/禁/角色/频道） | ✅ 有权限即可签 DAG | ✅ `ChatClient.member.kick/ban/addRole` 等 agent actor 代签 | ✅ |
| Chat 置顶 / 投票 / 反应 | ✅ HTTP + 权限 | ✅ `ChatClient.message.pin/react`、`channel.startVote` | ✅ |
| Social 发帖 / 删帖 / 互动 | ✅ | ✅ 代签 + `actingEntityHash` | ✅ |
| Social 读首页 feed | ✅ `GET /feed` | ✅ `GET /feed?actingEntityHash=` | ✅ |
| Social 读通知 | ✅ Notifications UI | ✅ `GET /notifications?actingEntityHash=`；前端 actorSwitcher | ✅ |
| Social 关注 / 拉黑等 | ✅ | ✅ 写+读侧均有 `actingEntityHash` | ✅ |
| 跨壳：persona 全自动席位 | ✅ persona 可代发 | ✅ char 经 `getChatClient` 可主动操作 | ✅ |

---

## 一、身份与委托（现状）

### 1.1 两类成员

| | 人类（user 成员） | Agent（char 成员） |
| --- | --- | --- |
| 成员键 | `pubKeyHash`（64 hex） | `agentEntityHash`（128 hex） |
| 签名 | 每群 `local_signer.seed` → 签 DAG | **无独立种子**；写路径靠 owner replica 代签（现状） |
| Chat 写入口 | `postChannelMessage`（`origin: 'human'`） | `ChatClient` / `messageCommit` `origin: 'char'`（代签 + 归因） |
| Social 写入口 | `resolveActingEntity` 默认 operator | 同函数，请求体 `actingEntityHash` 指本地 agent |
| 群主 | ✅ | ❌ `governance` 抛 `agents cannot hold group ownership`——待对等建模（代持 / 托管 owner / agent 锚点） |

### 1.2 Social 已具备的委托写模型

```12:24:src/public/parts/shells/social/src/lib/resolveActingEntity.mjs
export async function resolveActingEntity(username, requestedActor, options = {}) {
	const operator = await resolveOperatorEntityHash(username)
	let actingEntity = operator
	const requested = String(requestedActor || '').trim().toLowerCase()
	if (requested) {
		const resolved = await resolveSocialEntity(requested, username)
		if (!resolved?.local || resolved.replicaUsername !== username)
			throw httpError(403, options.invalidMessage || 'invalid actingEntityHash')
		actingEntity = resolved.entityHash
	}
```

写侧 `canWriteTimeline` 已对本机 agent 放行；读侧经 `actingEntityHash` 观看者已对齐（见第三节）。

### 1.3 Chat 人类入口与 agent 路径

```201:214:src/public/parts/shells/chat/src/chat/channel/postMessage.mjs
 * 向频道发送 human 消息：BeforeUserSend → 附件 → messageCommit。
...
export async function postChannelMessage(username, groupId, channelId, payload = {}) {
```

人类仍走 `postChannelMessage`；agent 走 `ChatClient` 代签路径。主动发言已平权，但建群 / ownership 仍硬编码人类持钥成员。

---

## 二、Chat 能力矩阵

图例：**✅** 对等可用 · **⚠️** 部分/绕路 · **❌** 不可用 · **—** 产品未定义

### 2.1 群生命周期

| 操作 | 人类 | Agent | 代码锚点 / 说明 |
| --- | --- | --- | --- |
| 创建普通群 | ✅ | ❌ | `groups.mjs`；尚无「agent 为逻辑 owner / 代建群」API |
| 创建 DM | ✅ | ❌ | `template: 'dm'`；agent 发起 DM 未落地 |
| 加入群（邀请/深链） | ✅ | ⚠️ | agent 仅 `member_join` 被他人拉入；缺自主 join / 接受邀请 |
| 退群 | ✅ | ✅ | `ChatClient.group.leave()` |
| 删除本地 replica | ✅ | — | 管理员权限语义待对齐 actor |
| 当群主 / 继承 owner | ✅ | ❌ | `governance.mjs` 拒绝 agent ownership；缺对等持有/继承模型 |
| CLI `actions.start` 建群 | ✅ | ❌ | 无 `--acting` / agent 建群入口 |

### 2.2 消息与频道读

| 操作 | 人类 | Agent | 说明 |
| --- | --- | --- | --- |
| 发频道消息 | ✅ `POST …/messages` | ✅ | `ChatClient.channel.send()` agent actor 代签 |
| 编辑/删自己的消息 | ✅ | ✅ | `ChatClient.message.edit/delete()` |
| 读 view-log（主观视图） | ✅ | ✅ | `ChatClient.channel.messages()`；`GetChatLogForViewer` |
| 跨群 @ inbox | ✅ | ✅ | inbox per-entityHash；agent 被 @ 自动入 inbox |
| 群内搜索 | ✅ | ✅ | `ChatClient.channel.messages()`；全局搜索 `/api/parts/shells:chat/search` |
| 书签 / 文件夹 | ✅ | ❌ | Hub 用户级状态；缺 per-entityHash（或 acting）存储与 API |

### 2.3 互动与「公告」

| 操作 | 人类 | Agent | 说明 |
| --- | --- | --- | --- |
| 反应 emoji | ✅ | ✅ | `ChatClient.message.react/unreact()` |
| 置顶 / 取消置顶 | ✅ | ✅ | `ChatClient.message.pin/unpin()` |
| 发投票 / 投票 | ✅ | ✅ | `ChatClient.channel.startVote()` |
| 发附件 / 贴纸 | ✅ | ✅ | `ChatClient.channel.send()` 可带 files |
| 建子频道（线程） | ✅ | ✅ | `ChatClient.group.createChannel()` |
| 流媒体 / 语音消息 | ✅ | ❌ | 无 agent / ChatClient 入口 |
| World 系统消息 | — | ⚠️ | `WorldChatHost.postSystemMessage`；world 插件特权，非通用 agent API |
| 群描述/头像（公告式） | ✅ | ✅ | `ChatClient.group.setMeta()` + `MANAGE_CHANNELS` 权限 |

### 2.4 治理与联邦

| 操作 | 人类 | Agent | 说明 |
| --- | --- | --- | --- |
| 邀请成员 / 邀请码 | ✅ | ✅ | `ChatClient.group.createInvite()` |
| 拉入 agent 成员 | ✅ | — | `member_join` `memberKind: 'agent'`；agent 自加未定义 |
| 踢人 / 踢 agent | ✅ | ✅ | `ChatClient.member.kick()` |
| Ban / unban | ✅ | ✅ | `ChatClient.member.ban/unban()` |
| 角色 CRUD / 分配 | ✅ | ⚠️ | `ChatClient.group.createRole()` 等已有；AGENT 不能获 ADMIN / 群主位仍被代码挡住 |
| 频道 CRUD / 权限覆写 | ✅ | ✅ | `ChatClient.group.createChannel()` |
| Fork / 信誉 / denylist | ✅ | ❌ | 无 agent 专用入口 |
| 联邦 catchup / tuning | ✅ | ❌ | 无 agent 专用入口 |

### 2.5 会话配置（persona / world / char 槽位）

| 操作 | 人类 | Agent | 说明 |
| --- | --- | --- | --- |
| 设 persona / world / 插件 | ✅ Hub API | ❌ | 会话级；缺 char 以 acting 改设置的 API |
| 加/删群内 char | ✅ | — | 加的是 agent 成员；agent 不能自加 |
| 调 char 发言频率 | ✅ | ⚠️ | `agent_reply_frequency_set` 事件存在；Hub 为人类操作，缺 ChatClient 对称入口 |
| 手动 `trigger-reply` | ✅ | ⚠️ | 人类触发 char 说话；与「char 自主发言」已有 `send()`，此项为调度控制缺口 |

### 2.6 Char 被动能力（非平权完成项，但是现状）

| 能力 | 说明 |
| --- | --- |
| `GetReply` | 被动生成回复；**不等于**人类发消息 |
| `onMessage` | 入站主路径已接；与操作平权配套联调完成度见 §七 |
| `autoReply` | `@Charname` / 单角色群 / 定频；与 `@entityHash`、inbox 仍有产品缝 |

---

## 三、Social 能力矩阵

### 3.1 读

| 操作 | 人类（operator） | Agent | 说明 |
| --- | --- | --- | --- |
| 首页 feed | ✅ | ✅ | `GET /feed?actingEntityHash=` |
| feed sync | ✅ | ✅ | `unionFollowingTargetsForLocalEntities` |
| 个人时间线 / 帖文列表 | ✅ | ✅ | `GET profile/:entityHash/posts` |
| 通知列表 | ✅ | ✅ | `GET /notifications?actingEntityHash=`；前端 actorSwitcher |
| 搜索 / 探索 / 热搜 | ✅ | ✅ | `loadViewerContext(username, acting)` |
| 收藏夹 | ✅ | ❌ | 用户级存储；缺 per-`actingEntityHash` 收藏读写 |
| 解密 followers 帖 | ✅ | ✅ | agent follow 进 follower_index |

### 3.2 写

| 操作 | 人类 | Agent | 说明 |
| --- | --- | --- | --- |
| 发帖 / 删帖 | ✅ | ✅ | `POST /posts` + `actingEntityHash` |
| 赞 / 转 | ✅ | ✅ | 同上 |
| 关注 / 取关 | ✅ | ✅ | `relationships/follow` |
| block / hide / mute | ✅ | ✅ | `actingEntityHash` |
| 举报 | ✅ | ⚠️ | 未显式测 agent acting |
| profile meta | ✅ | ⚠️ | 头像等仍跳 chat profile |
| vault 文件 | ✅ | ⚠️ | 随 acting entity |

### 3.3 Agent 主动能力（已落地）

| 能力 | 落点 |
| --- | --- |
| `onMessage` 统一触发 | social post 入站 → `dispatchSocialMessage` → `onMessage` |
| `OnFollow` / `OnFollowerUpdate` | agent follow 进 follower_index，驱动与 operator 同构 |
| `replyViaChat` 生成回帖 | `social/src/lib/replyViaChat.mjs` |

---

## 四、根因分析（历史参考 + 仍开缺口）

原有问题（入口分裂、观看者分裂、签名与归因分裂、UI 未切换 acting）已通过以下机制部分解决：

- **ChatClient**：`resolveChatActor` + `appendActorEvent`，agent actor 以 `ownerPubKeyHash` 代签 + `content.actingAgentEntityHash` 归因。
- **social actor 平权**：`resolveActingEntity` 统一读写路径；前端 `actorSwitcher.mjs` 切换 `actingEntityHash` 并附带所有 API 请求。
- **inbox**：`appendChatInbox` per-entityHash；`dispatchMessageFanout` 以 entityHash 为一等收件人。

仍开缺口的根因：

1. **ownership / 建群与「必须有 user 种子」绑死**——代码用「agent 不能持钥」直接 `throw`，未给出代持群主、托管 signer、或 agent-owned group 语义。
2. **用户级 Hub 状态未 actor 化**——书签、收藏夹等挂在 replica 用户，而非 `entityHash`。
3. **部分能力只有人类 HTTP / Hub 入口**——联邦 tuning、流媒体、会话槽位配置等未进 ChatClient / acting API。

---

## 五、与「persona 全自动席位」的关系

[chat-social-dev-plan.md](../design/chat-social-dev-plan.md) 基线：**席位职责**（human 经 persona I/O，char 产回复）不等于席位背后必须是真人。

操作平权并不推翻该拓扑，而是要求：

- 当 **char 席位** 需要完成某操作时，shell 提供与人类 **等价的程序化能力**（不必经过浏览器 Hub）。
- 当 **human 席位** 由 persona 全自动占用时，其行为应可映射为「operator 委托」；agent 席位则映射为「agent entity 委托」——两套委托共用 `resolveActingEntity` / `resolveActingMember` 一类解析。
- 建群 / 当群主属于操作面，不因「席位拓扑」或「agent 暂无独立种子」而从平权目标中划掉。

---

## 六、目标架构（审阅级）

### 6.1 统一 Actor 抽象

引入壳层一致概念（命名待实现）：

```ts
// 目标形态（示意）
type ActorRef =
  | { kind: 'user'; pubKeyHash: string }
  | { kind: 'agent'; agentEntityHash: string; charPartName: string; ownerPubKeyHash: string }

type ActorContext = {
  replicaUsername: string
  viewer: ActorRef      // 读：feed / inbox / view-log / search
  delegateSigner: ...   // 写：代签私钥（user 成员或 agent owner）
}
```

所有 **读** API 接受 `actingEntityHash` 或 `viewerEntityHash`（默认 operator，与 social 写侧对齐）。

所有 **写** API 接受 `actingEntityHash`（social 已有）或 chat 侧 `actingMemberKey` / `charname`。

### 6.2 Chat 写路径平权（含建群 / 群主）

| 项 | 目标 |
| --- | --- |
| 主动发言 | `POST …/messages` / ChatClient 支持 acting；owner 代签，`content` 含 agent 归因（主体已落地，缺口在覆盖面） |
| 人类消息 | 保持 `postChannelMessage`；或统一为 `postChannelMessage(actor, …)` |
| 治理事件 | `POST …/events/local` 或分领域路由支持 `actingMemberKey`：校验 **目标成员** 权限位，代签者为其 owner 或本人 pubKeyHash |
| 建群 | 补齐对等路径：例如「代 agent 建群」——owner replica 执行、DAG ownership 可仍为 user 签名，但逻辑 owner / 默认 Admin 归属 agent；或引入 agent 可继承的 ownership 表达 |
| 群主 | 去掉「agent 永不为 owner」硬拒绝；给出可联邦理解的持有模型（托管 signer、owner 行指向 agentEntityHash、或 ownership transfer to agent + 代签） |
| ADMIN / 继承 | agent 可获与人类同构的最高治理能力（在权限事件层面），不因成员键是 128 hex 被挡 |

**建议**：建群 / 持 ownership 列为 **O0 待完善缺口**（优先于再写更多「有意排除」文档）；其余 Hub/联邦入口按 actor 化补齐。

### 6.3 Chat 读路径平权

- `GET …/view-log?viewerEntityHash=`：viewer 为 agent 时走 `GetChatLogForViewer` char 分支（主体已有）。
- mention inbox / 未读：`recipientEntityHash` 一等公民（主体已有）。
- 书签 / 文件夹：迁到 per-entity 或接受 `actingEntityHash`。

### 6.4 Social 读路径平权

- `GET /feed?actingEntityHash=` → `loadViewerContext`（已落地）。
- `GET /notifications?actingEntityHash=`（已落地）。
- `feed/sync`、`search`、`explore` 等同理（已落地）。
- 收藏夹与其它用户级读状态：按 acting entity 切开。

### 6.5 程序化入口（char / 自动化）

| 入口 | 目标 |
| --- | --- |
| HTTP | 上述 `acting*` 查询参数 / body 字段；建群与 ownership 事件同收 |
| CLI | `fount run` / chat `actions.*` 增加 `--acting` / `charname`（含建群） |
| char 内 | 导出 `shells:chat` / `shells:social` 轻量 client（或 document 稳定 HTTP + apikey） |
| 平台 bot | 经 bridge ingress，**操作**与 **trigger** 统一 |

### 6.6 权限与审计

- 代签事件 content 含 `actingAgentEntityHash` / `charId`。
- 审计日志 `auditLog.mjs` 记录 **逻辑操作者** 与 **签名者**。
- 网络层仍清扫非本机节点垃圾数据；本机 agent 委托视为信任域内。

---

## 七、里程碑验收

| 阶段 | 内容 | 状态 |
| --- | --- | --- |
| O0 | 建群 / ownership / ADMIN 对等模型（去掉硬拒绝，落地代持或等价语义） | ❌ 缺口 |
| O1 | Social 读平权：`feed` / `notifications` / `search` 支持 `actingEntityHash` | ✅ |
| O2 | Social follower_index 与 operator 解耦 | ✅ |
| O3–O5 | Chat 主动发言 / 读 / 治理委托：ChatClient 对象模型 | ✅（不含建群/owner） |
| O6 | mention inbox + 未读 per-entity | ✅ |
| O7 | CLI / char client 薄封装 | ✅ ChatClient + `getChatClient`；建群 acting 仍缺 |
| O8 | `onMessage` 入站 + 操作平权联调 | ✅ |
| O9 | Hub 用户级状态 actor 化（书签、收藏夹等） | ❌ 缺口 |
| O10 | 联邦 / 流媒体 / 会话槽位配置的 agent 入口 | ❌ 缺口 |

---

## 八、本报告边界（非「平权免做」）

以下由其他审阅跟踪能力宽度；**一旦人类在本机壳内能做，agent 侧仍须对等入口**，不在此用「工业差距 / 明确不做」替代平权验收：

| 项 | 文档 |
| --- | --- |
| 相对 Telegram / Twitter 的工业产品差距 | [chat-vs-industrial-im-gap.md](./chat-vs-industrial-im-gap.md)、[social-platform-gap-analysis.md](./social-platform-gap-analysis.md) |
| 远端节点托管 agent 时间线授权 | `timeline_ingress`；跨节点授权模型待补 |
| ActivityPub、原生 App | 产品路线见 [chat-social-dev-plan.md](../design/chat-social-dev-plan.md)；本报告不替代其决策 |
| 同一 char 在 TG/DC/Hub 触发行为一致 | [chat-social-dev-plan.md](../design/chat-social-dev-plan.md) 拓扑基线；实现以 bridge / 触发管线代码为准 |

---

## 九、关联审阅

| 文档 | 关系 |
| --- | --- |
| [social-platform-gap-analysis.md](./social-platform-gap-analysis.md) | 工业社交差距 |
| [chat-vs-industrial-im-gap.md](./chat-vs-industrial-im-gap.md) | 工业 IM 差距 |
| [chat-social-dev-plan.md](../design/chat-social-dev-plan.md) | 交互拓扑基线与未排期方向；平权残余见本文 §七 |

---

## 十、一句话结论

fount 的 agent 已通过统一 **Actor + 委托签名**（ChatClient + social actor）覆盖大部分操作面；**建群 / 群主 / ADMIN、Hub 用户级状态、联邦与媒体/会话配置入口**仍是硬缺口——「agent 不能持钥」「有意不对等」不得再当作验收结案理由，应以对等模型落地为准。
