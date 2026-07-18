# Hub UI details (less common)

Pointers for deep Hub UI work. Day-to-day rules stay in [AGENTS.md](AGENTS.md).

## Entity profile card

- Single paint path: `hub/profile_popup` + `shared/entityProfileCard.mjs` (`paintEntityProfileCard` / `configureEntityProfileCard` / `createEntityProfileCardElement`).
- Modes: `popup` (click + actions), `hover` (`shared/entityProfileHoverCard.mjs` — **one card + one serial paint chain**; `showGeneration` invalidates superseded work), `embedded` / `preview`.
- Hub avatar/author hover → document-delegated `wireEntityProfileHover` only (do not also `bindHoverCardAnchor` on the same nodes). Friends/search rows → `bindEntityProfileHoverAnchor` (no native `title`).
- Click → `profilePopup.mjs`. Cross-shell lightweight click → `shared/entityProfilePopup.mjs`.
- Agent edit modal shows "reset from char part" (`#profile-edit-reset-from-part` → `POST …/entities/:hash/rebuild-from-part`) only when `profile.charPartName` is set.
- Banner: top-level `banner` (EVFS `profile/banner`) overrides hash texture; empty → texture. Locale chips + tag/link editing: `profileLocaleEditor.mjs` (no plain-text `|` syntax).
- Ownership / attribution warning in `shared/entityProfileCard.mjs` (`--color-warning`).

## Message module layout

- Render: `messages/render/` (direct imports, not barrel). Surface: `messages/messageSurface.mjs`. Reactions: `messages/reactionWire.mjs`. Actions: `messages/actions/handlers.mjs` + per-`data-action` files.
- Wiring: `hub/wiring/` (`wireEvents` / `wireBootstrap`). Sidebar: `hub/sidebar/`. Group WS: `hub/stream/` (`connection` / `outbound` / `handlers/`).
- Channel reload: `messages/messageContext.reloadChannel` (do not thread `loadMessages` through every layer).
- Relative imports: from `public/hub/*.mjs` use `../src/...` for `public/src` (`../../src` → `/parts/src` 404). Deeper nests need more `../`.

## Message shortcuts / composer

- Shift → action bar download/delete (`wireShiftKeyHint`). Drag non-body → `messageDragExport.mjs` (standalone HTML + markdown). Char timeline: bubble swipe/arrow (`chatGestures.mjs`), not the more menu.
- Composer disable: `disabled` only when surface CSS hides the input. Visible disabled states: object-key `{ placeholder }` i18n — string keys write `innerHTML` into textarea.
- Optimistic `pending:…`: no pin/reaction/edit/delete until `isDagEventId`. On WS confirm with `composerPendingId`, `applyIncomingMessage*` must `pipeline.refresh()` (bare `appendItem` leaves stale `data-event-id`).

## Unread / inbox / aliases

- Unread: `channel.messageSeq` − per-entity `readMarkers.json`. Hub: `hub/unread.mjs`. Open channel → mark read immediately; keep `firstUnreadEventId` as divider for the session. After long awaits in `selectGroup`, re-read channel from `parseHash()`.
- Inbox: `{userDict}/shells/chat/inbox/{recipientEntityHash}/`. Skip `content.type === 'call'`. Syntax `@[entity:<128hex>]`. API operator-only; agents via `getChatClient(…, agentHash).inbox`.
- Aliases: warm `loadAliases()` before render. Set-alias UI: `shared/promptText.mjs`, never `window.prompt` over custom backdrop. Names: `shared/nameResolve.mjs`. `@id`: `formatEntityAtId`. Deep links: `#group:@{alias}:{channelId}` via `parseHash`.

## Message extras

Content may include `locale` / `content_warning` / `sensitive_media` / `forwardedFrom` / `replyTo` / `fileAlts` (`shared/messageFields.mjs`). Quote bubble only when semantic `replyTo` is present — do not draw DAG `prev_event_ids` as a quote bar. Link embeds hydrate via `data-fount-embed` + `/api/no-cors`, not stored.
