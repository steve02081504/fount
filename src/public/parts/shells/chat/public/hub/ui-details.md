# Hub UI details (less common)

Day-to-day rules: [AGENTS.md](AGENTS.md).

## Entity profile card

- Single paint path: `hub/profile_popup` + `shared/entityProfileCard.mjs` (`paintEntityProfileCard` / `configureEntityProfileCard`).
- Modes: `popup`, `hover` (`shared/entityProfileHoverCard.mjs` — one card + serial paint; `showGeneration` invalidates superseded work), `embedded` / `preview`.
- Hub avatar/author hover → document-delegated `wireEntityProfileHover` only. Friends/search rows → `bindEntityProfileHoverAnchor`.
- Click → `profilePopup.mjs`. Cross-shell → `shared/entityProfilePopup.mjs`.
- Agent "reset from char part" only when `profile.charPartName` is set. Banner: EVFS `profile/banner` or hash texture. Locale/tag editing: `profileLocaleEditor.mjs`.

## Message module layout

- Render: `messages/render/`. Surface: `messages/messageSurface.mjs`. Reactions: `messages/reactionWire.mjs`. Actions: `messages/actions/handlers.mjs`.
- Wiring: `hub/wiring/`. Sidebar: `hub/sidebar/`. Group WS: `hub/stream/`.
- Channel reload: `messages/messageContext.reloadChannel` (do not thread `loadMessages` through every layer).
- Relative imports: from `public/hub/*.mjs` use `../src/...` for `public/src` (`../../src` → `/parts/src` 404).

## Message shortcuts / composer

- Shift → action bar download/delete. Drag non-body → `messageDragExport.mjs`. Char timeline: bubble swipe/arrow (`chatGestures.mjs`).
- Composer disable: `disabled` only when surface CSS hides the input. Visible disabled: object-key `{ placeholder }` i18n — string keys write `innerHTML` into textarea.
- Optimistic `pending:…`: no chain writes until `isDagEventId`. On WS confirm with `composerPendingId`, `applyIncomingMessage*` must `pipeline.refresh()`.

## Unread / inbox / aliases

- Unread: `channel.messageSeq` − per-entity `readMarkers.json`. Hub: `hub/unread.mjs`. Open channel → mark read immediately. After long awaits in `selectGroup`, re-read channel from `parseHash()`.
- Inbox: `{userDict}/shells/chat/inbox/{recipientEntityHash}/`. Skip `content.type === 'call'`. Syntax `@[entity:<128hex>]`. API operator-only; agents via `getChatClient(…, agentHash).inbox`.
- Aliases: warm `loadAliases()` before render. Set-alias UI: `shared/promptText.mjs`, never `window.prompt`. Names: `shared/nameResolve.mjs`. `@id`: `formatEntityAtId`. Deep links: `#group:@{alias}:{channelId}` via `parseHash`.

## Message extras

Content may include `locale` / `content_warning` / `sensitive_media` / `forwardedFrom` / `replyTo` / `fileAlts` (`shared/messageFields.mjs`). Quote bubble only when semantic `replyTo` is present. Link embeds hydrate via `data-fount-embed` + `/api/no-cors`, not stored.

## Message prefetch

`MessagePipeline` prefetches `loadMoreTop` within 2 screens of top; `loadOlderMessages` dedupes in-flight.
