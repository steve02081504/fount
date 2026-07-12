# Chat / Social 开发规划

更新：`2026-07-12`

> 本文档是**实施级规划**：每个批次写明改哪些文件、新 API 的名字与参数、删除什么。做没做、做到哪，以仓库代码与各 shell 测试为准。
>
> 已落地能力见审阅附录：[chat-vs-industrial-im-gap.md](../review/chat-vs-industrial-im-gap.md)、[social-platform-gap-analysis.md](../review/social-platform-gap-analysis.md)。

## 定位与输入

本周期输入为 `2026-07-12` 四份缺口审阅（只陈述现状，设计以本文为准）：

- [human-agent-operational-parity-review.md](../review/human-agent-operational-parity-review.md)：操作平权缺口
- [human-agent-notification-parity-review.md](../review/human-agent-notification-parity-review.md)：通知 / trigger 平权缺口
- [chat-platform-trigger-unification-review.md](../review/chat-platform-trigger-unification-review.md)：触发调度碎片化
- [social-platform-gap-analysis.md](../review/social-platform-gap-analysis.md)：social 产品差距

一句话总纲：**一处收件人、一处 trigger、一层名字**——通知与触发以 entityHash 为一等收件人拉平人类与 agent；平台 bot 壳退化为消息翻译层，触发决策收归 chat 管线（龙胆随之弃用自研界面）；hash 之上铺具名层；social 补齐投票 / 编辑 / 推荐排序等产品面。

不向后兼容：`@Charname` 触发特例、`default_interface` 自管 log、operator 硬编码收件人、旧 `/mentions` 路由等直接删除替换，不留共存期、不写迁移代码（旧 `mention-inbox/events.jsonl` 之类的历史数据直接作废）。

**龙胆源码位置**：`data/users/steve02081504/chars/GentianAphrodite/`（架构说明见该目录下 `AGENTS.md`；M6 的迁移映射表以此为准）。

---

## 〇、交互拓扑基线（谁和谁说话）

所有工作流的设计都以下面这条**一般交互逻辑**为基线：

- **人类 ↔ persona**：人类通过网页或 CLI 与 persona 交互。persona 是真人 I/O 的一等中间层，human UI 不是绕过 part 系统的裸通道。
- **world → persona / char**：world 通过发起 API 调用与 persona 和 char 交互（喂视图 `GetChatLogForViewer`、贡献 prompt、裁决发言顺序、代发回复等）。
- **world → chat 存储 / p2p 层**：world 通过 `WorldChatHost` 使用 chat 的存储与 p2p 层。
- **char 内部**：char 调用 AI 或插件完成回复。**回复生成从始至终是 char 的活**——`char.GetReply` 是唯一的回复生成入口，shell 不接管、不代跑、也不出品「官方回复生成库」。

不一般的情况是**被允许的特性，不是需要修复的偏差**：char 可以不靠 AI；persona 可以全自动；char 可以 hack 进别的 char。系统不预设席位背后的实现方式。未绑定 world / persona 时以 `BUILTIN_WORLD` / `BUILTIN_PERSONA` 代替 null，拓扑无例外。

本周期在此基线上补两条推论：

- **触发（要不要说话）与生成（说什么）分离**：生成永远归 char；触发决策统一收归 chat 触发管线，char 经 `onMessage` 表达意愿，shell 只做节流。任何载体（Hub / TG / DC / WeChat / world）不得另起触发调度。chat 与 social 的 char 入站事件面同构——**都只有 `onMessage`**，`OnMention` 这类按事件种类特化的 hook 一律删除；「谁被提及」「作者是不是我关心的人」是 char 拿着辅助函数自己判断的事，不是 shell 替它预算好的布尔字段。
- **收件人是 entityHash，不是 operator**：inbox、未读、通知、feed 的收件人模型以 entityHash（人类与本机 agent 同构）为一等公民；operator 只是默认 viewer。

---

## M1 — Chat 收件人与触发统一

### 现状锚点

- `src/public/parts/shells/chat/src/chat/dag/eventPersist.mjs` 的 `broadcastAndPersist` 在 message 落盘后调 `maybeAppendMentionInbox`（**仅 operator**）与 `maybeAutoTriggerCharReply`。
- `src/chat/session/autoReply.mjs` 用 `^@([\w.-]+)` 匹配 `@Charname` 触发；`onMessage` 只在 `triggerReply.mjs::getCharReplyFrequency` 的链式/定频路径被调，**未接入入站主路径**。
- mention inbox 存 `{userDict}/shells/chat/mention-inbox/events.jsonl`，行无 recipient 字段。

### 1.1 统一 chat inbox（per-recipient）

新建 `src/public/parts/shells/chat/src/chat/lib/inbox.mjs`，**删除** `mentionInbox.mjs`：

```js
// 存储：{userDict}/shells/chat/inbox/{recipientEntityHash}/events.jsonl + read.json
export async function appendChatInbox(username, recipientEntityHash, row)
// row: { kind: 'mention'|'dm'|'vote_closed', groupId, channelId, eventId,
//        authorEntityHash, authorDisplayName, textPreview, at }
export async function listChatInbox(username, recipientEntityHash, { limit, cursor, kinds })
// 返回 { items, nextCursor, unreadCount }；cursor 沿用 "${at}:${groupId}:${eventId}"
export async function getChatInboxSeenAt(username, recipientEntityHash)
export async function setChatInboxSeenAt(username, recipientEntityHash, at)
```

