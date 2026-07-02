## Social 审查报告

### 严重丑陋

1. **`POST /profile/follow` 响应字段语义污染** — `c:\Users\steve02081504\workstation\fount\src\public\parts\shells\social\src\endpoints\profile_routes.mjs` 返回 `{ entityHash, following: follow }`，其中 `following` 是布尔值；而全项目其它位置（`loadFollowing`、`GET .../following`、`loadViewerContext`）的 `following` 均为 `string[]`。同一字段名在读写 API 间含义完全相反，读代码时极易误判。

2. **「受保护」概念三套并行、互相渗透** — `socialMeta.isProtected`（探索/联邦隐藏）、`content.visibility: 'followers'`（帖文可见性 + GSH 加密，`vault.mjs`）、以及 feed 层合成字段 `content.protected: true`（解密失败占位，`feed/buildItem.mjs` 的 `withDecryptedPostContent`）。UI 文案还共用 `social.profile.protectedPost` / `hideFromExplore`。三个不同语义挤进相近命名，类型声明（`socialAPI.ts` 的 `SocialPostContent`）甚至同时列出 `visibility`、`protected` 可选字段，加剧混淆。

3. **所有写操作塞进 `/profile/*` 命名空间** — 点赞、转发、关注、拉黑、删帖、发帖均挂在 `profile_routes.mjs` 的 `/profile/like`、`/profile/repost`、`/profile/follow` 等路径下。这些操作的对象往往是他人帖文或跨实体关系，与 REST 语义上的「profile 资源」不符；API 表面读起来像「改资料」，实际是「社交动作总线」。

4. **`GET /profile/:entityHash` 向任意观看者泄露拉黑名单** — `profile_routes.mjs` 响应含 `blocked: view.blocked || []`。拉黑本可通过联邦 `block` 事件传播，但 HTTP 读接口把物化后的完整列表直接暴露给看他人资料的用户，与 `hide`（纯本地）的隐私边界形成刺眼不对称。

5. **通知无一等数据结构，全量扫描推导** — `notifications.mjs` 遍历 `listKnownTimelineOwners` 的全部时间线，现场拼装 `reply | mention | like | repost | follow`。无持久化、无已读水位服务端、无分页游标（仅 `limit` 截断）。每次请求成本随已知时间线规模线性增长，且通知条目各类型字段集不一致（见下条），属于「临时拼装型 API」而非稳定契约。

6. **通知条目字段随 `type` 漂移，前后端契约断裂** — `notifications.mjs`：`like`/`repost` 用 `targetPostId` 无 `postId`；`reply`/`mention` 用 `postId`；`follow` 两者皆无。`llms.txt` 声明含 `repost` 类型，但 `public/src/views/notifications.mjs` 渲染分支未处理 `repost`（只有 reply/mention/like/follow）。API 形状与消费者能力不对齐。

7. **`src/decl/socialAPI.ts` 与运行时严重脱节** — 声明的 `SocialFeedItem` 仅含 `entityHash/postId/post/hlc`；实际 feed/profile/search 返回还含 `kind`、`authorProfile`、`likeCount`、`repostCount`、`replyCount`、`viewerLiked`，repost 还有 `repostComment`。`SocialTimelineEvent.content` 标注为 `SocialPostContent | Record<string, unknown>`，但 like/repost/follow/block 等事件 content 形状完全不同且无独立类型。decl 文件名为「与 shells/social/src 对齐」，实际无法作为可靠契约。

8. **多实体 acting 模型半套落地** — `block`/`hide`/`personal-lists` 支持 `actingEntityHash`（代 agent 操作），但 `follow`/`like`/`repost`/`post`/`post-delete` 仅 operator 或 posting 时选 `entityHash`，不能统一表达「以哪个实体身份互动」。API 层身份模型不完整，读代码时需记两套规则。

9. **联邦 RPC 请求/响应共用 `SOCIAL_RPC_TYPES` 与 `type` 判别** — `social_namespace.mjs` 把 `social_discover_request` 与 `social_discover_response` 等同收录；`discovery.mjs` 的 `discoverWithNetwork` 把带 `type: 'social_discover_request'` 的对象既传给本地 `handleSocialRpc` 又广播邻居。同一 payload 形状在「出站请求 / 入站响应 / 本地 handler 入参」间复用，`type` 字段承担双重语义，边界不清晰。

10. **`charId`（时间线事件）vs `charPartName`（agent 接口/RPC/mention suggest）** — 时间线签名事件用 `charId`（`append.mjs`、`profile_routes.mjs`）；`SocialMentionEvent`、`dispatch.mjs`、`mentionSuggest.mjs` 用 `charPartName`。同一「本地 agent 角色目录名」在两个子系统间换名，跨层追踪时需 mental map。

---

### 中等不适

1. **读/写 API 响应形状分裂** — 读路径（feed、profile/posts、search）返回 enriched feed item；写路径（like、repost、follow、post、post-delete、block）多返回 `{ event: signed }` 或 `{ entityHash, blocked, blockedList }` 等原始事件/索引。客户端点赞后必须再拉 feed 才能对齐 UI，mutation 响应无法直接驱动界面。

