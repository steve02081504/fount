---
description: Chat Hub frontend (trust model, streaming AV, message storage UI)
globs: src/public/parts/shells/chat/public/hub/**
alwaysApply: false
---

# Chat Hub Frontend Guide

## Trust model

- **Local trust domain**: Hub UI, `/api/parts/shells:chat/...`, and in-process server logic are mutually trusted. Do not duplicate federation-style hex/array validation on local API calls or UI state.
- **External untrusted**: Trystero wire, `remoteIngest`, federation discovery/mailbox ingress, remote social payloads. Validate only at gates: `npm:@steve02081504/fount-p2p/wire/ingress`, `src/public/parts/shells/chat/src/chat/dag/remoteIngest.mjs`, `npm:@steve02081504/fount-p2p/schemas/*`.
- **Untrusted remote Markdown**: `messageRender.hydrateOneMarkdown` renders the first 120 chars as preview via the untrusted pipeline (aligned with mention `textPreview`); overflow shows an expand button; trusted authors still use the trusted pipeline (`allowDangerousHtml`).

## Streaming AV

- **Default (no `streamingSfuWss`)**: WebCodecs + server **av-relay** (`codecsAv.mjs`, `/ws/.../av-relay/:roomId`)。roster / `hello` / `frame_type=2` 屏幕共享。
- **群组通话**：文本频道顶栏 → `hub/call.mjs` → `/ws/.../call/:groupId/:channelId`；卡片 `content.type:'call'` + `message_edit` 更新参与者/结束。
- **Shared lean client**（Social live 等复用）: `/parts/shells:chat/shared/avRelayClient.mjs` — `buildSocialLiveAvWsUrl` / `buildChatAvRelayWsUrl` / `buildChatCallWsUrl` / `joinAvRelayRoom`。
- **With external SFU URL**: iframe/embed via `renderStreamingChannel`.
- Hub default: av-relay via `renderCodecsAvStreamingChannel` → `joinHubAvSession` unless SFU configured.

## UI conventions

- **Errors**: use `handleUIError` from `public/src/ui/errors.mjs` — toast + `console.error` + Sentry (all three). Do not catch with only `showToastI18n` alone. Background paths: `toError` + `console.error` + Sentry without toast.
- **Relative imports**: files directly under `public/hub/` must reach shared frontend helpers with `../src/...`; using `../../src/...` resolves to `/parts/src/...` in the browser and hard-fails module loading.
- No hardcoded user-visible strings; use `data-i18n` and `zh-CN.json`.
- Prefer `renderTemplate` / `mountTemplate` over inline `innerHTML`.
- Modals: `openDialogFromTemplate` from `@src/public/pages/scripts/features/dialog.mjs`.
- State: `hubStore` in `core/state.mjs`; banner visibility via `core/bindings.mjs`.

## Message storage & APIs

Backend storage model (hot / cold archive / DAG, federation sync): [archive guide](../../src/chat/archive/AGENTS.md).

Hub-facing API shapes:

- **Main text channel read**: `GET …/view-log` via `getChannelViewLog` (viewer-filtered row DTOs; same shape as raw `/messages`). Response includes `hasMore` + `oldestRawEventId` for filtered empty pages. Raw `GET …/messages` is only for moderation/debugging/navigation backfill.
- **Decrypt failure**: merged rows use top-level `decryptView: { failed: true, pendingGeneration? }` with `content: null`.
- **Reactions**: both view-log and messages return `{ messages, reactions }` — per-page emoji aggregation keyed by target event id.
- **Group state**: `GET …/groups/:id/state` → `{ meta, viewer, federation }`; members use `{ memberKey, kind, ownerPubKeyHash? }`.
- **Display**: prefers `content.displayName`/`content.displayAvatar` on archived/folded posts, then live profile.
- **Navigation**: `messages/channelMessageStore.mjs` owns fetch/merge by `eventId` (`ensureMessageLoaded`); `messages.mjs` handles scroll/highlight (`scrollToMessageEventId`).

## Unread

- **Model**: `channel.messageSeq` (materialized on group state) minus per-entity `shells/chat/entities/{entityHash}/readMarkers.json` seq → O(1) unread per channel. Backend: `src/chat/lib/readMarkers.mjs`；HTTP 固定 operator；`PUT …/channels/:id/read-marker`；WS `read_marker` for multi-device sync (filter by `viewer.username` on client).
- **Hub**: `hub/unread.mjs` — badge HTML, `putChannelReadMarker`; sidebar group list sorts by `lastMessageTime`, unread as badge only; earliest-unread divider in `messages/messageShared.mjs` (renders only when at least one read message precedes it). Group list API returns `unreadCount` / `channelUnread` from `enumerateJoinedFederatedGroups`.
- **Open = read**: `loadMessages` calls `markCurrentChannelRead` immediately on opening a text channel (no wait for scroll bottom); `firstUnreadEventId` is retained this session as the divider anchor and recalculated from the new marker on next load.
- **selectGroup hash**: after each long await (`loadGroups` / membership / sync / paint), re-read same-group channel from `parseHash()` so a mid-flight hash change is not overwritten by the initial `updateHash(preset)`.
- **Frontend E2E**: `test/frontend/unread.spec.mjs` (badge + divider + clear-on-read).

## @mention Inbox

- **Storage**: `{userDictionary}/shells/chat/inbox/{recipientEntityHash}/events.jsonl` + `read.json` (per-recipient read watermark). Incremental write: `src/chat/lib/inbox.mjs` + `dag/messageFanout.mjs` (`eventPersist` called after `message`/`message_edit` persisted).
- **Syntax**: `@[entity:<128hex>]` in message body (see `shared/inlineTokenSyntax.mjs`); Hub renderer/composer displays displayName (`shared/expandMentions.mjs`, `hub/mentionAutocomplete.mjs`).
- **API**: `GET /inbox`、`GET/PUT /inbox/seen` 固定 operator 实体（无换收件人参数）；agent inbox 仅经 `getChatClient(username, agentHash).inbox`。群 autocomplete: `GET …/groups/:id/mentions/suggest`.
- **Hub**: server bar `@` button + `#inbox` list (`hub/inboxView.mjs` + `hub/inboxClient.mjs`); badge driven by WS `channel_message.mentions.entityHashes`.
- **Mention rendering**: `shared/expandMentions.mjs` expands before markdown processing; entity links via `formatSocialProfileHref` from `shared/socialRunUri.mjs`.

## Aliases / petnames

- **Local aliases**（实体私有，不上 DAG — canonical 只用 hash）：经 `ChatClient.aliases` / `GET/PUT …/aliases`（HTTP 固定 operator）。
- **Shared client** `shared/aliases.mjs` (Social reuses via `/parts/shells:chat/shared/aliases.mjs`): `loadAliases()` warms in-memory cache; `aliasForEntity`/`aliasForGroup`/`groupIdForAlias` are synchronous hot-path getters; `setEntityAlias`/`setGroupAlias` (empty string = delete) do a whole-file PUT then update cache. **Cache must be warm before rendering**: Hub calls `await loadAliases()` in `initCore` (before `loadGroups`); Social calls it at `bootstrapSocialApp` start.
- **Name resolution** `shared/nameResolve.mjs`: `resolveDisplayName({ alias, profileName, fallbackLabel, entityHash })` (alias → profile → short hash); `disambiguateLabels` appends `·${hash.slice(64,68)}` for collisions. Hub hot paths — `authorDisplayLabel`, `hydrateAuthorLabels`, hover cards — all go through `resolveDisplayName` (do not access `profile.name` directly); sidebar and settings member lists use `disambiguateLabels` in batch. Every new hash-display point must use these helpers, not bare `.slice()`.
- **Deep links**: `#group:@{alias}:{channelId}` resolved by `parseHash` via `groupIdForAlias`; optional `;{eventId}` message anchor; `updateHash` still writes canonical groupId. Standalone share: `fount://run/shells:chat/message;…` wrapped via `wrapProtocolHttpsUrl` → GitHub Pages protocol hop.
- **Message extras**: content may include `locale` / `content_warning` / `sensitive_media` / `forwardedFrom` / `fileAlts`（见 `shared/messageFields.mjs`）。裸链接 embed 由前端 markdown 渲染器（`data-fount-embed`）经 `/api/no-cors` 水合，不入库。
- **Network handle search**: profile top-level `handle` (signed public); Hub `#friends` search box + Social feed search call `GET …/entities/search` (multi-hop `part_query` kind `entity_search`).
