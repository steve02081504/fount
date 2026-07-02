## Chat 审查报告

### 严重丑陋

1. **三套「密钥轮换」同名不同物**（`src/public/parts/shells/chat/src/chat/dag/eventTypes.mjs`、`channel_keys/schedule.mjs`、`group/routes/governance.mjs`）  
   `key_rotate`（群文件主密钥 GSH）、`channel_key_rotate` / `channel_key_rotate_batch`（频道 E2E `K_ch`）、HTTP `POST …/key-rotate`（只操作 GSH）共用「轮换密钥」语义，UI 与 `llms.txt` 也只写 `key-rotate`。读代码或对接 API 时很难分清动的是哪把钥匙。

2. **`chatLogEntry_t` 在 decl 与 runtime 是两种形状**（`decl/chatLog.ts` vs `src/chat/session/models.mjs`）  
   TypeScript 把 `timeSlice` 放在 `extension.timeSlice`；运行时类把 `timeSlice` 挂在条目顶层、`extension` 另放 `dagEventId` 等。Part API、`chatReplyRequest_t` 与 DAG 水合路径各说各话，类型声明对不上真实对象。

3. **两套并行消息宇宙，字段名也不统一**  
   - 角色私聊：`chatLogEntry_t`（`id`、`name`、`content` 字符串、`time_stamp`）  
   - 群频道：DAG 行（`eventId`、`type`、`sender`、`hlc`、`content` 对象）  
   - 冷归档：`PostSnapshot`（再加 `display`、`reactions`、`pinned`）  
   同一条消息在热区、归档、Hub、session 间要经过 `hydration.mjs` → `messageMerge.mjs` → `postSnapshot.mjs` → `postSnapshotToMessageLine` 多次变形；`display` 既在 `content.displayName/displayAvatar`，又在 `PostSnapshot.display`，归档读回后又进 `extension.display`。

4. **`PUT …/timeline` 与 `modifyChannelTimeline` 名实不符**（`group/routes/groups.mjs`、`public/src/api/groupChannel.mjs`、`session/timeLine.mjs`）  
   路由和前端函数名暗示「频道时间线」，实际操纵的是 RPG 分支 `timeLines` / `timeLineIndex`；body 里的 `channelId` 只是生成上下文，不是 DAG 频道游标。Hub 频道分页用 `since`/`before`，与此完全无关，却共享「timeline」词汇。

5. **`GET …/groups/:id/state` 把内部物化态洗成另一套成员模型**（`group/routes/groupSync.mjs`）  
   磁盘/物化态是 `state.members` 字典（`pubKeyHash` 作键）；API 返回 `members` 数组，且 agent 的 `pubKeyHash` 字段实际是 `ownerPubKeyHash`，用户则是 `memberKey`。`subjectHash`、`entityHash`、`viewerMemberPubKeyHash`、`authorPubKeyHash`（查询层后加）并存，身份键没有单一口径。

6. **`POST …/groups/:id/events` 把两种完全不同契约塞进同一数组**（`group/routes/dag.mjs`）  
   同一 `events[]` 里既可放完整签名联邦事件（`isSignedDagEventRow`），也可放未签名本地事件（仅 `type` + `content`）。客户端无法从 schema 判断该发哪种；`reputation_slash` 还在此路由内分叉成 volatile alert 与 DAG 事件两条路径。

7. **反应数据三重表示**（`group/queries.mjs`、`group/routes/channels.mjs`、`archive/postSnapshot.mjs`）  
   - 真相：`messageOverlay.reactions` 的 `targetId:emoji` → 投票者集合  
   - HTTP：每次 `GET …/messages` 都附带全频道 `reactionEvents`（合成行，`eventId` 为 `reaction:…` 伪 ID，`timestamp: 0`）  
   - 归档：`PostSnapshot.reactions` 为 `{ emoji, voters[] }` 数组  
   读消息必拉反应、删反应却要走 `DELETE …/reactions/:emoji?targetEventId=&targetPubKeyHash=`，REST 形状与 overlay 键空间不对齐。

