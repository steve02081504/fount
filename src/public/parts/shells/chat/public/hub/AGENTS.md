---
description: Chat Hub frontend (trust model, streaming AV, message storage UI)
globs: src/public/parts/shells/chat/public/hub/**
alwaysApply: false
---

# Chat Hub Frontend Guide

Deeper UI (profile card modes, module layout, unread/inbox/aliases): [ui-details.md](ui-details.md).

## Trust model

- **Local trust domain**: Hub UI, `/api/parts/shells:chat/...`, and in-process server logic are mutually trusted. Do not duplicate federation hex/array validation on local API/UI state.
- **External untrusted**: P2P wire, `remoteIngest`, federation discovery/mailbox ingress. Validate only at gates (`wire/ingress`, `remoteIngest.mjs`, `schemas/*`).
- **Untrusted remote Markdown**: `messages/render/markdown.mjs` → `renderMarkdownAsString(..., { allowDangerousHtml })`. Trusted tier: local messages, self / local-char (`nodeHash` prefix) / viewer-declared master / trust-list (`isTrustedMarkdownAuthor`). Remote self-declared `ownerEntityHash` does **not** elevate. Untrusted: preview+expand for oversized text; hide unsafe executors (js/py/…); safe executors (sql / brainfuck / Godbolt) remain.
- **Stream preview**: `StreamRenderer` **always** uses `allowDangerousHtml: false`. Federated `stream_chunk` is signature-checked but **not** bound to the generating message's author; trusting the preview would be XSS → local code exec. Final hydrate (non-`data-streaming`) applies the normal trust gate.
- **`message_edit` delta**: WS with `content.newContent` → `applyMessageEditToRow` (do not drop `is_generating` on streaming error final). Backfill by eventId must include overlays via `linesIncludingOverlaysForTargets`. Pending MD: `registerPendingMessageMarkdown` + `data-md-pending` — **never** raw markdown in `data-md-raw` attributes.
- **Profile bio**: `paintEntityProfileBio` → `shared/trustedMarkdown.mjs` (same entry as Social).

## Streaming AV

- Default (no `streamingSfuWss`): WebCodecs + **av-relay** (`codecsAv.mjs`, `/ws/.../av-relay/:roomId`). `subscribe mode=preview|full`.
- Group call: `hub/call.mjs` → `/ws/.../call/:groupId/:channelId`; card `content.type:'call'`. Shift+click = audio-only.
- **Lifecycle**: `session.close()` idempotent on internal `closed` flag — never gate on `activeSession === session` after leave nulls the global. Use `onClosed` for facade reset. Abort joins with a generation counter; do not `await joinInFlight` from inside join. Shared client: `/parts/shells:chat/shared/avRelayClient.mjs` + `avRelayPresets.mjs`.
- Prefetch: `MessagePipeline` prefetches `loadMoreTop` within 2 screens of top; `loadOlderMessages` dedupes in-flight.

## UI conventions

- CSS: page-local, no `hub-` prefix. Full words. Ready-gate: `HUB_GATE` / `fount:hub-*`. Layout: `body[data-layout-pane]` / `body[data-surface]`.
- Mobile (`≤768px`): `body[data-layout-pane=nav|main]` via `hubPane.mjs`.
- Errors: `handleUIError` (toast + `console.error` + Sentry). Background: `toError` + console + Sentry, no toast.
- Prefer `renderTemplate` / `mountTemplate`. Modals: `openDialogFromTemplate` (`modal-box` only). Cross-shell shared modules: `withTemplates`, never bare `usingTemplates`.
- Reusable widgets: short semantic class + CSS; atomic/Tailwind only for DaisyUI and one-off layout. Context menus: `hub/core/positionContextMenu.mjs` + `bindDismissOnDocumentInteraction`.
- State: `core/state.mjs`. No setter-injected appContext bags — import exported bindings; heavy modules use call-site `await import()`.
- No hardcoded user-visible strings; `data-i18n` / `setElementI18n` + `zh-CN.json`.

## Files / messages / archive

- Files drawer: `state.cabinets` by role; open Cabinet `#shared:{cabinetId}`. Bind/unbind: `ADMIN`/`MANAGE_ADMINS`（`POST …/cabinets/bind`）；`cabinet_key_update` 仅改 wraps 仍要 `MANAGE_ROLES`，改 `role_access` 要超管。Attachments stay on chat DAG.
- Main read: `GET …/view-log` (`getChannelViewLog`); backfill `POST …/view-log/batch-get`. Raw `/messages` = moderation only. Decrypt failure: `decryptView: { failed: true }` with `content: null`.
- Navigation: `messages/channelMessageStore.mjs` + `scrollToMessageEventId`.
- Portable archive export/import: [archive AGENTS](../../src/chat/archive/AGENTS.md). HTTP: `GET …/channels/:id/export`, `POST …/channels/import` (`MANAGE_CHANNELS`).

## Search

Hub `#friends` search: local `chars/` → `dispatchFriendChat({ type: 'char' })`; entity search hits with `charPartName` are local agents — not remote-user DMs. Network handle search: `GET …/entities/search`.
