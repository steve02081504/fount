---
description: Chat Hub frontend (trust model, streaming AV, message storage UI)
globs: src/public/parts/shells/chat/public/hub/**
alwaysApply: false
---

# Chat Hub Frontend Guide

## Trust model

- **Local trust domain**: Hub UI, `/api/parts/shells:chat/...`, and in-process server logic are mutually trusted. Do not duplicate federation-style hex/array validation on local API calls or UI state.
- **External untrusted**: P2P wire, `remoteIngest`, federation discovery/mailbox ingress, remote social payloads. Validate only at gates: `npm:@steve02081504/fount-p2p/wire/ingress`, `src/public/parts/shells/chat/src/chat/dag/remoteIngest.mjs`, `npm:@steve02081504/fount-p2p/schemas/*`.
- **Untrusted remote Markdown**: `messages/render/markdown.mjs` (`hydrateMessageMarkdown`) renders the first 120 chars as preview via the untrusted pipeline (aligned with mention `textPreview`); overflow shows an expand button; trusted authors still use the trusted pipeline (`allowDangerousHtml`).

## Streaming AV

- **Default (no `streamingSfuWss`)**: WebCodecs + server **av-relay** (`codecsAv.mjs`, `/ws/.../av-relay/:roomId`). Roster / `hello` / `frame_type=2` screen share; `subscribe mode=preview|full` (preview = keyframes only, throttled, no audio).
- **Group call**: text channel header → `hub/call.mjs` → `/ws/.../call/:groupId/:channelId`; card `content.type:'call'` + `message_edit` updates participants/end.
- **Shared lean client** (reused by Social live): `/parts/shells:chat/shared/avRelayClient.mjs` — `buildChatAvRelayWsUrl` / `buildChatCallWsUrl` / `joinAvRelayRoom` (`mode` / `setMode`); frame protocol constants and `packAvFrame` / `unpackAvFrame` / `bytesToHex` exported from here. Quality presets: `shared/avRelayPresets.mjs` `CODECS_PRESETS` (do not import via `codecsAv` barrel). Social live AV WS URL: `/parts/shells:social/shared/liveAvWsUrl.mjs`.
- **With external SFU URL**: iframe/embed via `renderStreamingChannel`.
- Hub default: av-relay via `renderCodecsAvStreamingChannel` → `joinHubAvSession` unless SFU configured.
- **Message direction prefetch**: `MessagePipeline` prefetches `loadMoreTop` when scrolling up and within 2 screens of the top; `loadOlderMessages` deduplicates in-flight requests.

## UI conventions

- **Entity profile card**: Hub 点击头像/作者 → `profilePopup.mjs`；跨壳轻量卡 → `/parts/shells:chat/shared/entityProfilePopup.mjs`。所有完整人物卡（弹窗、独立资料页、编辑实时预览）共用 `hub/profile_popup` 模板 + `shared/entityProfileCard.mjs` 的 `paintEntityProfileCard` / `configureEntityProfileCard`，样式在 `shared/entityProfileCard.css`；勿另造外观近似的卡片。默认头像与 hash 稳定背景纹理由 `shared/hashAvatar.mjs` 生成；顶层 `banner`（EVFS `profile/banner`）有图时覆盖横幅，空串回退纹理。标签/链接编辑走 chip 与动态行（`profileLocaleEditor.mjs`），直接读写 `localized[locale].tags/links`，勿再加纯文本 `|` 语法。所属方框 / 归因警告也在 `shared/entityProfileCard.mjs`（`--color-warning`）。导入历史等 attribution mismatch ≠ Ed25519 验签失败。
- **Errors**: use `handleUIError` from `public/src/ui/errors.mjs` — toast + `console.error` + Sentry (all three). Do not catch with only `showToastI18n` alone. Background paths: `toError` + `console.error` + Sentry without toast.
- **Relative imports**: from `public/hub/*.mjs` use `../src/...` for `public/src` helpers (`../../src` resolves to `/parts/src` in the browser and hard-fails). One nesting deeper (`hub/wiring/`, `hub/messages/`, `hub/federation/`, `hub/sidebar/`, `hub/stream/`) needs `../../src/...` and `../../../../../scripts/...`. Two levels (`hub/messages/render/`, `hub/messages/actions/`, `hub/stream/handlers/`) need `../../../src/...` and `../../../../../../scripts/...`. DOM event wiring lives in `hub/wiring/` (`index.mjs` = `wireEvents`, `bootstrap.mjs` = `wireBootstrap`; filenames drop the `wire` prefix, export names keep it). Sidebar nav: `hub/sidebar/` (`index.mjs` coordinates `selectGroup` / `renderHubChannelSidebar`). Group WS: `hub/stream/` (`connection.mjs` lifecycle; `handlers/` by wire type; `index.mjs` external facade).
- **Message modules**: render coordination in `messages/render/` (`index.mjs` aggregates; body/MD/attachments etc. split by responsibility, direct imports not barrel); action delegation in `messages/actions/handlers.mjs`, each `data-action` in a separate file in the same dir.
- No hardcoded user-visible strings; use `data-i18n` and `zh-CN.json`.
- Prefer `renderTemplate` / `mountTemplate` over inline `innerHTML`.
- Modals: `openDialogFromTemplate` from `@src/public/pages/scripts/features/dialog.mjs`.
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
- **Import**: group settings General card → multipart `POST …/channels/import` → new text channel in the same group; Hub navigates to `#group:{groupId}:{newChannelId}`. Requires `MANAGE_CHANNELS` (`canImportChannel`).
- Backend semantics: [archive AGENTS](../../src/chat/archive/AGENTS.md) § Portable channel archive.

## Unread

- **Model**: `channel.messageSeq` (materialized on group state) minus per-entity `shells/chat/entities/{entityHash}/readMarkers.json` seq → O(1) unread per channel. Backend: `src/chat/lib/readMarkers.mjs`; HTTP fixed to operator; `PUT …/channels/:id/read-marker`; WS `read_marker` for multi-device sync (filter by `viewer.username` on client).
- **Hub**: `hub/unread.mjs` — badge HTML, `putChannelReadMarker`; sidebar group list sorts by `lastMessageTime`, unread as badge only; earliest-unread divider in `messages/messageShared.mjs` (renders only when at least one read message precedes it). Group list API returns `unreadCount` / `channelUnread` from `enumerateJoinedFederatedGroups`.
- **Open = read**: `loadMessages` calls `markCurrentChannelRead` immediately on opening a text channel (no wait for scroll bottom); `firstUnreadEventId` is retained this session as the divider anchor and recalculated from the new marker on next load.
- **selectGroup hash**: after each long await (`loadGroups` / membership / sync / paint), re-read same-group channel from `parseHash()` so a mid-flight hash change is not overwritten by the initial `updateHash(preset)`.
- **Frontend E2E**: `test/frontend/unread.spec.mjs` (badge + divider + clear-on-read).

## @mention Inbox

- **Storage**: `{userDictionary}/shells/chat/inbox/{recipientEntityHash}/events.jsonl` + `read.json` (per-recipient read watermark). Incremental write: `src/chat/lib/inbox.mjs` + `dag/messageFanout.mjs` (`eventPersist` called after `message`/`message_edit` persisted).
- **Syntax**: `@[entity:<128hex>]` in message body (see `shared/inlineTokenSyntax.mjs`); Hub renderer/composer displays displayName (`shared/expandMentions.mjs`, `hub/mentionAutocomplete.mjs`).
- **API**: `GET /inbox`, `GET|PUT /inbox/seen` fixed to operator entity (no recipient parameter); agent inbox only via `getChatClient(username, agentHash).inbox`. Group autocomplete: `GET …/groups/:id/mentions/suggest`.
- **Hub**: server bar `@` button + `#inbox` list (`hub/inboxView.mjs` + `hub/inboxClient.mjs`); badge driven by WS `channel_message.mentions.entityHashes`.
- **Mention rendering**: `shared/expandMentions.mjs` expands before markdown processing; entity links via `formatSocialProfileHref` from `/parts/shells:social/shared/runUri.mjs`.

## Aliases / petnames

- **Local aliases** (entity-private, not in DAG — canonical key is hash only): via `ChatClient.aliases` / `GET|PUT …/aliases` (HTTP fixed to operator).
- **Shared client** `shared/aliases.mjs` (Social reuses via `/parts/shells:chat/shared/aliases.mjs`): `loadAliases()` warms in-memory cache; `aliasForEntity`/`aliasForGroup`/`groupIdForAlias` are synchronous hot-path getters; `setEntityAlias`/`setGroupAlias` (empty string = delete) do a whole-file PUT then update cache. **Cache must be warm before rendering**: Hub calls `await loadAliases()` in `initCore` (before `loadGroups`); Social calls it at `bootstrapSocialApp` start.
- **Name resolution** `shared/nameResolve.mjs`: `resolveDisplayName({ alias, profileName, fallbackLabel, entityHash })` (alias → profile → short hash); `disambiguateLabels` appends `·${hash.slice(64,68)}` for collisions. Hub hot paths — `authorDisplayLabel`, `hydrateAuthorLabels`, hover cards — all go through `resolveDisplayName` (do not access `profile.name` directly); sidebar and settings member lists use `disambiguateLabels` in batch. Every new hash-display point must use these helpers, not bare `.slice()`.
- **Deep links**: `#group:@{alias}:{channelId}` resolved by `parseHash` via `groupIdForAlias`; optional `;{eventId}` message anchor; `updateHash` still writes canonical groupId. Standalone share: `fount://run/shells:chat/message;…` wrapped via `wrapProtocolHttpsUrl` → GitHub Pages protocol hop.
- **Message extras**: content may include `locale` / `content_warning` / `sensitive_media` / `forwardedFrom` / `fileAlts` (see `shared/messageFields.mjs`). Bare link embeds are hydrated by the frontend markdown renderer (`data-fount-embed`) via `/api/no-cors`, not stored.
- **Network handle search**: profile top-level `handle` (signed public); Hub `#friends` search box + Social feed search call `GET …/entities/search` (multi-hop `part_query` kind `entity_search`).
