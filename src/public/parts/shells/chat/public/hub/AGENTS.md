---
description: Chat Hub frontend (trust model, streaming AV, message storage UI)
globs: src/public/parts/shells/chat/public/hub/**
alwaysApply: false
---

# Chat Hub Frontend Guide

Deeper UI (profile card, module layout, unread/inbox/aliases, cabinet bind perms): [ui-details.md](ui-details.md).

## Trust model

- **Local trust domain**: Hub UI, `/api/parts/shells:chat/...`, and in-process server logic are mutually trusted. Do not duplicate federation hex/array validation on local API/UI state.
- **External untrusted**: P2P wire, `remoteIngest`, federation discovery/mailbox ingress. Validate only at gates (`wire/ingress`, `remoteIngest.mjs`, `schemas/*`).
- **Untrusted remote Markdown**: `messages/render/markdown.mjs` → `renderMarkdownAsString(..., { allowDangerousHtml })`. Trusted: local / self / local-char (`nodeHash` prefix) / viewer-declared master / trust-list (`isTrustedMarkdownAuthor`). Remote self-declared `ownerEntityHash` does **not** elevate. Untrusted: preview+expand for oversized text; hide unsafe executors (js/py/…); safe executors (sql / brainfuck / Godbolt) remain.
- **Stream preview**: `StreamRenderer` defaults to `allowDangerousHtml: false`; elevate only via `data-author-pubkey-hash` + `isTrustedMarkdownAuthor` — never blanket `!isRemote` (federated `stream_chunk` is not bound to the message author). Every frame: `replaceChildren(scrubHtmlActivePayload(html))`. Final hydrate uses `renderMessageMarkdownForPaint` with the normal trust gate.
- **`message_edit` delta**: WS with `content.newContent` → `applyMessageEditToRow` (do not drop `is_generating` on streaming error final). Backfill by eventId must include overlays via `linesIncludingOverlaysForTargets`. Pending MD: `registerPendingMessageMarkdown` + `data-md-pending` — **never** raw markdown in `data-md-raw` attributes.
- **Profile bio**: `paintEntityProfileBio` → `shared/trustedMarkdown.mjs` (same entry as Social).

## Streaming AV

- Default (no `streamingSfuWss`): WebCodecs + **av-relay** (`codecsAv.mjs`, `/ws/.../av-relay/:roomId`). `subscribe mode=preview|full`.
- Group call: `hub/call.mjs` → `/ws/.../call/:groupId/:channelId`; card wire `type: 'call'`. Shift+click = audio-only.
- Session lifecycle traps + shared client: [ui-details.md](ui-details.md#streaming-av-lifecycle).

## UI conventions

- CSS: page-local, no `hub-` prefix. Ready-gate: `HUB_GATE` / `fount:hub-*`. Layout: `body[data-layout-pane]` / `body[data-surface]`. Mobile (`≤768px`): `body[data-layout-pane=nav|main]` via `hubPane.mjs`.
- **`fount.user.send`**: Hub bootstrap registers `globalThis.fount.user.send(string | chatLogEntry)` → current channel. Normalize in `shared/fountUserSend.mjs` (Deno-pure — no `/scripts/*` imports there).
- Errors: `handleError('chat.hub.…')` → `.catch` closure (toast + console + Sentry) for fount faults. User mistakes: `showToastI18n`. Impl: `/scripts/features/errorHandlers.mjs`.
- Floating promises: call directly; no need for `void`. Use `return void sideEffect()` only when the side effect's return value is not `undefined`.
- Prefer `renderTemplate` / `mountTemplate`. Modals: `openDialogFromTemplate` (`modal-box` only). Cross-shell shared modules: `withTemplates`, never bare `usingTemplates`. Prefer DaisyUI; context menus via `/scripts/components/positionContextMenu.mjs`; prompts via `/scripts/features/promptDialog.mjs`.
- **HTTP**: named functions in `../src/endpoints/*.mjs` only — no UI `fetch` of shell REST (`share.mjs` Litterbox is the sole non-endpoint exception). Global whoami/getdetails/EVFS → `/scripts/endpoints/`.
- State: `core/state.mjs` — import exported bindings; heavy modules use call-site `await import()`.
- No hardcoded user-visible strings; `data-i18n` / `setElementI18n` + `zh-CN.json`.
- **@-mention autocomplete**: on `<textarea>` use only `aria-controls` / `aria-activedescendant`; do not add `role="combobox"` / `aria-expanded`.

## Files / messages / archive

- Files drawer: `state.cabinets` by role; open Cabinet `#shared:{cabinetId}`. Bind permission matrix: [ui-details.md](ui-details.md#files--cabinets). Attachments stay on chat DAG.
- Main read: `GET …/view-log` (`getChannelViewLog`); backfill `POST …/view-log/batch-get`. Raw `/messages` = moderation only. Decrypt failure: `decryptView: { failed: true }` with `content: null`.
- Navigation: `messages/channelMessageStore.mjs` + `scrollToMessageEventId`.
- Portable archive: [archive AGENTS](../../src/chat/archive/AGENTS.md). HTTP: `GET …/channels/:id/export`, `POST …/channels/import` (`MANAGE_CHANNELS`).

## Search

Hub `#friends` search: local `chars/` → `dispatchFriendChat({ type: 'char' })`; entity search hits with `charPartName` are local agents — not remote-user DMs. Network handle search: `GET …/entities/search`.