2. **`GET /feed` 默认附带联邦同步副作用** — `feed_routes.mjs` 在 `sync !== 'false'` 时对最多 24 个关注对象执行 `syncFollowingTimelines`。只读首页却触发网络 I/O 与写入，需靠隐藏 query 开关 opt-out；REST 读语义不纯。

3. **分页游标 `entityHash:postId` 混用 repost 与 post 的 id** — `feed.mjs` 的 `nextCursor` 取最后条目的 `entityHash:postId`；repost 条目 `postId` 是 repost 事件 id，而嵌套 `post` 对象内是原帖 id。混合流分页键语义随 `kind` 变化，cursor 稳定性依赖实现细节。

4. **探索 HTTP API 丢弃 RPC 层分页能力** — `discovery.mjs` 的 `discoverAccounts` 支持 `cursor`，`SocialRpcDiscoverRequest` 在 decl 中有 `nextCursor`；但 `discover_routes.mjs` 的 `/explore` 与 `/explore/posts` 只传 `limit`，无 cursor query。联邦 RPC 有分页、HTTP 层一次性截断，能力断层。

5. **探索/feed 与 profile/replies 返回不同粒度的「帖」** — feed item 是统一 enriched 结构；`listReplies` 返回 `{ entityHash, post }` 原始物化事件；探索帖返回 `{ entityHash, postId, textSnippet, mediaThumbs, hlc }` 摘要。三种「帖」形状并存，前端 `postCard` / `replies.mjs` / `explore.mjs` 各写一套解析。

6. **互动事件存储语义不对称** — `reducers.mjs`：`likes` 用 `Map`（每帖键唯一，后写覆盖）；`reposts` 用数组 `push`（可重复）。like/unlike 是双事件类型 toggle；repost 无 unlike。数据模型层面对「可逆互动」不一致。

7. **`hide` API 存在但前端无入口** — `POST /profile/hide` 在 `profile_routes.mjs` 与 `llms.txt` 有文档，测试/e2e 覆盖；Social 前端 `public/` 无调用。与 `block`（UI 有 `data-block`）并列的半套能力暴露在 HTTP 层。

8. **`suspect`/`unsuspect` 有时间线 reducer、联邦入站、信誉传导（`personalSuspect.mjs`、`sync.mjs`），却无 HTTP 路由** — 与 `block`/`hide` 平行的第三套「个人态度」事件，API 表面缺失，只能当内部/联邦机制存在，产品边界模糊。

9. **`personal-lists` 四数组扁平返回** — `{ blockedEntityHashes, blockedSubjects, hiddenEntityHashes, hiddenSubjects }`（`profile_routes.mjs`）。entity/subject 双 scope 在 p2p 层有结构（`personal_block.mjs` 的 `{ scope, value }`），HTTP 层拆成四个平行数组，丢失条目级对应关系，消费者需自行理解 subject 语义。

10. **`block` 响应携带完整 `blockedList`** — 每次 toggle 返回整份公开拉黑名单数组，而 `hide` 只返回 `{ hidden: boolean }`。同等量级的个人列表操作，响应重量不一致。

11. **联邦 timeline pull 导出规则与产品直觉错位** — `federation_visibility.mjs`：`like`/`follow` 等永不导出，但 `repost`、`block`/`unblock`、`suspect`/`unsuspect`、`post_delete` 可导出。互动类事件有的联邦可见、有的不可，规则集不直观；`post_delete` 对匿名请求者亦返回 true。

12. **WebSocket feed 推送契约残缺** — 仅 `profile/post` 成功时 `pushFeedUpdate(..., { type: 'post', ... })`；like/repost/他人发帖/联邦同步均不推送。客户端收到任意 WS 消息后全量重拉 feed（`init.mjs`），推送载荷几乎无信息价值，「实时」名不副实。

13. **`GET /feed` 与 search 的条目种类不一致** — 首页含 `kind: 'post' | 'repost'`；search（`search.mjs`）只产出 post，文档亦写「仅 kind: post」。同一产品内「搜索」与「时间线」内容模型不闭合。

14. **`follow-approve` 把密码学细节暴露为 HTTP body** — `POST /profile/follow-approve` 要求 `followerPubKeyHex`。高层 shell API 直接操作 HPKE/GSH 下游概念，与「发帖只需 text/visibility」的抽象层级脱节。

15. **`POST /profile/post-delete` 只需 `postId`** — 隐含「只能删自己 operator 时间线」；与 post/like 需 `entityHash` 显式指定目标的模式不一致。agent 代发帖后的删除路径不清晰。

16. **`mentionSourceText` 与 followers 加密帖** — `postMentionText.mjs` 读 `content.text`；`maybeEncryptPostContent` 加密后 content 无 `text` 字段。followers 帖 @ 提及在 dispatch 时可能静默失效，而 `protected` 占位是解密失败后才注入，两套「不可见正文」机制不连通。