路由改造：`src/endpoints/mentions.mjs` 重写为 `src/endpoints/inbox.mjs`（删除旧 `/mentions` 三条路由）：

```
GET /api/parts/shells:chat/inbox?recipientEntityHash=&kinds=&limit=&cursor=
GET /api/parts/shells:chat/inbox/seen?recipientEntityHash=
PUT /api/parts/shells:chat/inbox/seen         body: { at, recipientEntityHash? }
```

`recipientEntityHash` 缺省 = operator（`resolveOperatorEntityHash(username)`）；指定值须为 operator 或本机托管 agent 的 entityHash（校验方式对齐 social `resolveActingEntity`），否则 403。

### 1.2 消息落盘后的统一分发

新建 `src/chat/dag/messageFanout.mjs`，`eventPersist.mjs` 在 message 落盘后改调它（替换现有 `maybeAppendMentionInbox` + `maybeAutoTriggerCharReply` 两行）：

```js
export async function dispatchMessageFanout(username, groupId, channelId, messageLine)
```

内部流程：

1. `extractMentionEntityHashes(text)`（`src/public/pages/scripts/lib/mentions.mjs`，已有）得 mention 集合；M2 再叠加角色组展开。
2. 对每个 mention 命中的**本机收件人**（operator entityHash 或群内 agent 成员的 `agentEntityHash`，用 `memberEntityHash(member)` 比对物化 `state.members`）：`appendChatInbox(..., { kind: 'mention', ... })`。自己 @ 自己跳过。
3. 调 `runTriggerPipeline(...)`（见 1.3），把 mention 集合传进去。

WS 广播 `channel_message`（含 `mentionedEntityHashes`）保持不变。

### 1.3 触发管线

新建 `src/chat/session/triggerPipeline.mjs`，**删除** `autoReply.mjs`（其 `@Charname` 正则、单 char 全回、定频计数逻辑全部废弃或收编）：

```js
export async function runTriggerPipeline(username, groupId, channelId, messageLine, { mentionedEntityHashes })
```

流程：

1. 跳过条件沿用：`content.isAutoTrigger || signPayload.charId || content.role === 'char'`。
2. 对群内每个本机 char 成员计算 `mentioned = agentEntityHash ∈ mentionedEntityHashes`。
3. **意愿**：char 有 `interfaces.chat.onMessage` → 调用（新事件形状见 1.4），返回值即意愿；无 `onMessage` → 默认意愿 = `mentioned || 群内仅一个 char || 群为 DM`。
4. **节流**（shell 级，意愿之后）：现 `getCharReplyFrequency` 里的 token bucket（`autoReplyTokenBucketEnabled` / `autoReplyTokenBurst` / `autoReplyTokenRefillPerMessage`）搬到这里，按 `(groupId, channelId, charname)` 记账；`mentioned` 直通不扣节流否决权（仍扣 token）。`autoReplyFrequency` 群设置保留语义：作为无 `onMessage` 且未 mention 时的兜底概率（每 N 条触发一次的计数器搬入本文件）。
5. **裁决**：mentioned 的 char 全部 `triggerCharReply`；其余有意愿者经 `pickNextCharForReply` 加权选一个。
6. `isCharReplyInFlight` 去重保持。

`triggerReply.mjs` 的链式轮询（`executeGeneration` 结束后 `handleAutoReply`）、world `GetSpeakingOrder`、`getCharReplyFrequency` 保留，仅同步 1.4 的 `onMessage` 新签名。

### 1.4 charAPI 扩展

`src/decl/charAPI.ts` 中 `interfaces.chat.onMessage` 事件形状扩展为：

```ts
onMessage?: (event: {
  chatReplyRequest: chatReplyRequest_t,
  onlineCount: number,
  mentioned: boolean,        // 本 char 是否被本条消息 @（含角色组展开）
  message: chatLogEntry_t,   // 触发本次询问的消息条目
}) => Promise<boolean>
```

同步更新调用点：`triggerReply.mjs`、`federation/rpcDispatcher.mjs` case `'onMessage'`、`federation/remoteProxy.mjs`。

### 1.5 Hub 前端

- `public/hub/mentionsInbox.mjs` / `mentionsView.mjs`：切到 `/inbox` 路由；`#mentions` 视图按 `kind` 分标签（M1 只有 mention，M2 加 dm / vote_closed）。
- `groupStream.mjs` 的 badge bump 逻辑不变。

### 验收

- 集成测试重写 `chat/test/integration/mention_inbox.test.mjs` → `inbox_recipients.test.mjs`：以通知平权审阅第二节场景矩阵为蓝本——`@entityHash` @ 本机 agent → agent inbox 可查 **且** 被触发回复；`@entityHash` @ operator → operator inbox 可查；`@Charname` 纯文本不再触发任何 char。
- 新增 `trigger_pipeline.test.mjs`：多 char 群、char 实现 `onMessage` 返回 true → 不 @ 也发言；返回 false → 不发言；token bucket 生效。

---

## M2 — 通知生命周期与触达

### 2.1 角色组 @

