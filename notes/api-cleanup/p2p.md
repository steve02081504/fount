## P2P 审查报告

### 严重丑陋

**`src/decl/p2pAPI.ts` — `GroupState` / `Checkpoint` / `MessageOverlay`**

文件注释写「P2P 群聊类型」，内容却是 Chat 物化群状态的巨型 God object：`reputationLedger`、`inviteEdges`、`fileMasterKeyRotations` 全是 `unknown[]`；运行时 `MessageOverlay` 用 `Set`/`Map`，序列化版 `SerializedMessageOverlay` 用 `Record`/数组，`GroupState` 里还混着 `bannedMembers: Set<string>` 与 checkpoint 里 `bannedMembers: string[]`。同一概念三套形状挤在一个 decl 文件里，类型边界等于没有。

**`getFederationViewForUser` / `saveFederationViewForUser`（`src/server/p2p_server/operator_identity.mjs`）+ `PUT /api/p2p/federation`（`src/server/web_server/p2p_endpoints.mjs`）— `identityPubKeyHex`**

GET 同时返回 `recoveryPubKeyHex`、`activePubKeyHex`、`identityPubKeyHex`，后两者值相同（`identityPubKeyHex` 只是 `activePubKeyHex` 的别名）。PUT 解析 `body.identityPubKeyHex` 写入 `patch`，但 `saveFederationViewForUser` 根本不处理该字段——HTTP 接受、持久化忽略，字段名还暗示独立「身份钥」，与 recovery/active 双钥模型读起来互相打架。

**`dispatchInbound` / `InboundHandler`（`src/scripts/p2p/inbound_registry.mjs`）**

所有入站类型（`part_invoke`、`part_timeline_put`、`mailbox_give` 等）共用 `Promise<PartInvokeResponse | null | void>` 返回类型；`part_timeline_put` 处理器在 `inbound_handlers.mjs` 里永远 `return null`，却把 timeline 载荷再包成 `{ kind: 'timeline_put', ...message }` 塞进 `P2PInvokeHandler`。RPC 响应模型被强行套在「单向投递 / 时间线写入」上，语义泄漏到类型层。

**`part_invoke.invoke` + `wrapSocialRpc`（`src/scripts/p2p/part_wire.mjs`）**

联邦 RPC 完全靠 `invoke.kind` 字符串分支（`'social_rpc'`、`'timeline_put'` 等），`PartInvokeResponse.result` 是 `unknown`，`unwrapPartInvokeResult` 失败即 `null`。Part 边界是 stringly typed 的平面对象，没有 discriminated union，读 wire 代码无法从类型上区分调用种类。

**`initNode` / `getEntityStore`（`src/scripts/p2p/node/instance.mjs`）vs `createFountEntityStore`（`src/server/p2p_server/entity_store.mjs`）**

默认 `EntityStore` 落在 `{nodeDir}/entities/`；生产 `initP2PServer` 注入 `createFountEntityStore()` 路由到 `{userDict}/entities/`。AGENTS 文档写 profile 在用户目录，但大量测试/standalone 用裸 `initNode({ nodeDir })`——同一 `getEntityStore()` 符号在不同启动路径下指向不同存储语义，抽象泄漏到全局 singleton。

**节点级 `blocklist` / 个人 `personal_block` / Social 公开 block（`blocklist.mjs`、`personal_block.mjs`、`p2p_endpoints.mjs`）**

三套「拉黑/过滤」并存：`scope: subject|entity|node` 节点表、个人 `blocked`/`hidden` 索引、Social 时间线真相源；HTTP 还有 `/api/p2p/blocklist` 与 `/api/p2p/personal-block`，后者实现直接 `import` Social shell 的 `setPersonalBlock`。同一用户心智里的「block」在 API、磁盘结构、联邦语义上不是同一个东西。

**Operator / Entity 身份哈希命名族（`entity_id.mjs`、`operator_key_chain.mjs`、`operator_identity.mjs`）**

同一 64 hex 概念在不同层叫 `nodeHash`、`pubKeyHash`、`subjectHash`、`sender`、`activePubKeyHex`、`recoveryPubKeyHex`、`identityPubKeyHex`；`userEntityHashFromPubKeyHex` 标注 legacy（活跃钥），`userEntityHashFromRecoveryPubKeyHex` 标注稳定锚——两套 user entity 派生路径并存，读代码很难判断哪个字段在哪个上下文是 canonical。

---

### 中等不适

**`saveNetwork` / `scheduleNetworkSave`（`src/scripts/p2p/network.mjs`）**

`saveNetwork` 已 `writeNodeJsonSync`，末尾还调 `scheduleNetworkSave`；防抖回调只是 re-read 再 write 同一文件并 `invalidateTrustGraphCache`。落盘路径双重、防抖职责与「保存网络表」混在一个模块里，读调用方无法判断哪次 write 是 authoritative。

**`PeerPoolView` typedef vs `loadNetwork`（`network.mjs`）**

typedef 声明 `blockedPeers`、`hintSources`，`loadNetwork()` 只返回 `trustedPeers/explorePeers/hints/lastRosterAt`；`blockedPeers` 要另走 `loadPeerPoolView`。类型与函数返回值不对齐，容易误用。

