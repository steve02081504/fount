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

- **Default (no `streamingSfuWss`)**: WebCodecs + server **av-relay** (`codecsAv.mjs`, `/ws/.../av-relay/:roomId`).
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

- **Model**: `channel.messageSeq` (materialized on group state) minus per-user `readMarkers.json` seq → O(1) unread per channel. Backend: `src/chat/lib/readMarkers.mjs`; `PUT …/channels/:id/read-marker`; WS `read_marker` for multi-device sync (filter by `viewer.username` on client).
- **Hub**: `hub/unread.mjs` — badge HTML, `putChannelReadMarker`; sidebar group list sorts by `lastMessageTime`, unread as badge only; earliest-unread divider in `messages/messageShared.mjs` (renders only when at least one read message precedes it). Group list API returns `unreadCount` / `channelUnread` from `enumerateJoinedFederatedGroups`.
- **Open = read**: `loadMessages` calls `markCurrentChannelRead` immediately on opening a text channel (no wait for scroll bottom); `firstUnreadEventId` is retained this session as the divider anchor and recalculated from the new marker on next load.
- **selectGroup hash**: after each long await (`loadGroups` / membership / sync / paint), re-read same-group channel from `parseHash()` so a mid-flight hash change is not overwritten by the initial `updateHash(preset)`.
- **Frontend E2E**: `test/frontend/unread.spec.mjs` (badge + divider + clear-on-read).

## @mention inbox

- **Storage**: `{userDictionary}/shells/chat/mention-inbox/events.jsonl` + `read.json` (global `seenAt` watermark, independent of channel read-markers). Incremental write: `src/chat/lib/mentionInbox.mjs` → `maybeAppendMentionInbox` (hooked into `dag/eventPersist.mjs` on `message`/`message_edit` persist).
- **Syntax**: `@128hex entityHash` in message body; Hub renderer/composer displays displayName (`shared/expandMentions.mjs`, `hub/mentionAutocomplete.mjs`).
- **API**: `GET /mentions` (newest-first + cursor), `GET/PUT /mentions/seen`; group autocomplete at `GET …/groups/:id/mentions/suggest`.
- **Hub**: server bar `@` button + `#mentions` list (`hub/mentionsView.mjs`, via `setMode('mentions')`); badge incremented by WS `channel_message` when the local operator is @-mentioned.
- **Mention rendering**: `shared/expandMentions.mjs` expands before markdown processing; entity links via `formatSocialProfileHref` from `shared/socialRunUri.mjs`.