- **语法**：`@everyone` 与 `@role:{roleId}`（roleId 为物化 `state.roles` 的键）。`src/public/pages/scripts/lib/mentions.mjs` 新增：

```js
export function extractMentionRoleIds(text)  // /@role:([\w-]{1,64})/g 与 /@everyone\b/
```

- **展开**：在 `messageFanout.mjs` 服务端展开——查 sender 成员的 `MENTION_EVERYONE` 权限位（新增到 `src/public/parts/shells/chat/src/permissions/chat.mjs` 的权限位表，默认授予 `@everyone` 角色之外的管理角色），有权限则把 role 的成员集合（`state.members[*].roles` 包含该 roleId 且 active）并入 mention 收件人集合；无权限则忽略角色组（消息本身不拒收）。
- **补全**：`src/group/lib/mentionSuggest.mjs::suggestGroupMentions` 返回项增加 `kind: 'role'` 候选（`@everyone` + 群内各角色，携带 `roleId`、`name`、成员数）；前端 `hub/mentionAutocomplete.mjs` 插入 `@role:{roleId}`。

### 2.2 投票生命周期

- **截止禁投**：`src/chat/dag/authorizeEvent.mjs` 的 `vote_cast` 分支增加校验——查 ballot（`content.ballotId` 对应 message 的 `content.deadline`），`event.hlc.wall > Date.parse(deadline)` → 拒绝；`reducers/messages.mjs` 的 `vote_cast` reducer 同条件忽略（联邦补账确定性一致）。
- **关票与通知**：新建 `src/chat/lib/voteDeadlineWatcher.mjs`：

```js
export function scheduleVoteDeadlines(username, groupId)  // 群 runtime 注册时调用，扫描物化 votes 中未过期 deadline，setTimeout
export async function fireVoteClosed(username, groupId, channelId, ballotId)
// → 对本机收件人（发起者 + 已投票者的 entityHash）appendChatInbox({ kind: 'vote_closed', ... })
// → broadcastEvent(groupId, { type: 'vote_closed', channelId, ballotId, tally })
```

不新增 DAG 事件——deadline 写在 ballot content 里，关闭是确定性读时事实，各 replica 自行通知本机收件人。频道未读保持 message-only（`vote_cast` 的可达性由 `vote_closed` 通知承担，不动 `messageSeq`，避免与 jsonl `seq` 水位错位）。

- **前端**：`hub/wireVoteEvents.mjs` 处理 `vote_closed` WS 刷新 tally 并禁用选项；投票块渲染显示「已结束」。

### 2.3 DM 通知

`messageFanout.mjs` 增加分支：群 `state.groupMeta.dmKind` 存在（ECDH DM 群）且消息 origin 非 char → 对端 entityHash（成员中非 sender 的一方）若为本机收件人，`appendChatInbox({ kind: 'dm', ... })`，不要求 @。

### 2.4 Web Push（chat / social 共用）

现状：`src/public/pages/service_worker.mjs` 已有（Cache + `/ws/notify` WebSocket，收 `notification` 消息弹系统通知）；`src/server/web_server/endpoints.mjs` 已有 `router.ws('/ws/notify')`；**无** PushManager / VAPID。

- **依赖**：`npm:web-push`。
- **新建** `src/server/notify/webPush.mjs`：

```js
export async function ensureVapidKeys()        // 生成并存节点配置目录，幂等
export async function addPushSubscription(username, subscription)   // 存 {userDict}/notify/push_subscriptions.json（按 endpoint 去重）
export async function removePushSubscription(username, endpoint)
export async function sendWebPush(username, payload)  // 对该用户全部订阅 webpush.sendNotification，410/404 时清除订阅
```

- **新建** `src/server/notify/notify.mjs`：

```js
export async function notifyUser(username, { title, body, url, tag })
// 有存活 /ws/notify socket → 走 ws（现有 service worker 'notification' 分支）
// 否则 → sendWebPush
```

- **路由**（加在 `src/server/web_server/endpoints.mjs`）：

```
GET  /api/notify/vapid-public-key
POST /api/notify/push-subscribe      body: PushSubscription JSON
DELETE /api/notify/push-subscribe    body: { endpoint }
```

- **service worker**：`service_worker.mjs` 增加 `push` 事件（showNotification）与 `notificationclick`（focus/open `url`）。前端 `src/public/pages/base.mjs` 或各 shell init 中做一次 `pushManager.subscribe`（`userVisibleOnly: true, applicationServerKey`）并上报。
- **接入点**：chat `appendChatInbox` 与 social `inbox.mjs` 的 append 路径各加一行 `void notifyUser(...)`（标题用群名/作者名，url 用 Hub / social 深链）。
- **删除** `public/hub/hubNotifications.mjs`（「后台标签页 + 正在看该频道」窄条件链废弃），`groupStream.mjs` 中对它的调用一并移除。

### 验收

- `@role:{roleId}` 使角色全体本机成员 inbox 可查；无 `MENTION_EVERYONE` 权限的 sender 角色组 @ 无效。
- 集成测试：deadline 过后 `vote_cast` 被 authorize 拒绝；`fireVoteClosed` 后发起者与投票者 inbox 出现 `vote_closed` 行。
- DM 对端未 @ 也收 inbox `dm` 行。
- push-subscribe 后（测试注入假订阅端点）`notifyUser` 调用 webpush 发送。