**`deliver`（`deliver.mjs`）vs `sendToNode`（`trust_graph.mjs`）**

`deliver` 仅 `trim().toLowerCase()` 后 dynamic import 转发 `sendToNode`，参数列表与返回值完全相同。多一层名字却没有语义差分。

**`node_context.mjs`**

整文件是对 `node/identity.mjs` 的 re-export shim；`getNodeHash` 等符号有两个入口路径，模块边界显得随意。

**`reputation.mjs`**

barrel 把 `reputation_math.mjs`（纯函数）、`reputation_store.mjs`（突变 + 磁盘）、`reputation_social.mjs`（Social 阈值）捆在一起；`loadReputation()` 无参全局单例与注释里的「主观信誉」域模型不在同一抽象层。

**`event_types.mjs` vs `event_type_registry.mjs`**

前者 `export {}` 空壳 + JSDoc typedef；后者 inline 重复 `{ aclGated?, gcExclude?, ... }` 字面量。事件类型元数据注册 API 分裂成两个文件，其中一个什么都不导出。

**`eventsToMetas`（`topo_order_memo.mjs` 与 `dag_order_cache.mjs`）**

同签名、同实现各写一份，拓扑序缓存层出现复制粘贴式 API 表面。

**HTTP P2P 端点响应形状（`p2p_endpoints.mjs`、`p2p_file_endpoints.mjs`）**

`/connect-node` → `{ ok, connected }`（两字段同义）；heartbeat/status → `{}`；mailbox summary → `{ pending }`；viewer → 四种不同结构；entity GET → `{ profile }` 且服务端突变 `profile.effectiveStatus`。REST 层没有统一的 envelope 或错误模型。

**`handleIncomingPartInvoke`（`part_wire.mjs`）双模出站**

有 `requestId` 走 `part_invoke_response`；无 `requestId` 则 `unwrapPartInvokeResult` 后再发一轮 `part_invoke`。同一函数名、同一入站 action，出站协议由可选字段隐式切换，调用方/readers 必须记住两套语义。

**`registerMailboxConsumer(consumerId, app, handler)`（`mailbox/consumer_registry.mjs`）**

路由按 `record.app` 分组，注册却要 `consumerId` + `app` 两个键；`consumerId` 不参与 dispatch 匹配，API 表面多一个维度。

**`isPeerKeyBlocked(groupId, peerKey)`（`blocklist.mjs`）**

把同一 `peerKey` 同时塞进 `{ pubKeyHash: key, nodeHash: key }` 做 subject/node 双匹配——调用签名暗示单一 key 类型，实现却是「两个槽位填同一个值碰运气」。

**`normalizeBlocklist` / `buildBlocklistIndex` — `entity` scope 的 `groupId`**

normalize 允许 `entity` 条目带 `groupId`，但 `buildBlocklistIndex` 对 `entity` 强制 `gid !== '*'` 时 `continue` 丢弃。磁盘/API 能写入索引层却永远读不到的数据。

**`setEntityBlocked`（`blocklist.mjs`）**

JSDoc 写 `@returns {boolean}`，实现 `return mutateBlocklist(...).then(() => block)`——返回 Promise；同步/异步边界在公共 API 上不一致。

**`GroupSettings`（`p2pAPI.ts`）命名风格**

同一接口里 `hotLatestMessageCount`（camelCase）与 `event_retention_depth`、`message_content_retention_ms`（snake_case）并存；序列化/ reducer 层必然出现隐式字段映射约定。

**`Role.permissions: Record<string, boolean>`（`p2pAPI.ts`）vs `permissions.mjs`**

decl 层是 loose string-key 对象；运行时用 `PERMISSION_ORDER` + `BigInt` 位图。两套权限表示并存，类型文件不反映真实求值结构。

**`TransferKeyDescriptor.type`（`files/manifest.mjs`）**

`'public' | 'file-master-key-wrap' | 'vault-wrap' | 'identity-wrap'` 用 kebab-case 字符串作 discriminant；与代码里其它 enum（`'trusted'|'normal'`、`CeMode`）风格不统一。

**`channel_crypto.mjs` — `wrapChannelKey` / 文件头注释**

注释写「HPKE 包装」，实现走 `wrapKeyEcies`（`key_crypto.mjs` 的 X25519 ECIES）。术语与实现名不一致，读安全边界文档会错位。

**`trust_graph_registry.mjs` JSDoc**

`@param {import('./trust_graph_registry.mjs').TrustGraphProvider}` 自引用同文件 typedef；`TrustGraphProvider` 类型甚至未在同文件定义（在 `trust_graph.mjs` 的 factory 里隐式满足），registry 的类型边界是空的。

**`POST /api/p2p/personal-block`（`p2p_endpoints.mjs`）**

P2P server 端点直接依赖 `public/parts/shells/social/src/personalBlock.mjs`；基础设施 HTTP 层反向 import Shell 实现，模块依赖方向倒置。

**`commitActiveKeyRevoke`（`operator_identity.mjs`）**