8. **频道密钥状态劈成两半且 typedef 说谎**（`channel_keys/store.mjs`、`dag/reducers/channel_keys.mjs`）  
   侧车文件是 `{ channels: { [channelId]: { current, generations } } }`，但 `@typedef ChannelKeysFile` 写成 `{ current, generations }`。物化态只记 `channelKeyGeneration` / `channelKeyWraps.generation`，真实 `keyHex` 在侧车；`applyChannelKeyWrapsFromPull` 还把单对象和数组都塞进 `wrapsByChannel` 的值。读「当前代密钥」要跨三处 mental model。

9. **`chatMetadata_t` 持久化与内存语义分裂**（`session/models.mjs`）  
   内存里 `chatLog`/`timeLines`/`timeLineIndex` 是活跃会话真相；`toJSON`/`toData` 强行清空这三项，只留 `greetingLog` + `persistedTimeSlice`，正文声称由 DAG 水合。注释写「每个聊天天然对应一个 DAG 群组（groupId === groupId）」——同词重复，也掩盖了「session 列表摘要读内存、频道历史读 DAG」的双源读路径。

10. **归档 manifest 混入派生字段与多种命名风格**（`archive/index.mjs`）  
    `monthDigests`、`archivedEventIds`、`archive_coverage_complete`（派生布尔）、`coverage` 同处一个 manifest；`normalizeManifest` 每次从 `coverage` 重算 `archive_coverage_complete` 又写回对象。联邦 wire 片段与本地完整 manifest 字段子集不一致，却要共用 `mergeArchiveMonthHintsFromRemote` 合并。

---

### 中等不适

11. **HTTP 路由注册风格分裂**（`endpoints/sessions.mjs`、`endpoints/prefs.mjs` vs `group/routes/*.mjs`）  
    一部分用字面量 `'/api/parts/shells\\:chat/...'`（反斜杠转义冒号），群路由用 `^/api/parts/shells:chat/...` 正则 + `req.params[0]`，频道路由混用 `groupRouteRegex` 与内联正则。同一 shell 的 URL 表没有统一表达方式。

12. **成功响应体无统一契约**  
    空 `{}`（pin、delete channel）、`{ applied: 1 }`（reputation）、`{ event }` / `{ event, ballotId }`（消息/投票）、`{ state: {…} }`（state 多包一层）、`{ messages, reactionEvents }`（消息列表）并存；Shell AGENTS 要求 2xx 无 `success` 包装，但「有无包装」「包装几层」仍全凭端点记忆。

13. **`GET …/reputation` 与群无关**（`group/routes/groupSync.mjs`）  
    路径在 `groups/:groupId/reputation` 下，响应却是全局 `loadReputation()`。群级声誉事件在 DAG，HTTP 读到的却是节点级池，路径语义误导。

14. **`GET …/mailbox/summary` 返回全局 pending**（`endpoints/mailbox.mjs`）  
    `countMailboxPending()` 不按当前用户过滤；前端 `mailboxApi.mjs` 当作用户级离线信箱摘要用，数字含义与路径归属不匹配。

15. **消息写与读 content 形状不对称**（`group/routes/channels.mjs`）  
    `POST …/messages` 收 `{ content: object, files: [{ buffer: base64 }] }`，响应把 `event.content` 换成解密后的明文对象；`PUT …/messages/:eventId` 却只收 `{ content: string }`（或可被 `channelMessageText` 解析的简形）。发送用对象、编辑用字符串，同一频道消息的 HTTP 表面类型不一致。

16. **`GET …/messages` 总是附带全量 `reactionEvents`**（`group/routes/channels.mjs`、`group/queries.mjs`）  
    分页拉 50 条消息也会合成并返回整个频道的反应列表；`batch-get` 按 `eventIds` 精确取消息时仍附带全频道反应。读 API 的粒度与写 API（单条 reaction 事件）不对等。