---

## M3 — 具名层（petname / 别名）

hash 仍是唯一身份锚；名字是其上的展示与寻址糖。三层：自声明名（p2p entity profile，已有）→ **本地别名**（本批新增）→ 消歧短码。不做全局唯一注册。

### 3.1 别名存储与 API（chat shell 持有，social 复用）

- 存储：`loadShellData(username, 'chat', 'aliases')` → `{userDict}/shells/chat/aliases.json`：

```json
{ "entities": { "<128hex>": "别名" }, "groups": { "<groupId>": "别名" } }
```

- 路由（加在 `src/endpoints/prefs.mjs`，与 bookmarks 同模式整档读写）：

```
GET /api/parts/shells:chat/aliases
PUT /api/parts/shells:chat/aliases    body: 整档 JSON
```

- **新建**前端共享客户端 `src/public/parts/shells/chat/public/shared/aliases.mjs`（social 经 `/parts/shells:chat/shared/aliases.mjs` 导入，先例：`socialRunUri.mjs`）：

```js
export async function loadAliases()                    // 带内存缓存
export function aliasForEntity(entityHash)
export function aliasForGroup(groupId)
export async function setEntityAlias(entityHash, name) // name 空串 = 删除
export async function setGroupAlias(groupId, name)
```

### 3.2 统一名字解析与消歧

**新建** `src/public/parts/shells/chat/public/shared/nameResolve.mjs`：

```js
export function resolveDisplayName({ entityHash, alias, profileName, fallbackLabel })
// 顺序：alias → profileName → fallbackLabel（entityHashLabel 短码）
export function disambiguateLabels(items)
// items: [{ label, entityHash }]；同 label 冲突者后缀 `·${entityHash.slice(64, 68)}`
```

### 3.3 全 UI 接线（改造点清单，来自 hash 露出位置调查）

| 位置 | 文件 | 改造 |
| --- | --- | --- |
| 消息作者名 / 成员列表 | `hub/core/domUtils.mjs::authorDisplayLabel` | 接入 alias → profile → 短码链 |
| @ 展开 label | `public/shared/expandMentions.mjs::buildMentionLabelMap` | 同上 + `disambiguateLabels` |
| @ 补全候选 | `hub/mentionAutocomplete.mjs`、social `src/mentionAutocomplete.mjs` | 候选主文案走 alias；hash 副文案保留 tooltip 级 |
| 侧栏群名 | `hub/serverBar.mjs` | `aliasForGroup` 覆盖 `groupMeta.name`，fallback 不再裸 groupId（用「未命名群 ·xxxx」样式） |
| 好友私聊标题 | `hub/friendChat.mjs` | alias 优先 |
| inbox / 通知视图 | `hub/mentionsView.mjs`、social `views/notifications.mjs` | 作者名走解析链，删除 `slice(64, 72)` 裸 fallback |
| social 帖子卡 / profile / explore | `social/public/src/lib/display.mjs::authorLabel` / `entityHandle` | `authorLabel` 接 alias；`entityHandle` 保留（handle 行语义即短码），tooltip 显全 hash |
| 顶栏「我」/ 资料弹层 | `hub/init.mjs`、`profilePopup.mjs` | 解析链 |
| 别名编辑入口 | `hub/memberContextMenu.mjs`、`profilePopup.mjs`、`groupContextMenu.mjs`、social profile 页菜单 | 新增「设置别名」项 → `setEntityAlias` / `setGroupAlias` |

composer 插入形态维持 `@128hex`（textarea 不做 pill 富文本）；候选与渲染两端具名即可。

### 3.4 具名群深链

`hub/core/urlHash.mjs`：`parseHash` 支持 `#group:@{alias}:{channelId}`——前端用 `aliasForGroup` 反查 groupId 后照常导航；`updateHash` 仍写 canonical groupId。API 与联邦层不做名字索引。

### 验收

- Playwright/集成：设置别名后 sidebar、消息作者、@ 补全、通知均显示别名；两个同名成员在成员列表显示 `名·xxxx` 消歧；`#group:@别名:default` 可直达。
- 存储层断言：DAG 事件、mention 正文、inbox 行内不出现别名（canonical 不变）。

---

## M4 — Bridge ingress + Telegram 壳改薄

### 现状锚点

- `telegrambot/src/default_interface/main.mjs` 自管 `ChannelChatLogs` 内存 log、入站 trigger（`ReplyToAllMessages` / @bot / reply-to-bot）、直接调 `charAPI.interfaces.chat.GetReply`、出站 HTML 分片——与 chat DAG 完全并行。
- chat 侧无任何 bridge API；程序化建群入口为 `src/chat/session/crud.mjs::newGroup(username, { name, defaultChannelName })`。

### 4.1 chat bridge 层（新建 `src/public/parts/shells/chat/src/chat/bridge/`）

**`registry.mjs`** — 平台会话 ↔ fount 群映射：