17. **`discoverWithNetwork` 静默改写合并结果** — 账户探索过滤掉已关注对象（`loadViewerContext.following`），帖子探索 dedupe 后硬 `slice(0, rpc.n)`，不返回 `nextCursor`。HTTP `/explore` 响应形状与 decl 中 `SocialRpcDiscoverResponse` 不对齐（HTTP 层可能无 `type` 字段，合并后字段集 ad hoc）。

18. **隐式自关注注入点分散** — `loadFollowing` 在 operator 物化列表外额外 `following.add(operator)`；`loadViewerContext` 再次 `following.add(viewer)`；reducer 物化的 `view.following` 本身不含 self。「关注列表是否含自己」取决于调用哪个 helper，API 响应（如 `GET .../following`）与 feed 内部逻辑可能不一致。

19. **saved-posts 同时提供 RESTful `PUT /saved-posts` 全量替换与多个 POST 子路由** — `saved_routes.mjs` 两套变更模式并存；`PUT` 接受任意 body 无 schema 校验，与 granular add/remove 路由职责重叠。

20. **翻译 `/translate` 挂在 Social shell** — `vault_routes.mjs` 注册，与帖文/时间线/联邦无关，却占用 social API 前缀，模块边界含混。

---

### 轻微刺眼

1. **HTTP 与 WebSocket 路径转义不一致** — HTTP 路由用 `shells\\:social`（`feed_routes.mjs`、`profile_routes.mjs`）；WS 用 `/ws/parts/shells:social/feed` 无转义。同一 part 两种 URL 风格。

2. **`SocialTimelineEvent` 复用 DAG 字段 `groupId` 存 social 命名空间** — `social_namespace.mjs` 的 `social-timeline:{entityHash}`。通用 DAG 概念与 Social 域标识混在同一字段。

3. **feed item 上冗余 `targetEntityHash`/`targetPostId`** — `createEngagementForPost`（`feed/buildItem.mjs`）spread 进每条 post item，regular post 上与 `entityHash`/`postId` 重复；主要为 repost 服务却污染全部条目。

4. **repost feed item 双 id 共存** — 外层 `postId` 为 repost 事件 id，内层 `post.id` 为原帖 id；`postCard.mjs` 靠 `kind === 'repost'` 分支消化，数据结构本身不自解释。

5. **通知时间戳字段名 `at` 取自 `hlc.wall`** — 非 `timestamp` 非 `hlc` 对象；与事件顶层的 `timestamp` 字段并存，时间来源不统一。

6. **错误响应 `{ error: string }` 手写** — Shell 指南倾向 `httpError` 统一处理；social endpoints 大量 `res.status(4xx).json({ error: '...' })`，与项目 shell 规范轻微偏离。

7. **`mediaRefs: Array<Record<string, unknown>>`** — decl 完全放弃结构描述，帖文媒体引用在类型层是黑洞。

8. **`SocialMentionEvent.replyTo` 在 decl 中为必填** — 普通 @ 帖并非回复，`dispatch.mjs` 仍构造 `{ entityHash: author, postId }` 填进 replyTo，字段语义被稀释。

9. **`isKnownSocialTarget` 与 `GET profile` 无对称校验** — follow/like 等写操作要求 known target；读 profile/posts 对任意 128 hex 皆可请求（仅空结果），读写校验策略不一致。

10. **`POST /profile/block` 文档写「个人拉黑」但事件类型是公开联邦 `block`** — 命名 `personalBlock.mjs` / `setPersonalBlock` 与 `personal_block.json` 索引并存，概念上「personal」与「公开时间线事件」并置，读本需跳层。

11. **`engagementForPost` 在 repost 卡片上挂原帖计数、header 展示 reposter** — 产品行为合理，但 API item 上 `entityHash`（reposter）与互动计数所指对象（原帖）分离，item 不自洽，需约定才能用。

12. **`state_summary` / `operator_key_*` 事件在 `SOCIAL_TIMELINE_EVENT_TYPES` 中但 `llms.txt` 未列** — 公开文档与时间线类型全集不一致。

13. **`follow` 通知推导逻辑绕弯** — 扫描每个 owner 的 `view.following.includes(viewerEntityHash)` 再扫 `followEvents` 取 max timestamp；不用单一 follow 事件直接生成，代码意图不直观。

14. **`savedPosts` 的 `folderId` 缺省时用 folderId 字符串作 display name** — `addSavedPost` 中 `data.folders[folderId] ??= { name: folderId, posts: [] }`，API 允许传入任意 id 兼作名称 fallback，形状粗糙。

15. **`/viewer` 与 `/profile/:entityHash` 职责重叠** — 均返回 profile 摘要；前者 operator 专用，后者通用，但字段集不同（后者含 postCount/isFollowing/socialMeta/blocked），观看者信息需调两个端点拼全。

16. **Shell 文档声明成功响应无 `success` 包装，但 WS 首包 `{ type: 'hello' }` 与推送 `{ type: 'post'|... }` 混用 `type` 作 WS 协议 discriminant** — 与 HTTP JSON 体风格无关但同一 shell 内「type 字段」含义又多一套。

---

以上均为 API/数据形状层面的「读起来难受」之处；未包含修复建议。