函数体 `return commitActiveKeyRotation(username, patch)`——revoke 与 rotate 在持久化 API 层同名同实现，读符号无法区分安全语义。

**`resolveGroupMemberEntityHash`（`p2p_viewer_registry.mjs`）**

遍历所有注册 resolver，`catch { /* next */ }` 吞掉错误；第一个返回 truthy 的值胜出，无优先级/无失败聚合，API 行为依赖注册顺序这一隐式约定。

**`tools/codemod_p2p_api.mjs`**

批量把 `loadReputation(username)`、`getNodeHash(username)` 等改成无参全局 API——说明历史上 P2P 数据层曾是 per-user 签名，现为 singleton node；旧语义疤痕仍在注释/测试命名里偶发可见。

---

### 轻微刺眼

**`compareHex64Asc`（`hexIds.mjs`）**

用 JS 字符串 `<`/`>` 比较 64 hex，而注释强调「不用 localeCompare」——对 hex 字典序可以工作，但与 `merkleRoot` 等处的 `.sort()` 默认字典序并存，排序约定分散。

**`GROUP_SENTINEL_NODE_HASH = '0'.repeat(64)`（`entity/group_entity.mjs`）**

群逻辑实体绑在 64 个 `'0'` 的 magic sentinel 上；与真实 `nodeHash` 同型，靠约定区分而非类型。

**Fanout 上限字面量（`part_wire.mjs`）**

`publishTimelineEvent` 硬编码 `8`，`collectPartInvokeResponses` 默认 `maxResponses=6`，`deliverToUserRoomPeers` 默认 `limit=6`——同类「扩散度」参数散落，无共享命名常量。

**`publicTransferKeyDescriptor(ceMode)`（`files/manifest.mjs`）**

签名接受 `ceMode`，函数体永远 `{ type: 'public' }`；参数是 dead surface。

**`assertMailboxRecordShape`（`schemas/mailbox_wire.mjs`）**

只断言 `toPubKeyHash`；名叫 shape 校验，`envelope`/`app`/`hop` 等关键字段不在 schema 层约束。

**`PartInvokeResponse.error`（`part_invoke.mjs` + `inbound_handlers.mjs`）**

`code` 可选；`LOAD_FAILED` vs 裸字符串 `'load_failed'` 混用；`isPartInvokeResponse` 只检查 `'result' in value || 'error' in value`，空对象也可过。

**Mailbox wire parse（`mailbox/parse.mjs`）**

校验失败统一 `catch { return null }`；入站边界静默丢弃，无区分「 malformed」与「缺字段」的结构化错误类型。

**`USER_ROOM_SCOPE = 'user-room'`（`identity_announce.mjs`）**

与真实 `groupId` 字符串共用 `scopeIds` 数组；TrustGraph 里 room scope 与群 scope 同型 string，靠 magic 值分辨。

**`DAGEvent`（`p2pAPI.ts`）**

同时有 `sender`、`senderPubKey?`、`node_id?`；`groupId` 必填而 `channelId?` 可选——事件身份字段冗余，与 timeline 验签路径（`sender` = pubKeyHash）的注释需交叉阅读才懂。

**`id.mjs` vs `entity_id.mjs`**

前者 `prefixedRandomId`，后者 128-bit entity 编解码；文件名同级，职责跨度大。

**`crypto.mjs` vs `key_crypto.mjs`**

前者 Ed25519 签名/seed；后者 X25519 ECIES/KDF/群密钥——分割合理但命名平行，新人易 assume「key_crypto 是 crypto 子集」而误 import。

**`POST .../heartbeat`、`POST .../status`（`p2p_endpoints.mjs`）**

成功返回 `{}`；客户端无法从 body 得知写入后的 `lastSeenAt` / `effectiveStatus`。

**`POST /api/p2p/federation/connect-node`**

`{ ok: !!slot, connected: !!slot }` 两字段恒等，布尔陷阱式冗余。

**`actingEntityHash` query/body（`p2p_endpoints.mjs` personal-lists / personal-block）**

校验规则是「必须等于 operator entity」——参数存在意义仅是重复 operator 身份，API 表面多一层 actor 概念。

**`sanitizeDiscoveryAdvertisement`（`schemas/discovery_wire.mjs`）**

`advertiserNodeHash` 非 hex 时 fallback 为 `String(ad.advertiserNodeHash).trim()` 原样保留，与同函数其它字段的 hex 断言风格不一致。

**`canWriteManifestPath`（`entity/files/acl.mjs`）**

群实体写 ACL 调用 `checkManifestAcl(..., /** @type {any} */ {})` 传空 manifest；类型系统在此被显式 bypass。

**`import '../../scripts/p2p/trust_graph.mjs'`（`p2p_endpoints.mjs` 第 19 行）**

HTTP 路由注册文件 side-effect import trust graph 只为触发 `registerTrustGraphProvider`；模块加载顺序成为隐式初始化约定。

**`userEntityHashFromPubKeyHex`（`entity_id.mjs`）**

注释写 legacy 活跃钥路径，与 recovery 锚定路径并列导出；公共 API 不阻止调用方选错锚。