```js
// 存储：{userDict}/shells/chat/bridges.json
// { "{platform}:{platformChatId}": { groupId, channels: { "{platformThreadId|default}": channelId },
//                                    messageMap: 环形数组 [{ eventId, platformMessageId }] } }
export async function ensureBridgeGroup(username, { platform, platformChatId, name })
// 已映射 → 返回；否则 newGroup(username, { name }) 并写映射；群 settings 标记 bridge: { platform, platformChatId }
export async function resolveBridgeChannel(username, { platform, platformChatId, platformThreadId })
// thread 未映射 → channel_create 一个子频道并记映射
export async function recordBridgeMessagePair(username, groupId, { eventId, platformMessageId })
export async function lookupBridgeEventId(username, groupId, platformMessageId)
```

**`ingress.mjs`** — 入站 DTO → 统一写路径：

```js
export async function postBridgeMessage(username, dto)
// dto: {
//   platform: 'telegram'|'discord'|'wechat',
//   platformChatId, platformThreadId?, platformMessageId,
//   author: { platformUserId, displayName, avatarUrl? },
//   text, files?: [{ name, mime_type, buffer }],
//   replyToPlatformMessageId?, timestamp,
// }
export async function postBridgeEdit(username, dto)    // → message_edit（经 lookupBridgeEventId 找 targetId）
export async function postBridgeDelete(username, dto)  // → message_delete
```

`postBridgeMessage` 内部：ensure 群/频道 → 拼 content（`displayName` / `displayAvatar` 用 dto.author——canonical content 已有这两个字段；平台原生 id 存 `content.extension.bridge`）→ `commitChannelMessageEvent({ ..., origin: 'bridge' })`。`messageCommit.mjs` 的 origin 取值加 `'bridge'`（触发管线视同 human：`runTriggerPipeline` 正常跑；`isGeneration` 判定不含 bridge）。落 DAG 即自动获得持久化、搜索索引、未读、inbox、联邦能力——这就是「现代化默认界面」的实质。

**`outbound.mjs`** — 出站订阅：

```js
export function registerBridgeOutbound(username, groupId, handler)
// handler: async ({ channelId, messageLine }) => { platformMessageId? }（返回值回写 messageMap）
export function unregisterBridgeOutbound(username, groupId)
```

`eventPersist.mjs` 在 char 产出的 message（`signPayload.charId` 非空）落盘后调 `notifyBridgeOutbound(username, groupId, channelId, messageLine)`。

### 4.2 telegrambot 改薄

`src/public/parts/shells/telegrambot/src/default_interface/main.mjs` 重写：

- **保留**：`tools.mjs` 的入站转换（`TelegramMessageToFountChatLogEntry` 系列改产出 bridge DTO，重命名 `telegramEventToBridgeDto`）、media group 防抖合并、出站 `aiMarkdownToTelegramHtml` + `splitTelegramReply` + 贴纸发送。`tools.mjs` 移动为 `telegrambot/src/format.mjs`（`default_interface/` 目录随改造消失）。
- **删除**：`ChannelChatLogs` / `ChannelCharScopedMemory` / `aiReplyObjectCache` 内存态、trigger 判断（`ReplyToAllMessages`、@bot、reply-to-bot）、`generateChatReplyRequest`、`AddChatLogEntryViaCharAPI`、直接 `GetReply` 调用。
- **新数据流**：`bot.on('message'|'edited_message')` → DTO → `postBridgeMessage/Edit`；启动时对每个已映射群 `registerBridgeOutbound`，handler 做格式化 + `sendMessage`，回填 `platformMessageId`。
- **配置模板收缩**：`GetBotConfigTemplate` 删除 `ReplyToAllMessages` / `MaxMessageDepth`（触发由 chat 群设置与 char `onMessage` 掌管）；保留 `OwnerUserID`（私聊准入过滤仍在壳层）。

### 验收

- 新集成测试 `chat/test/integration/bridge_ingress.test.mjs`：synthetic DTO → `postBridgeMessage` → messages.jsonl 落行、搜索可查、未读递增、mention 进 inbox、单 char 桥接群触发回复且 `notifyBridgeOutbound` 收到 char 回复行。
- `telegrambot` 测试：mock Telegraf event → DTO 转换正确；出站 handler 分片 / 贴纸行为与旧 `tools.mjs` 单测一致。

---

## M5 — Discord / WeChat 同改 + 平台格式钩子

### 5.1 壳改造

- `discordbot/src/default_interface/` 同 M4 模式重写：`MessageCreate/Update/Delete` → DTO → bridge；删除 `ChannelMessageQueues` / `MargeChatLog` / 历史 fetch（DAG 即历史）；`tools.mjs` → `discordbot/src/format.mjs`（`splitDiscordReply`、`getMessageFullContent`）。
- `wechatbot/src/default_interface/main.mjs` 同改：长轮询 update → DTO → bridge；`splitWechatText` / `convertFileToWechatCompatible` 提出为 `wechatbot/src/format.mjs`。
- 三壳 `runBot` 保持「一个 bot 实例绑定一个 char」；bridge 群名默认取平台会话标题。

### 5.2 charAPI 平台格式钩子

`src/decl/charAPI.ts` 的 `interfaces.telegram` / `interfaces.discord` / `interfaces.wechat` 各增加（`BotSetup` / `OnceClientReady` 保留，职责收缩为「连接级自定义」）：

