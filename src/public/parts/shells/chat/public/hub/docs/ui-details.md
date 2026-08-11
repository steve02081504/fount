# Hub UI details (less common)

Day-to-day rules: [AGENTS.md](../AGENTS.md).

## Streaming AV lifecycle

- `session.close()` must be idempotent on an internal `closed` flag — never gate on `activeSession === session` after leave nulls the global.
- Use `onClosed` for facade reset. Abort joins with a generation counter; do not `await joinInFlight` from inside join.
- Shared client: `/parts/shells:chat/shared/avRelayClient.mjs` + `avRelayPresets.mjs`. Social live WS URL: `/parts/shells:social/shared/liveAvWsUrl.mjs`.

## Entity profile card

- Single paint path: `hub/profile_popup` + `shared/entityProfileCard.mjs` (`paintEntityProfileCard` / `configureEntityProfileCard`).
- SFW: locale `sfw_*` + top-level `sfw_banner` (`scripts/sfw.mjs` `applySfwOverlay`, same shape as part.info). `getProfile` resolves by viewer `user.sfw`; the edit modal has its own mode toggle. `user-setting-changed` `{ key: 'sfw' }` → Hub/Social clear caches and repaint.
- Modes: `popup`, `hover` (`shared/entityProfileHoverCard.mjs` — one card + serial paint; `showGeneration` invalidates superseded work), `embedded` / `preview`.
- Hub avatar/author hover → document-delegated `wireEntityProfileHover` only. Friends/search rows → `bindEntityProfileHoverAnchor`.
- Click → `profilePopup.mjs`. Cross-shell → `shared/entityProfilePopup.mjs`.
- Agent "reset from char part" only when `profile.charPartName` is set. Banner: EVFS `profile/banner` (SFW: `profile/sfw_banner`) or hash texture. Locale/tag editing: `profileLocaleEditor.mjs`.
- Entity files: `GET/HEAD/PUT/POST …/entities/:hash/files/*logicalPath` (POST = multipart any path; `profile/{sfw_,}avatar|banner` also rewrite profile fields).

## Remote profile / contact

- Hub `GET …/entities/:hash` uses `fetchRemote`.
- Profile races `readPublicFile` with `REMOTE_PROFILE_FETCH_TIMEOUT_MS` (cold miss must cover EVFS manifest+chunk fanout; warm path is SWR in fount-p2p≥0.0.22) + negative cache (`profile.mjs`).
- Popup paints a stub name/avatar before the fetch returns so a hung peer cannot leave an empty card.
- DM button shows for any non-self `entityHash`; click (and `dispatchFriendChat`) resolve `activePubKeyHex` via `forceRemote=1` when the contact link only carried the hash.

## Message module layout

- Render: `messages/render/`. Surface: `messages/messageSurface.mjs`. Reactions: `messages/reactionWire.mjs`. Actions: `messages/actions/handlers.mjs`.
- Wiring: `hub/wiring/`. Sidebar: `hub/sidebar/`. Group WS: `hub/stream/`.
- Channel reload: `messages/messageContext.reloadChannel` (do not thread `loadMessages` through every layer).
- Relative imports: from `public/hub/*.mjs` use `../src/...` for `public/src` (`../../src` → `/parts/src` 404).

## Message shortcuts / composer

- Shift → action bar download/delete. Drag non-body → `messageDragExport.mjs`. Char timeline: bubble swipe/arrow (`chatGestures.mjs`).
- HTML export (download / share / copy HTML / drag): `messages/exportHtml.mjs` → `scripts/features/markdown/standaloneDocument.mjs` (full offline document + group attachment data URLs); do not emit bare Markdown fragments alone. Download / drag-to-desktop filenames follow the exported document `<title>`.
- Composer disable: `disabled` only when surface CSS hides the input. Visible disabled: object-key `{ placeholder }` i18n — string keys write `innerHTML` into textarea.
- Optimistic `pending:…`: no chain writes until `isDagEventId`. On WS confirm with `composerPendingId`, `applyIncomingMessage*` must `pipeline.refresh()`.

## Files / cabinets

Bind/unbind and `role_access` changes require `ADMIN`/`MANAGE_ADMINS` (`POST …/cabinets/bind`); wrap-only `cabinet_key_update` still needs `MANAGE_ROLES`.

## Unread / inbox / aliases

- Unread: `channel.messageSeq` − per-entity `readMarkers.json`. Hub: `hub/unread.mjs`. Open channel → mark read immediately. After long awaits in `selectGroup`, re-read channel from `parseHash()`.
- Inbox: `{userDict}/shells/chat/inbox/{recipientEntityHash}/`. Skip `content.type === 'call'`. Syntax `@[entity:<128hex>]`. API operator-only; agents via `getChatClient(…, agentHash).inbox`.
- Aliases: warm `loadAliases()` before render. Set-alias UI: `/scripts/features/promptDialog.mjs`, never `window.prompt`. Names: `shared/nameResolve.mjs`. `@id`: `formatEntityAtId`. Deep links: `#group:@{alias}:{channelId}` via `parseHash`.

## Message extras

Content may include `locale` / `content_warning` / `sensitive_media` / `forwardedFrom` / `replyTo` (`shared/messageFields.mjs`). Attachment alt text lives on `files[].description` — not `fileAlts`. Quote bubble only when semantic `replyTo` is present. Link embeds hydrate via `data-fount-embed` + `/api/no-cors`, not stored. Message images/videos render from `content.files` (gallery + `/scripts/components/mediaViewer.mjs`); never inject media markers into text.

## Message prefetch

`MessagePipeline` prefetches `loadMoreTop` within 2 screens of top; `loadOlderMessages` dedupes in-flight.
