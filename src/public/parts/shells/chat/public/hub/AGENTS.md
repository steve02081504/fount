---
description: Chat Hub frontend (trust model, streaming AV, message storage UI)
globs: src/public/parts/shells/chat/public/hub/**
alwaysApply: false
---

# Chat Hub Frontend Guide

Deeper UI (profile card, module layout, unread/inbox/aliases, cabinet bind perms): [docs/ui-details.md](docs/ui-details.md).

## Trust model

- **Local trust domain**: Hub UI, `/api/parts/shells:chat/...`, and in-process server logic are mutually trusted. Do not duplicate federation hex/array validation on local API/UI state.
- **External untrusted**: P2P wire, `remoteIngest`, federation discovery/mailbox ingress. Validate only at gates (`wire/ingress`, `remoteIngest.mjs`, `schemas/*`).
- **Untrusted remote Markdown**: `messages/render/markdown.mjs` → `renderMarkdownAsString(..., { allowDangerousHtml })`. Trusted: local / self / local-char (`nodeHash` prefix) / viewer-declared master / trust-list (`isTrustedMarkdownAuthor`). Remote self-declared `ownerEntityHash` does **not** elevate. Untrusted: preview+expand for oversized text; hide unsafe executors (js/py/…); safe executors (sql / brainfuck / Godbolt) remain.
- **Stream preview**: `StreamRenderer` defaults to `allowDangerousHtml: false`; elevate only via `data-author-pubkey-hash` + `isTrustedMarkdownAuthor` — never blanket `!isRemote` (federated `stream_chunk` is not bound to the message author). Every frame: `replaceChildren(scrubHtmlActivePayload(html))`. Final hydrate uses `renderMessageMarkdownForPaint` with the normal trust gate.
- **`message_edit` delta**: WS with `content.newContent` → `applyMessageEditToRow` (do not drop `is_generating` on streaming error final). Backfill by eventId must include overlays via `linesIncludingOverlaysForTargets`. Pending MD: `registerPendingMessageMarkdown` + `data-md-pending` — **never** raw markdown in `data-md-raw` attributes.
- **Profile bio**: `paintEntityProfileBio` → `shared/trustedMarkdown.mjs` (same entry as Social).
- **`?contact=` / remote profile**: stub name/avatar before fetch returns; DM for any non-self `entityHash`; resolve `activePubKeyHex` via `forceRemote=1` when the link only carried the hash. Fetch/timeout/cache detail: [docs/ui-details.md](docs/ui-details.md#remote-profile--contact).

## Streaming AV

- Default (no `streamingSfuWss`): WebCodecs + **av-relay** (`codecsAv.mjs`, `/ws/.../av-relay/:roomId`). `subscribe mode=preview|full`.
- Group call: `hub/call.mjs` → `/ws/.../call/:groupId/:channelId`; card wire `type: 'call'`. Shift+click = audio-only.
- Session lifecycle traps + shared client: [docs/ui-details.md](docs/ui-details.md#streaming-av-lifecycle).

## UI conventions

- CSS: page-local, no `hub-` prefix. Ready-gate: `HUB_GATE` / `fount:hub-*`. Layout: `body[data-layout-pane]` / `body[data-surface]`. Mobile (`≤768px`): `body[data-layout-pane=nav|main]` via `hubPane.mjs`. Idle surfaces (`groups`/`friends`/…) hide `.input-area`; `selectChannel` must `enableComposer`/`disableComposer` (→ `surface=conversation`) **before** `showHubMainPane`, or mobile opens the chat chrome with no composer. Do not assign `dataset.surface` ad hoc — only `refreshHubHeaderButtons`.
- **`fount.user.send`**: Hub bootstrap registers `globalThis.fount.user.send(string | chatLogEntry)` → current channel. Normalize in `shared/fountUserSend.mjs` (Deno-pure — no `/scripts/*` imports there).
- Errors: `handleError('chat.hub.…')` for fount faults; user mistakes: `showToastI18n`. Floating promises: call directly (no `void`); `return void sideEffect()` only when the side effect returns non-`undefined`.
- Prefer `renderTemplate` / `mountTemplate` / `openDialogFromTemplate`; cross-shell shared modules use `withTemplates`. DaisyUI + shared `promptDialog` / `positionContextMenu`.
- **Composer attachments**: `#attachment-preview` is a compact horizontal strip (64×64 thumbs); styles live in `components.css`. Paperclip (`#image-upload-input`) always enqueues message attachments via `addFilesFromEvent` — snapshot `FileList` with `[...files]` **before** clearing `input.value` (live FileList empties on clear). Message-bubble media comes only from `content.files[]` (DAG + group EVFS `chat/{fileId}`); **do not** inject `[image:…]` (or any media marker) into message text.
- **HTTP**: named functions in `../src/endpoints/*.mjs` only (`share.mjs` Litterbox is the sole non-endpoint exception). Global whoami/getdetails/EVFS → `/scripts/endpoints/`.
- State: `core/state.mjs`. No hardcoded user-visible strings; `data-i18n` / `setElementI18n` + `zh-CN.json`.
- **@-mention autocomplete**: on `<textarea>` use only `aria-controls` / `aria-activedescendant`; do not add `role="combobox"` / `aria-expanded`.

## Files / messages / archive

- Files drawer: `state.cabinets` by role; open Cabinet `#shared:{cabinetId}`. Bind permission matrix: [docs/ui-details.md](docs/ui-details.md#files--cabinets). Attachments stay on chat DAG.
- Message gallery / media viewer: `hub/messages/render/file.mjs` + shared `/scripts/components/mediaViewer.mjs` (ESC / arrows / zoom). Historical `[image:name|url]` markers are stripped in `shared/channelContent.mjs` projections.
- Main read: `GET …/view-log` (`getChannelViewLog`); backfill `POST …/view-log/batch-get`. Raw `/messages` = moderation only. Decrypt failure: `decryptView: { failed: true }` with `content: null`.
- Navigation: `messages/channelMessageStore.mjs` + `scrollToMessageEventId`.
- Portable archive: [archive AGENTS](../../src/chat/archive/AGENTS.md). HTTP: `GET …/channels/:id/export`, `POST …/channels/import` (`MANAGE_CHANNELS`).

## Search

Hub `#friends` search: local `chars/` hits → `dispatchFriendChat({ type: 'char' })`. Group creation passes a `friendBinding` of either `{ charname }` or `{ entityHash }` — never both; `POST …/groups` ensures the agent entity for a `charname` binding. Entity search hits carrying `charPartName` are local agents, not remote-user DMs. Network handle search: `GET …/entities/search`.