```ts
FormatOutboundReply?: (reply: chatLogEntry_t, ctx: {
  platform: string, send: (payload) => Promise<{ platformMessageId? }>,
  chatId, threadId?,
}) => Promise<boolean>   // true = char 已自行发送，壳层跳过默认格式化
TweakInboundDto?: (dto) => Promise<void>   // 可选就地修饰入站 DTO（追加 extension 等）
```

壳层 outbound handler 先问 char 钩子，未处理再走 `format.mjs` 默认实现。

### 验收

- 三壳各自 mock 平台事件的 DTO 转换测试；`FormatOutboundReply` 返回 true 时默认格式化不执行的用例。
- 无自定义接口的 char 在 TG / DC / WeChat / Hub 四端触发行为一致（同一 `onMessage` / 单 char 规则）。

---

## M6 — 龙胆迁移

源码：`data/users/steve02081504/chars/GentianAphrodite/`（读该目录 `AGENTS.md` 先行）。现状：TG/DC 走 `bot_core`（队列 + 合并 + `trigger.mjs` 打分 + `platformAPI.sendMessage`），Hub 走 chat shell 直连 `reply_gener/GetReply`，`onMessage` 未实现——两套调度。

### 迁移映射

| 现有 | 去向 |
| --- | --- |
| `bot_core/trigger.mjs` 打分逻辑（`calculateTriggerPossibility` / 关键词 / 叫名 / 主人分支 / 偏好期 / 概率裁决） | 新建 `trigger/onMessage.mjs`，实现 `interfaces.chat.onMessage(event)`：从 `event.message` 与 `event.chatReplyRequest.chat_log` 取上下文打分，`event.mentioned` 替代平台 @ 检测；`main.mjs` 的 `interfaces.chat` 挂上 `onMessage` |
| 主人命令（敷衍/闭嘴/禁止词/自裁/复诵）`handleOwnerCommandsInQueue` | `onMessage` 内命令识别 + 副作用；需要直接回话的（复诵等）返回 true 后由 `GetReply` 内 `reply_gener/noAI` 短路产出 |
| 复读检测 `checkQueueMessageTrigger` 复读段 | `onMessage` 打分项（读 `chat_log` 近 10 条），命中返回 true，`GetReply` 的 noAI 路径出复读文本 |
| `channelMuteStartTimes` / `fuyanMode` / `bannedStrings`（内存） | `chatReplyRequest.chat_scoped_char_memory`（chat shell 会话持久化，bot_core 时代的等价物） |
| 消息队列 / `mergeChatLogEntries` / `fetchFilesForMessages` | **删除**——chat 管线供序列化的 log 与附件 |
| `interfaces/telegram/{event-handlers,message-converter,platform-api,api,state,world}.mjs`、`interfaces/discord/` 同名 | **删除**——bridge 负责转换与收发 |
| `interfaces/telegram/utils.mjs` 贴纸 / HTML 出站定制 | `interfaces.telegram.FormatOutboundReply`（M5 钩子），仅保留与壳层默认实现不同的部分 |
| `telegram.BotSetup` / `discord.OnceClientReady` | 删除或收缩为空（连接由壳层默认管理；无自定义连接需求即整个删除） |
| `bot_core/{index,reply,state,utils,group_handler,error}.mjs` | **删除**（`group_handler` 的入群主人检查若保留，迁入 `onMessage` 对 `member_join` 后首条消息的处理或移作 world 逻辑） |

### 验收

- 三端一致回归：同一段对话脚本在 Hub 桥接测试群 / mock TG bridge / mock DC bridge 下，`onMessage` 触发裁决序列一致（叫名无 @、主人关键词、闭嘴静音、复读均覆盖）。
- `GentianAphrodite/` 目录内 grep 无 `platformAPI` / `bot_core` 残留。

---

## M7 — Social actor 平权

### 现状锚点

- 写侧 `src/lib/resolveActingEntity.mjs` 已就位（posts / relationships / profile 用）；读侧 `buildHomeFeed` / `buildNotifications` / search / explore 固定 operator。
- `following.mjs::loadFollowingForActor(username, actingEntityHash)` **已存在**，读侧参数化的底层齐了。
- `federation/follower_index.mjs` 仅在 **operator** 时间线 follow 时投影（`projectFollowerIndexFromTimelineEvent` 有 `timelineOwner === operator` 门），bucket 值为 `replicaUsername[]`，无 entity 粒度。

### 7.1 读 API 参数化

| 路由 | 改造 |
| --- | --- |
| `GET /feed` | 增加 `actingEntityHash` query → `resolveActingEntity` → `buildHomeFeed(username, { actingEntityHash, limit, cursor })`；内部 `loadFollowing(username)` 改为 `loadFollowingForActor(username, acting)`，`loadViewerContext`（`feed/helpers.mjs`）增加 viewer 参数 |
| `GET /notifications`、`GET/PUT /notifications/seen` | 增加 `actingEntityHash` → `buildNotifications(username, { actingEntityHash, ... })` 直接读 `inbox/{acting}/events.jsonl`（目录结构已按 entityHash 分，仅差入口） |
| `GET /search`、`GET /explore`、`POST /feed/sync` | viewer 上下文同上参数化（`syncFollowingTimelines` 改为同步**所有本机 entity** following 的并集） |

### 7.2 follower 索引 entity 粒度