17. **投票截止时间的双入口**（`group/routes/channels.mjs`）  
    `deadline`（ISO 字符串）与 `deadlineMs`（相对毫秒）二选一，无互斥校验；同一字段在 DAG 里落成 `content.deadline` 字符串。客户端要猜该用哪种。

18. **`channelMessageContent` 三字段正文**（`public/src/lib/channelContent.mjs`）  
    `content` / `content_for_show` / `content_for_edit` 贯穿 DAG、归档、Hub、角色 prompt；`finalizeTextChannelContent` 还会在相等时删字段。展示、编辑、agent 三套文本共用一个对象，读路径必须记住优先级链。

19. **解密失败态被撕成两处**（`public/src/lib/messageMerge.mjs`、`channel_keys/content.mjs`、`archive/postSnapshot.mjs`）  
    行上可能是 `content.decryptFailed` + `pendingGeneration`，合并后变成 `content: null` + `decryptView`；归档又写成 `content: { decryptFailed, pendingGeneration }`。同一语义三种落点，Hub 与归档读者各看各的。

20. **`PostSnapshot` 构建时 display 重复写入**（`archive/postSnapshot.mjs`）  
    `buildPostSnapshotFromRow` 同时写顶层 `display` 对象，又把 `displayName`/`displayAvatar` 塞进 `content`；`canonicalSnapshotForDigest` 只把 `display` 纳入 digest，`content` 里的 display 字段是否进 digest 取决于 `channelMessageContentObject` 行为——展示快照在正文内外各一份。

21. **`ensureChannelKey` 先侧车落钥再「静默」追 DAG**（`channel_keys/schedule.mjs`）  
    本地无钥时先 `applyChannelKeyRotateEvent` 写侧车，再 `appendEvent` 且 `publishFederation: false`、`skipCheckpointRebuild: true`。侧车与 DAG 事件可能短暂不一致；读密钥优先侧车，联邦同伴看不到这次轮换意图，边界行为靠注释而非数据结构表达。

22. **`remoteIngest` 返回字符串枚举作 API**（`dag/remoteIngest.mjs`）  
    `'ok' | 'dup' | 'invalid' | 'quarantined' | 'pending_ingest'` 贯穿 mailbox、联邦、gossip；无结构化错误，调用方只能字符串分支。mailbox 把 `dup` 也算 delivered，语义上「摄入成功」与「链上新增」混在一起。

23. **`hubStore` 上帝对象 + 嵌套 stub**（`public/hub/core/state.mjs`）  
    五十余字段的可变单例：`channelMessagesSource` / `channelMessages` / `channelMessagePipeline` 三层消息态并存；`privateGroup` 内嵌 `enableComposer` 等空函数占位，由 `init` 注入。Hub 状态没有分区边界，任何模块都可写任意字段。

24. **prefs 读写形状不一致**（`endpoints/prefs.mjs`）  
    `GET …/bookmarks` 直接返回数组；`PUT` 要 `{ entries }`。`GET …/group-folders` 返回 `{ folders }`；`GET …/custom-emojis` 返回 `{ entries }`。同层用户偏好 API 没有统一的「资源包装」约定。

25. **联邦 ingest 与 HTTP ingest 信任模型不对称却复用同一 commit 管道**  
    AGENTS 写明本地 HTTP 互信、联邦 ingress 需校验；但 `POST …/events` 对本地行几乎只做 `validateLocalAuthzBatch`，与 `remoteIngest.mjs` 的 quarantine/pending/HLC/rate-limit 栈落差极大，同一 `appendSignedLocalEvent` 终点掩盖了两条门的不同严格度。

26. **`synthesizeChannelReactionEvents` 的 `eventId` 不可追溯**（`group/queries.mjs`）  
    合成 ID `reaction:${targetId}:${emoji}:${voter}` 不在 DAG 中，不能与 `events.jsonl` 对齐；Hub 若按 `eventId` 去重或深链，会与真实事件 ID 空间冲突。

