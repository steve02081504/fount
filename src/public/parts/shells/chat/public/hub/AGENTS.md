---
description: Chat Hub frontend (trust model, streaming AV, message storage UI)
globs: src/public/parts/shells/chat/public/hub/**
alwaysApply: false
---

# Chat Hub Frontend Guide

Deeper UI (profile card, unread/inbox/aliases, cabinet bind perms): [docs/ui-details.md](docs/ui-details.md).

## Trust model

- **Local trust domain**: Hub UI, `/api/parts/shells:chat/...`, and in-process server logic are mutually trusted. Do not duplicate federation hex/array validation on local API/UI state.
- **External untrusted**: P2P wire, `remoteIngest`, federation discovery/mailbox ingress. Validate only at gates (`wire/ingress`, `remoteIngest.mjs`, `schemas/*`).
- **Untrusted remote Markdown**: `messages/render/markdown.mjs` → `renderMarkdownAsString(..., { allowDangerousHtml })`. Trusted: local / self / local-char (`nodeHash` prefix) / viewer-declared master / trust-list (`isTrustedMarkdownAuthor`). Remote self-declared `ownerEntityHash` does **not** elevate. Untrusted: preview+expand for oversized text; hide unsafe executors; safe executors (sql / brainfuck / Godbolt) remain.
- **Stream preview**: `StreamRenderer` defaults `allowDangerousHtml: false`; elevate only via `data-author-pubkey-hash` + `isTrustedMarkdownAuthor` — never blanket `!isRemote`. Every frame: `replaceChildren(scrubHtmlActivePayload(html))`. Final hydrate uses the normal trust gate.
- **`message_edit` delta**: WS `content.newContent` → `applyMessageEditToRow` (keep `is_generating` on streaming error final). Backfill by eventId must include overlays. Pending MD: `registerPendingMessageMarkdown` + `data-md-pending` — **never** raw markdown in `data-md-raw`.
- **Profile bio**: `paintEntityProfileBio` → `shared/trustedMarkdown.mjs` (same as Social).
- **Profile popup refresh**: Hub popup (`hub/profilePopup.mjs`) force-fetches the latest profile; if it changed vs the presence cache, `refreshHubAfterPopupProfileFetch` (→ `refreshHubAfterProfileChange`) repaints message avatars/author labels, member list, char card and friends list — same path as WS `profile_update`. Never force-fetch a profile in a popup without this propagation, or lists stay stale until reload.
- **Friends list avatars**: `friendRows.friendAvatarTemplateFields` renders the peer profile avatar; DM rows always carry `data-avatar-for` so `applyAvatarsTo` hydrates the (possibly remote) profile asynchronously — same hydration as members/messages. Never fetch peer profiles synchronously in `friendRowTemplateData` (it would block the whole list on a remote fetch); the `avatarFor` + `applyAvatarsTo` path also covers search user hits.
- **`?contact=` / remote profile**: stub name/avatar before fetch; DM for any non-self `entityHash`; `forceRemote=1` when the link only carried the hash. Detail: [docs/ui-details.md](docs/ui-details.md#remote-profile--contact).

## Streaming AV

- Default (no `streamingSfuWss`): WebCodecs + **av-relay** (`codecsAv.mjs`, `/ws/.../av-relay/:roomId`). `subscribe mode=preview|full`.
- Group call: `hub/call.mjs` → `/ws/.../call/:groupId/:channelId`; card wire `type: 'call'`. Shift+click = audio-only.
- Session lifecycle traps + shared client: [docs/ui-details.md](docs/ui-details.md#streaming-av-lifecycle).

## UI conventions

- CSS: page-local, no `hub-` prefix. Ready-gate: `HUB_GATE` / `fount:hub-*`. Layout: `body[data-layout-pane]` / `body[data-surface]`. Mobile (`≤768px`): `body[data-layout-pane=nav|main]` via `hubPane.mjs`. Idle surfaces hide `.input-area`; `selectChannel` must `enableComposer`/`disableComposer` **before** `showHubMainPane`. Do not assign `dataset.surface` ad hoc — only `refreshHubHeaderButtons`.
- **`fount.user.send`**: Hub bootstrap registers `globalThis.fount.user.send(string | chatLogEntry)` → current channel. Normalize in `shared/fountUserSend.mjs` (Deno-pure — no `/scripts/*` imports).
- Errors: `handleError('chat.hub.…')` for fount faults; user mistakes: `showToastI18n`. Floating promises: call directly (no `void`); `return void sideEffect()` only when the side effect returns non-`undefined`.
- Prefer `renderTemplate` / `mountTemplate` / `openDialogFromTemplate` from `../src/templates.mjs` (bound via `templatesFor` / `dialogsFor`). DaisyUI + shared `promptDialog` / `positionContextMenu`. From `public/hub/*.mjs` import `public/src` as `../src/...` (`../../src` → `/parts/src` 404).
- **Composer attachments**: `#attachment-preview` strip (64×64); paperclip → `addFilesFromEvent` — snapshot `FileList` with `[...files]` **before** clearing `input.value`. Bubble media only from `content.files[]`; **do not** inject `[image:…]` into message text.
- **HTTP**: named functions in `../src/endpoints/*.mjs` only (`share.mjs` Litterbox is the sole non-endpoint exception). Global whoami/getdetails/EVFS → `/scripts/endpoints/`.
- State: `core/state.mjs`. No hardcoded user-visible strings; `data-i18n` / `setElementI18n` + `zh-CN.json`.
- **@-mention autocomplete**: on `<textarea>` use only `aria-controls` / `aria-activedescendant`; do not add `role="combobox"` / `aria-expanded`. UI lives in the shared `/scripts/components/mentionAutocomplete.mjs` (`attachMentionAutocomplete(textarea, { getContext, providers, listboxPrefix, emptyI18n, accessibleLabelI18n, trailingSpace, onError })`); `hub/mentionAutocomplete.mjs` is a thin wrapper providing the context + providers. Providers run in order, first non-`null` wins; `null` = "not my context". Extension-provided `mentionSuggest` providers (from `markdown_extensions`) run first, then group members/roles, then the DM-friends/local-char fallback. A candidate row may carry `rawToken` to insert a custom token text.
- **Global DOM context markers**: `hub/domContext.mjs` (`bindDomContext`, called from `wiring/bootstrap.mjs`) is the sole writer of `body[data-group-id]` / `body[data-channel-id]` / `body[data-channels]` (JSON array). Do not assign them ad hoc — in-page extensions read them to learn the current group/channel (see also `data-surface`, which stays owned by `refreshHubHeaderButtons`). Clearing the group context (entering discovery/inbox, exiting friend chat, leaving a group) must go through `setState('context.currentGroupId'|'currentChannelId'|'currentState', null)` — **not** direct `store.context.* = null` assignment, which skips the watcher and leaves a stale `body[data-group-id]` that then matches `closest('[data-group-id]')` in delegated click handlers. Discovery card clicks scope to `.discovery-card [data-group-id]` for the same reason.

## Files / messages / archive

- Files drawer: `state.cabinets` by role; open Cabinet `#shared:{cabinetId}`. Bind permission matrix: [docs/ui-details.md](docs/ui-details.md#files--cabinets). Attachments stay on chat DAG.
- Message gallery: `hub/messages/render/file.mjs` + `/scripts/components/mediaViewer.mjs`. Historical `[image:name|url]` stripped in `shared/channelContent.mjs`.
- Main read: `GET …/view-log` (`getChannelViewLog`); backfill `POST …/view-log/batch-get`. Raw `/messages` = moderation only. Decrypt failure: `decryptView: { failed: true }` with `content: null`.
- Navigation: `messages/channelMessageStore.mjs` + `scrollToMessageEventId`.
- Portable archive: [archive AGENTS](../../src/chat/archive/AGENTS.md). HTTP: `GET …/channels/:id/export`, `POST …/channels/import` (`MANAGE_CHANNELS`).

## Search

Hub `#friends` search: local `chars/` hits → `dispatchFriendChat({ type: 'char' })`. Group creation passes a `friendBinding` of either `{ charname }` or `{ entityHash }` — never both; `POST …/groups` ensures the agent entity for a `charname` binding. Entity search hits carrying `charPartName` are local agents, not remote-user DMs. Network handle search: `GET …/entities/search`.