`federation/follower_index.mjs`：

- 删除 `projectFollowerIndexFromTimelineEvent` 的 operator 门——任何**本机托管** entity 时间线上的 follow/unfollow 均投影。
- bucket 值升级：`Record<targetEntityHash, Array<{ replicaUsername, entityHash }>>`；`listReplicaUsernamesFollowing` 重命名为：

```js
export async function listLocalFollowersOf(targetEntityHash)
// → [{ replicaUsername, entityHash }]
```

- `rebuildFollowerIndex` 扫描全部本地时间线目录重建。
- `dispatch.mjs::dispatchPostFollowerUpdates` 按 entity 分发：follower 为 operator entity → 走人类通知链（inbox `follow`/feed）；为 agent entity → 调该 agent 的 `OnFollowerUpdate`（载荷加 `followerEntityHash`）。

### 7.3 acting 切换 UI

- `GET /api/parts/shells:social/viewer` 响应扩展：`{ operator, agents: [{ entityHash, charPartName, displayName }] }`（枚举本机托管 agent 时间线）。
- 前端 `public/src/state.mjs` 增加 `appContext.actingEntityHash`；`lib/apiClient.mjs` 统一在请求上附带（query 或 body，与各路由约定一致）；header 加身份切换 dropdown（operator + 各 agent）；`composer.mjs::buildPostBody` 带上 acting；通知页、feed、profile「我的」入口随切换刷新。

### 验收

- 集成测试扩展 `notifications_dispatch.test.mjs` / 新增 `acting_read_parity.test.mjs`：agent A follow B 后 `GET /feed?actingEntityHash=A` 含 B 的帖；B 发帖触发 A 的 `OnFollowerUpdate`；`GET /notifications?actingEntityHash=A` 可读 A 的 inbox。
- UI：切到 agent 身份后发帖 author 为 agent、通知徽标为 agent 未读数。

---

## M8 — Social 产品补强 + 顺手项

### 8.1 投票（poll）

- **发帖**：`POST /posts` body 增加 `poll: { options: string[], multi?: boolean, deadline?: ISO8601 }`，存入 post content（followers 可见时随 GSH 一起加密）。
- **投票事件**：新时间线事件 `poll_vote`，content `{ targetEntityHash, targetPostId, choices: number[] }`，写在**投票者**时间线。触及文件（social 新增事件类型的既有门禁）：
  - `src/federation/namespace.mjs`（`SOCIAL_TIMELINE_EVENT_TYPES`）
  - `src/timeline/reducers.mjs`（reducer + `finalizeSocialTimelineView` 暴露 `pollVotes`）
  - `src/federation/federation_visibility.mjs`（`poll_vote` 需可被作者节点 pull——**不**入 `FEDERATION_PRIVATE_EVENT_TYPES`）
  - `src/federation/write_auth.mjs`（入站授权）
- **tally 投影**：新建 `src/federation/poll_index.mjs`（模式对齐 `follower_index.mjs`）：`append.mjs` / `sync.mjs::ingestRemoteTimelineEvent` 遇 `poll_vote` 调 `projectPollVote(...)`，聚合写 `{userDict}/shells/social/poll_tally/{targetEntityHash}/{postId}.json`；`feed/buildItem.mjs` 给 post item 附 `poll: { options, multi, deadline, tally, closed, viewerChoices }`。
- **截止**：作者 replica 起 deadline watcher（复用 chat M2 的模式，新建 `src/lib/pollDeadlineWatcher.mjs`）；到期后 `deriveInboxNotifications` 产 `poll_closed` inbox 行（`VALID_NOTIFICATION_TYPES` 增加 `poll_closed`）通知本机投票者与作者；过期 `poll_vote` 在 reducer / write_auth 双侧拒绝。
- **前端**：composer 加 poll 编辑器；`postCard.mjs` 渲染选项条 + 投票交互（`POST /posts/:entityHash/:postId/poll-vote` body `{ choices, actingEntityHash? }`，endpoint 内部 `commitTimelineEvent(username, acting, { type: 'poll_vote', ... })`）。

### 8.2 帖文编辑

- 新时间线事件 `post_edit`，content `{ targetPostId, text, mediaRefs?, contentWarning?, lang? }`（followers 帖同 GSH 加密）；`write_auth` 限定 sender 为时间线 owner。
- reducer：`postEdits.get(targetPostId).push(event)`；`materialize.mjs` 输出 post 视图取最新 revision，原文进 `revisions[]`。
- `searchIndex.mjs::indexTimelineEventForSearch` 处理 `post_edit`（重建该帖词条）。
- 前端：post 菜单加「编辑」（composer 复用）与「编辑历史」dialog；卡片显示 `(已编辑)` 标记。

### 8.3 for_you 推荐排序

- 新建 `src/feed/ranking.mjs`：

```js
export async function buildForYouFeed(username, { actingEntityHash, limit, cursor })
```

候选 = 关注时间线池 + 二度注入（被关注者时间线中的 like/repost 指向的公开帖，本地已同步数据即可解析）。打分（纯本地信号，无 ML 无中心服务）：

```
score = exp(-age / 24h)                                  // 新鲜度半衰
      × (1 + log1p(likes + 2·reposts + replies))          // 互动热度（读 poll_tally 同款投影或物化计数）
      × (1 + log1p(viewer 与作者双向互动次数))              // 亲和度（viewer 时间线中对该作者的 like/reply 计数）
```