27. **成员字段 `charOwner` 只出现在读路径 enrich**（`group/queries.mjs`）  
    `enrichChannelMessagesForViewer` 从 `line.content?.charOwner` 提到行顶；写路径/DAG schema 无稳定声明。展示层临时字段与持久字段边界模糊。

28. **`archive` 与 `messages.jsonl` 双写热/冷边界靠隐式约定**（`dag/queries.mjs`、`archive/AGENTS.md`）  
    `listChannelMessages({ includeArchive: true })` 合并热 JSONL + 冷月文件；`messages.jsonl` 是 slim cache，DAG WAL 又是第三源。月份、`checkpoint_event_id`、`hot_posts` 谁裁谁留，读 API 一个 `before` 游标要跨三存储，没有单一「消息集合」抽象。

---

### 轻微刺眼

29. **匈牙利 `*_t` 类名与字段风格混搭**（`session/models.mjs`、`decl/chatLog.ts`）  
    `timeSlice_t`、`chatLogEntry_t` 与 `LastTimeSlice`（PascalCase）、`time_stamp`（snake）、`is_generating`（snake）同文件共存；`chatReplyRequest_t` 里又有 `Charname`/`UserCharname` PascalCase。

30. **`chatLogEntry_t.toJSON()` 使用 `...this` 展开**（`session/models.mjs`）  
    把类实例上所有可枚举属性（含运行时挂上的字段）打进 JSON，而非显式 schema；与 `fromJSON` 的字段列表不对称，序列化边界不清晰。

31. **`ChannelKeysFile` typedef 与 `normalizeFile` 返回值不一致**（`channel_keys/store.mjs`）  
    注释类型与真实 `{ channels: {} }` 不符，读文件时 mental overhead。

32. **`applyChannelKeyWrapsFromPull` 值类型 union**（`channel_keys/store.mjs`）  
    `wrapsByChannel[channelId]` 可以是对象或数组，靠 `Array.isArray(row) ? row : [row]` 抹平；联邦 pull 载荷没有单一形状。

33. **`DELETE …/reactions/:emoji` 用 query 传 `targetEventId`**（`group/routes/channels.mjs`）  
    资源标识拆在 path 与 query 两处；emoji 还要 `decodeURIComponent`，而 add 用 JSON body。同一资源的增删 API 风格不配对。

34. **`modifyTimeLine` 的 `delta === null` 表示 `Infinity`**（`group/routes/groups.mjs`）  
    HTTP body 用 JSON `null` 触发「跳到最新分支」的魔法值，对外契约不直观。

35. **`GET …/archive/summary` 与 `DELETE …/archive` 不要求成员，只要求本地 replica**（`group/routes/groupSync.mjs`）  
    `archive/sync` 却要 `resolveGroupMember` + 联邦房间。归档读删与同步的权限/前置条件不一致（虽可能是刻意，但 API 表面同级）。

36. **`federation/rebind` 成功体过于贫瘠**（`group/routes/groupSync.mjs`）  
    联邦未激活时 `{ ok: true, skipped: true, reason: 'federation_inactive', channelId }`；激活时 `{ ok: true, channelId }`。与 `join-snapshot`、`catchup` 返回的统计对象相比，信息密度突变。

37. **`pullGroupEvents` 与 `GET …/dag/tips` 都暴露 DAG 同步概念**（`groupFederation.mjs`、`dag.mjs`）  
    前者拉事件切片，后者拉 tip 分数与 `local_tips_hash`；联邦 catchup 又走第三条 `federation/catchup`。同步入口多，职责重叠感强。

38. **`eventId` vs `id` 双命名**（DAG 事件 vs `chatLogEntry_t.id`）  
    水合用 `content.chatLogEntryId` 桥接；`hydration.mjs` 注释承认 `dagEventId` 在 `extension`。跨子系统对「消息主键」叫法不统一。

