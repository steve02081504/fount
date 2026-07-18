---
description: Chat Hub frontend (trust model, streaming AV, message storage UI)
globs: src/public/parts/shells/chat/public/hub/**
alwaysApply: false
---

# Chat Hub Frontend Guide

## Trust model

- **Local trust domain**: Hub UI, `/api/parts/shells:chat/...`, and in-process server logic are mutually trusted. Do not duplicate federation-style hex/array validation on local API calls or UI state.
- **External untrusted**: P2P wire, `remoteIngest`, federation discovery/mailbox ingress, remote social payloads. Validate only at gates: `npm:@steve02081504/fount-p2p/wire/ingress`, `src/public/parts/shells/chat/src/chat/dag/remoteIngest.mjs`, `npm:@steve02081504/fount-p2p/schemas/*`.
- **Untrusted remote Markdown**: Hub `messages/render/markdown.mjs` 用共享 `renderMarkdownAsString(..., { allowDangerousHtml })`；本地消息 / 本人与本机 agent（`isTrustedMarkdownAuthor` + `nodeHash` / `ownerEntityHash`）走可信档，其余安全档。首帧即渲染；未信任超长文预览 + 展开仍在 Hub。
- **`message_edit` 增量**：WS 带 `content.newContent` 时直接 `applyMessageEditToRow` 进 source（流式报错终稿勿再丢 `is_generating`）；按 eventId 补拉时 `linesIncludingOverlaysForTargets` 必须带上指向该 id 的 edit/delete/feedback，否则 merge 不到终稿、占位卡在 generating。 Pending source is `registerPendingMessageMarkdown` (in-memory Map) + `data-md-pending` — **never** put raw markdown into `data-md-raw` attributes (HTML quotes break attribute parsing → blank bubbles).
- **Profile bio Markdown**: `paintEntityProfileBio` → 同上两档；本人 / 本人 agent / 信任表。Cabinet / Social 共用。

## Streaming AV

- **Default (no `streamingSfuWss`)**: WebCodecs + server **av-relay** (`codecsAv.mjs`, `/ws/.../av-relay/:roomId`). Roster / `hello` / `frame_type=2` screen share; `subscribe mode=preview|full` (preview = keyframes only, throttled, no audio).
- **Group call**: text channel header → `hub/call.mjs` → `/ws/.../call/:groupId/:channelId`; dock template `hub/call/dock`; card `content.type:'call'` + `message_edit` updates participants/end. Shift+click = audio-only（`voiceRing.mjs` 声波环）。
- **Session lifecycle traps**: `session.close()` must be idempotent on an internal `closed` flag — never gate on `activeSession === session` after `leaveCodecsAvRoom` has already nulled the global (that made hangup a no-op and stacked duplicate sender tiles). Use `onClosed` so `call.mjs` / `streamingAv.mjs` facades reset UI when the shared singleton dies. Abort in-flight joins with a generation counter; do not `await joinInFlight` from inside the join itself (deadlock). Prune remote tiles on `publish_meta_revoke` / roster sender disappearance.
- **Shared lean client** (reused by Social live): `/parts/shells:chat/shared/avRelayClient.mjs` — `buildChatAvRelayWsUrl` / `buildChatCallWsUrl` / `joinAvRelayRoom` (`mode` / `setMode`); frame protocol constants and `packAvFrame` / `unpackAvFrame` / `bytesToHex` exported from here. Quality presets: `shared/avRelayPresets.mjs` `CODECS_PRESETS` (do not import via `codecsAv` barrel). Social live AV WS URL: `/parts/shells:social/shared/liveAvWsUrl.mjs`.
- **With external SFU URL**: iframe/embed via `renderStreamingChannel`.
- Hub default: av-relay via `renderCodecsAvStreamingChannel` → `joinHubAvSession` unless SFU configured.
- **Message direction prefetch**: `MessagePipeline` prefetches `loadMoreTop` when scrolling up and within 2 screens of the top; `loadOlderMessages` deduplicates in-flight requests.

## UI conventions

- **Mobile single-pane** (`≤768px`): `body[data-hub-pane=nav|main]` — nav 显示服务器栏+频道栏；main 全宽会话并显示 `#hub-top-back-button`。由 `hubPane.mjs`（`showHubMainPane` / `showHubNavPane`）写入；`selectChannel` → main，`setMode` / 返回按钮 → nav。桌面宽度下 CSS 不消费该属性。Inbox/discovery 的 surface 规则强制主区可见并隐藏频道栏。
- **Entity profile card**: Hub 点击头像/作者 → `profilePopup.mjs`；跨壳轻量卡 → `/parts/shells:chat/shared/entityProfilePopup.mjs`。所有完整人物卡（弹窗、独立资料页、编辑实时预览）共用 `hub/profile_popup` 模板 + `shared/entityProfileCard.mjs` 的 `paintEntityProfileCard` / `configureEntityProfileCard`，样式在 `shared/entityProfileCard.css`；勿另造外观近似的卡片。默认头像与 hash 稳定背景纹理由 `shared/hashAvatar.mjs` 生成；顶层 `banner`（EVFS `profile/banner`）有图时覆盖横幅，空串回退纹理。语言版本为 GitHub topics 式标签：点击未选中切换、点击已选中内联改代码、行末输入回车新增（复制当前切片）；资料标签/链接编辑走 chip 与动态行（`profileLocaleEditor.mjs`），直接读写 `localized[locale].tags/links`，勿再加纯文本 `|` 语法。所属方框 / 归因警告也在 `shared/entityProfileCard.mjs`（`--color-warning`）。导入历史等 attribution mismatch ≠ Ed25519 验签失败。
- **Errors**: use `handleUIError` from `public/src/ui/errors.mjs` — toast + `console.error` + Sentry (all three). Do not catch with only `showToastI18n` alone. Background paths: `toError` + `console.error` + Sentry without toast.
- **Relative imports**: from `public/hub/*.mjs` use `../src/...` for `public/src` helpers (`../../src` resolves to `/parts/src` in the browser and hard-fails). One nesting deeper (`hub/wiring/`, `hub/messages/`, `hub/federation/`, `hub/sidebar/`, `hub/stream/`) needs `../../src/...` and `../../../../../scripts/...`. Two levels (`hub/messages/render/`, `hub/messages/actions/`, `hub/stream/handlers/`) need `../../../src/...` and `../../../../../../scripts/...`. DOM event wiring lives in `hub/wiring/` (`index.mjs` = `wireEvents`, `bootstrap.mjs` = `wireBootstrap`; filenames drop the `wire` prefix, export names keep it). Sidebar nav: `hub/sidebar/` (`index.mjs` coordinates `selectGroup` / `renderHubChannelSidebar`). Group WS: `hub/stream/` (`connection.mjs` lifecycle; `handlers/` by wire type; `index.mjs` external facade).
- **Message modules**: render coordination in `messages/render/` (`index.mjs` aggregates; body/MD/attachments etc. split by responsibility, direct imports not barrel); action delegation in `messages/actions/handlers.mjs`, each `data-action` in a separate file in the same dir.
- **Message shortcuts**: 按住 Shift → 操作栏切到下载/删除（`wireShiftKeyHint` + `shiftHtml`）；从消息行非正文区拖出 → `messageDragExport.mjs` 落盘独立 HTML（`DownloadURL`），并附带 `text/markdown`。角色时间线切页用气泡侧滑/箭头，不进「更多」菜单。
- No hardcoded user-visible strings; use `data-i18n` / `setElementI18n`（参数写在 `data-*`）and `zh-CN.json`. `geti18n` 仅用于无 DOM 或 HTML 插值片段。
- **Composer disable**：只设 `disabled`；输入区被 surface CSS 隐藏（inbox / discovery / friends idle / groups 无会话）时勿塞解释文案。可见禁用态（只读频道 / 疑似移出）只用 `{ placeholder }` 对象键——字符串型 `data-i18n` 会写 `innerHTML` 污染 `textarea.value`，取消禁用后残留文案。
- Prefer `renderTemplate` / `mountTemplate` over inline `innerHTML`.
- 跨壳共享模块（如 `shared/entityProfileCard.mjs`）勿调用 `usingTemplates`——它是进程级单例，会把 Social/Cabinet 的模板请求指到 chat 路径；需要时用 `withTemplates`，或直接 DOM + `data-i18n`。
- Modals: `openDialogFromTemplate` from `@src/public/pages/scripts/features/dialog.mjs`. Template body = `modal-box` + optional `modal-backdrop` only（勿再包 `<dialog>`；自管生命周期的如 `profile_edit_modal` 除外）。
- Hub prefs（翻译 / 联邦 P2P）: server bar 单一齿轮 `#hub-prefs-button` → `openHubPrefsModal`（`hub/hubPrefs.mjs`），左侧导航切换分区，内容挂入 `#hub-settings-modal`。
- State: `hubStore` in `core/state.mjs`; banner visibility via `core/bindings.mjs`.
- Context menus: `bindDismissOnDocumentInteraction` from `core/contextMenuDismiss.mjs`（点击/右键关闭；勿再手写 closeOnce + addEventListener 六份拷贝）。
- **No setter-injected callbacks / appContext bags**: page state and cross-module functions are exported mjs bindings and imported directly. ESM circular imports are fine for runtime calls; heavy modules (`messages/messages.mjs` etc.) use call-site `await import()`. Do not invent `setXHandler` / `initX({ deps })` just to break import cycles. Exceptions: polymorphic runtime switch (e.g. `channelActionsContext` main↔thread drawer), shared-component params (`getPickerContext`), and per-call event callbacks (`onSaved`).

## Files panel (shared cabinets)

- Hub files drawer lists `state.cabinets` filtered by the viewer's role (`rw`/`ro`); click opens Cabinet shell `#shared:{cabinetId}`.
- Managers (`MANAGE_ROLES`) bind via `POST …/groups/:id/cabinets/bind` (DAG `cabinet_bind` + ECIES key wraps). Message attachments stay on chat DAG (`file_upload` / `fileMasterKey`); there is no group folder tree in chat.

## Message storage & APIs

Backend storage model (hot / cold archive / DAG, federation sync): [archive guide](../../src/chat/archive/AGENTS.md).

Hub-facing API shapes:

- **Main text channel read**: `GET …/view-log` via `getChannelViewLog` (viewer-filtered row DTOs; same shape as raw `/messages`). Response includes `hasMore` + `oldestRawEventId` for filtered empty pages. Raw `GET …/messages` is only for moderation/debugging/navigation backfill.
- **Decrypt failure**: merged rows use top-level `decryptView: { failed: true, pendingGeneration? }` with `content: null`.
- **Reactions**: both view-log and messages return `{ messages, reactions }` — per-page emoji aggregation keyed by target event id.
- **Group state**: `GET …/groups/:id/state` → `{ meta, viewer, federation }`; members use `{ memberKey, kind, ownerPubKeyHash? }`.
- **Display**: prefers `content.displayName`/`content.displayAvatar` on archived/folded posts, then live profile.
- **Navigation**: `messages/channelMessageStore.mjs` owns fetch/merge by `eventId` (`ensureMessageLoaded`); `messages.mjs` handles scroll/highlight (`scrollToMessageEventId`).

## Channel archive (JSON)

- **Export**: channel context menu → `GET …/channels/:id/export` → download (`public/src/api/channelArchive.mjs`). Full cold+hot portable snapshot (`fount-channel-archive` v1).
- **Import**: group settings → 存储与归档 → multipart `POST …/channels/import` → new text channel in the same group; Hub navigates to `#group:{groupId}:{newChannelId}`. Requires `MANAGE_CHANNELS` (`canImportChannel`).
- Backend semantics: [archive AGENTS](../../src/chat/archive/AGENTS.md) § Portable channel archive.

## Unread

- **Model**: `channel.messageSeq` (materialized on group state) minus per-entity `shells/chat/entities/{entityHash}/readMarkers.json` seq → O(1) unread per channel. Backend: `src/chat/lib/readMarkers.mjs`; HTTP fixed to operator; `PUT …/channels/:id/read-marker`; WS `read_marker` for multi-device sync (filter by `viewer.username` on client).
- **Hub**: `hub/unread.mjs` — badge HTML, `putChannelReadMarker`; sidebar group list sorts by `lastMessageTime`, unread as badge only; earliest-unread divider in `messages/messageShared.mjs` (renders only when at least one read message precedes it). Group list API returns `unreadCount` / `channelUnread` from `enumerateJoinedFederatedGroups`.
- **Open = read**: `loadMessages` calls `markCurrentChannelRead` immediately on opening a text channel (no wait for scroll bottom); `firstUnreadEventId` is retained this session as the divider anchor and recalculated from the new marker on next load.
- **selectGroup hash**: after each long await (`loadGroups` / membership / sync / paint), re-read same-group channel from `parseHash()` so a mid-flight hash change is not overwritten by the initial `updateHash(preset)`.
- **Frontend E2E**: `test/frontend/unread.spec.mjs` (badge + divider + clear-on-read).

## @mention Inbox

- **Storage**: `{userDictionary}/shells/chat/inbox/{recipientEntityHash}/events.jsonl` + `read.json` (per-recipient read watermark). Incremental write: `src/chat/lib/inbox.mjs` + `dag/messageFanout.mjs` (`eventPersist` called after `message`/`message_edit` persisted). **Skip**: `content.type === 'call'`（通话卡片 create/roster/end 会多次 `message_edit`，不当收件箱信号）.
- **Syntax**: `@[entity:<128hex>]` in message body (see `shared/inlineTokenSyntax.mjs`); Hub renderer/composer displays displayName (`shared/expandMentions.mjs`, `hub/mentionAutocomplete.mjs`).
- **API**: `GET /inbox`, `GET|PUT /inbox/seen` fixed to operator entity (no recipient parameter); agent inbox only via `getChatClient(username, agentHash).inbox`. Group autocomplete: `GET …/groups/:id/mentions/suggest`.
- **Hub**: server bar `@` button + `#inbox` list (`hub/inboxView.mjs` + `hub/inboxClient.mjs`); badge driven by WS `channel_message.mentions.entityHashes`.
- **Mention rendering**: `shared/expandMentions.mjs` expands before markdown processing; entity links via `formatSocialProfileHref` from `/parts/shells:social/shared/runUri.mjs`.

## Aliases / petnames

- **Local aliases** (entity-private, not in DAG — canonical key is hash only): via `ChatClient.aliases` / `GET|PUT …/aliases` (HTTP fixed to operator).
- **Shared client** `shared/aliases.mjs` (Social reuses via `/parts/shells:chat/shared/aliases.mjs`): `loadAliases()` warms in-memory cache; `aliasForEntity`/`aliasForGroup`/`groupIdForAlias` are synchronous hot-path getters; `setEntityAlias`/`setGroupAlias` (empty string = delete) do a whole-file PUT then update cache. **Cache must be warm before rendering**: Hub calls `await loadAliases()` in `initCore` (before `loadGroups`); Social calls it at `bootstrapSocialApp` start.
- **Set-alias UI**: use `shared/promptText.mjs`（页内 `<dialog>`），never `window.prompt` under profile popup / menus — native prompt is often swallowed or invisible over the custom backdrop, leaving only the “别名已更新” toast. After save call `hub/aliasUi.mjs` `refreshAliasDependentUi` so messages / members / friends column pick up the new label.
- **Name resolution** `shared/nameResolve.mjs`: `resolveDisplayName({ alias, profileName, fallbackLabel, entityHash })` (alias → profile → short hash); `disambiguateLabels` appends `·${hash.slice(64,68)}` for collisions. Hub hot paths — `authorDisplayLabel`, `hydrateAuthorLabels`, hover cards — all go through `resolveDisplayName` (do not access `profile.name` directly); sidebar and settings member lists use `disambiguateLabels` in batch. Every new hash-display point must use these helpers, not bare `.slice()`.
- **@id 表述** `shared/entityHash.mjs` → `formatEntityAtId(entityHash, { handle })`：有具名 `handle` 时 `@handle (@hash…)`，否则 `@hash…`。人物卡 handle 行、Hub 好友搜索副行、Social `entityHandle` / 帖卡·回复 `@id`、Cabinet 戳记等统一走此函数；禁止手写 `` `@${handle}` `` 或裸 `hash.slice`。
- **Deep links**: `#group:@{alias}:{channelId}` resolved by `parseHash` via `groupIdForAlias`; optional `;{eventId}` message anchor; `updateHash` still writes canonical groupId. Standalone share: `fount://run/shells:chat/message;…` wrapped via `wrapProtocolHttpsUrl` → GitHub Pages protocol hop.
- **Message extras**: content may include `locale` / `content_warning` / `sensitive_media` / `forwardedFrom` / `replyTo`（内联引用气泡：`{ eventId, senderName?, preview? }`，与子线程 `thread` 并列） / `fileAlts` (see `shared/messageFields.mjs`)。Composer：`hub/composerReply.mjs`；渲染：`messages/render/blocks.mjs` `quote_block`（有语义 `replyTo` 时不再画 DAG 父边条）。Bare link embeds are hydrated by the frontend markdown renderer (`data-fount-embed`) via `/api/no-cors`, not stored.
- **Network handle search**: profile top-level `handle` (signed public); Hub `#friends` search box + Social feed search call `GET …/entities/search` (multi-hop `part_query` kind `entity_search`). Hub 好友搜索同时扫本机 `chars/`（part 名 / 缓存展示名），命中后走 `dispatchFriendChat({ type: 'char' })`；实体搜索命中本地 agent 时返回 `charPartName`，勿当成远端用户 DM。