- `GET /feed` 增加 `ranking=for_you|latest`（默认 latest）；前端 feed 顶部加 tab 切换。

### 8.4 前端与运营顺手项

- **WS 真增量**：`endpoints/posts.mjs` 发帖后 `pushFeedUpdate({ type: 'post', item })` 直接携带 build 好的 feed item；`public/src/init.mjs::handleFeedWebSocketMessage` 收 `post` → `views/feed.mjs` 新增 `prependFeedItem(appContext, item)`（`postCard.mjs` 渲染后插到 `#feedList` 头部）；`showFeedNewPostsBanner` 仅保留为搜索态 / 分页深处的 fallback。
- **审核队列 UI**：report 行写入时补 `id`（行内容 SHA-256 短码）；新增 `POST /governance/reports/resolve` body `{ reportId, action: 'dismiss'|'mute_author'|'hide_post' }`（mute/hide 复用 relationships / personalBlock 现有写路径，处置记录 append `reports_resolved.jsonl`）；前端新增 `views/moderation.mjs` + 导航入口，列表 + 单条处置按钮。
- **搜索分页**：`src/search.mjs::searchPosts` 增加 `cursor` 入参与 `nextCursor` 返回（游标 = 末项 `"${hlcWall}:${postId}"`）；`endpoints/search.mjs` 透传；前端 `runFeedSearch` 接 `bindInfiniteScroll` 追加页。
- **chat 跨群搜索**：新建 `src/public/parts/shells/chat/src/chat/search/global.mjs`：

```js
export async function searchAllGroups(username, { q, limit, cursor })
// 枚举 enumerateJoinedFederatedGroups → 逐群 queryIndex → 按 score/时间归并 → { items, nextCursor }
```

路由 `GET /api/parts/shells:chat/search?q=&limit=&cursor=`（挂 `src/endpoints.mjs`）；Hub `hub/search.mjs` 搜索框加「本群 / 全部群」scope 切换。

### 验收

- poll 全生命周期双节点 live 测试：A 节点发 poll → B 节点投票 → 联邦 pull → A 的 tally 投影一致 → 截止后 B 再投被拒、双方收 `poll_closed`。
- `post_edit` 联邦同步后两节点 materialize 的最新文本与 revisions 一致；搜索命中新文本不命中旧文本。
- for_you 与 latest 可切换、cursor 稳定不重复；亲和作者的新帖排位高于同龄陌生帖（构造用例断言相对序）。
- WS 收 `post` 后无整页重拉（断言 `loadFeed` 未被调用而新卡片存在）。

---

## 里程碑依赖

```mermaid
graph LR
  M1[M1 收件人与触发统一] --> M2[M2 通知生命周期与触达]
  M1 --> M3[M3 具名层]
  M1 --> M4[M4 bridge ingress + TG]
  M4 --> M5[M5 DC/WeChat + 格式钩子]
  M5 --> M6[M6 龙胆迁移]
  M7[M7 social actor 平权]
  M7 --> M8[M8 social 产品补强]
```

M7 与 M1–M6 无强依赖可并行；M8 的 `poll_closed` 通知复用 M2 的 notify 基建（`notifyUser`）。

## 测试策略

- 每批次集成测试进各 shell `test/manifest.json`（`fount test` 自包含；Windows 本地验证用 `fount test --no-parallel`）。
- M1–M2 以通知平权审阅第二节场景矩阵为蓝本写 expected/actual 矩阵测试，取代零散用例。
- M4–M6 平台 API 一律 mock（synthetic DTO），不依赖真实 TG / DC / WeChat 凭据；龙胆三端一致性回归随龙胆目录测试维护。
- M7–M8 扩展 `timeline_ingress` / `notifications_dispatch`；poll / post_edit 用双节点 live 测试覆盖联邦一致性。

---

## 明确不做（本规划周期内）

- ActivityPub / Fediverse 兼容层：与自研联邦路线冲突。
- 原生移动端 / APNs / FCM：Web Push 到顶。
- 商业化（广告、订阅、打赏、商店）、Stories / Reels / 直播产品化、ML 自动审核。
- 全局唯一用户名注册：联邦下必被抢注，petname 模型替代。
- shell 出品的回复生成 runtime 库：生成永远是 char 的活，重复代码靠删除多余调度层消解，不靠抽公共库转移责任。

## 后续方向（未排期备忘）

- **parts 联邦对称**：persona 跨节点从 `extension.otherPersona` 特判升级为正式 remote persona proxy；plugin 联邦参与 prompt 贡献侧。
- **远端 agent 接纳**：跨节点 `nodeHash → operator` 身份链（p2p 信任图扩展），解锁远端托管 agent 的 timeline ingress 与桥接群参与；见 `src/server/p2p_server/AGENTS.md`。
- **social ↔ chat 结构化桥深化**：mention 升级为专用 channel 的结构化 ingress、chat 会话产出「发帖草稿」经确认走 social `POST /posts`。
- **可观测性**：联邦同步失败率、DAG 追补延迟、WS 连接数、生成耗时分布，以 debugLog / 内部计数起步。