39. **`files[].mime_type` snake_case 嵌在 camelCase 主导的 API body 里**（`group/routes/channels.mjs`、`decl/chatLog.ts`）  
    与 `eventId`、`groupId` 等混在一起，JSON 约定不统一。

40. **`reactionRenderOpts.viewerMemberId` 默认字面量 `'local'`**（`hub/core/state.mjs`）  
    与后文 `viewerEntityHash`、`authorPubKeyHash` 等真实哈希键并列，占位符风格像未完成的 API。

41. **`canonicalSnapshotForDigest` 用正则从 JSON 行抽 `eventId`**（`archive/monthDigest.mjs`）  
    已有 `canonicalStringify` 却仍用 `ARCHIVE_LINE_EVENT_ID_RE` 做排序优化；digest 路径同时依赖结构化对象与文本 hack，读起来别扭。

42. **`decl/prompt_struct.ts` 从 shell 内部路径 import `ReplyPreviewUpdater_t`**（`decl/prompt_struct.ts` → `chat/decl/chatLog.ts`）  
    全局 `src/decl` 依赖某个 shell 的 `decl` 子目录，类型图方向反直觉；chat 相关类型分散在 `src/decl` 与 `chat/decl` 两处。

43. **`POST …/messages` 响应篡改已存事件**（`group/routes/channels.mjs`）  
    返回 `{ event: { ...event, content: displayContent } }`，把链上/磁盘上的 ckg 信封换成解密视图；客户端若缓存为「权威事件」会与 DAG 真相不一致。

44. **`hubStore.privateGroup` 与用户 DM 复用 `currentGroupId` 的注释**（`hub/core/state.mjs`）  
    角色私聊与联邦群「互斥」，用户 DM 又「复用 currentGroupId」；同一字段在不同模式下语义切换，读 state 要先知道 `currentMode`。

45. **`batch-get` 与 `pin-context` 职责重叠**（`channelMessageStore.mjs`）  
    `ensureMessageLoaded` 先 `getPinContextMessages`，找不到再 `getChannelMessages({ eventIds })`；两种 HTTP 能力都在「按 eventId 捞消息」，API 表面功能交叉。

46. **`vote` 消息类型挤在 `channelContent` 四枚举里**（`channelContent.mjs`）  
    `text | sticker | vote | group_invite` 与 `channelMessageAgentText` 对 vote 走 `question` 字段；投票既是 `message` 事件又是伪 content 类型，与 `vote_cast` 事件拆分，模型不干净。

47. **`timestamp` 与 `hlc.wall` 双时间轴**  
    消息行、PostSnapshot、合成 reaction 行（`timestamp: 0`）混用 wall 时钟与 HLC；排序代码里多处 `Number(a.timestamp) || 0` 与 `hlc.wall`  fallback 并存，时间字段没有单一权威。

48. **`registerMailboxRoutes` 仅注册 summary 一条 HTTP**（`endpoints/mailbox.mjs`）  
    mailbox 摄入逻辑全在 `mailbox/ingest.mjs` 消费者注册里，HTTP 面极薄；「信箱」作为产品概念与可发现 API 严重不成比例（设计上的头重脚轻感）。

49. **`groupSync` 的 `serializableState` 字段名 snake/camel 混排**  
    `delegatedOwnerPubKeyHash`、`pendingDecryptBuffer`、`quarantineCount` 与 `localViewBranchTip`、`pinsByChannel`、`archiveCoverage` 等同屏；GET state 响应是大型杂烩 DTO，没有分层视图（meta / viewer / admin / federation）。

50. **`chatLog.ts` 与 `models.mjs` 各维护一份 `chatLogEntry_t` 文档**  
    字段列表已分叉（如 decl 要求 `logContextBefore` 数组，runtime 类无此字段；decl 的 `extension.feedback`，runtime 常在 `extension` 或条目顶层混挂）。双份「权威」注释增加维护负担。
