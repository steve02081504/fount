---
description: Chat shell — unified entity model, ChatClient, private state, Hub pointers
globs: src/public/parts/shells/chat/**
alwaysApply: false
---

# Chat Shell Guide

## Entity model

- Human and local agent are the same kind of thing: an **entity** with its own keypair. Operator = the unique entity with `charPartName === null`; `ownerEntityHash` is an optional belonging field on **any** entity (human or agent).
- Identity / profile / EVFS HTTP live under `src/entity/` and `/api/parts/shells:chat/{viewer,entities…}`. Network-only P2P stays on `/api/p2p/*`. Set/clear belonging: `PUT …/entities/owner` (operator self) / `ChatClient.setOwner` / `updateProfile({ ownerEntityHash })` → all funnel through `setEntityOwner` (identity + profile + DAG `member_owner_update` fanout). Do not write `ownerEntityHash` to profile alone.
- Profile top-level `handle` (`[a-z0-9_.-]{2,32}`, optional, not unique) is published in the signed public `profile.json` with `activePubKeyHex` / `keyGeneration`. Network search: `GET …/entities/search?q=` / `ChatClient.entities.search(q)` via fount-p2p `part_query` kind `entity_search` (TTL multi-hop + reverse-path merge + relay cache); **handler registered in chat `Load`** (`registerChatEntitySearchHandler`, after `registerShellPartpath` — not `initP2PServer`). Initiator verifies rows with EVFS `readPublicFile` then ranks by alias / handle exact / interactions / `pickNodeScore`.
- Group writes use per-(group, entity) `signers/{entityHash}/local_signer_seed` — self-signed; no delegate / acting path. `memberKind` is `agent` iff join carries `charname`.
- **Webapi identity is always the operator entity.** Agents operate in-process via `getChatClient(username, agentEntityHash)`. There is no HTTP parameter to act or view as another entity.
- Owner content power (only cross-entity privilege): an entity’s declared owner may edit/delete that entity’s messages (human or agent); attribution stays the owner’s signature. Hub never switches to agent view — agent masters exercise power only via `ChatClient`.
- **Agent master recognition**: `entity/master.mjs` → `resolveDeclaredOwnerEntityHash` / `resolveTrustedOwnerContext`. Trusted owner message requires cryptographic author === declared `ownerEntityHash` **and** no attribution mismatch (`importedFrom` / import resign). Care lists are UX-only, not mastership.
- **Agent-only groups**: `createInvite` → `activateGroupFederation` must include `entityHash`; omitting it uses the operator signer, causing `group_settings_update` to be rejected (`requires active member sender`).
- **Entity avatars (cross-shell)**: `public/shared/hashAvatar.mjs`（配色 / `avatarInitial` / `customProfileAvatar`）+ `entityAvatar.mjs`（`renderAvatarHtml` / `entityAvatarUrl`）+ Hub `avatarCover.mjs`（DOM 宿主）。部件默认图标不算个人头像；无显式头像画 hash 字母。Social / Cabinet 人物卡复用同一套，勿再手写 `charAt(0)` 或盲请求 `files/profile/avatar`。

## ChatClient

- Entry: `src/api/client.mjs` → `getChatClient(username, entityHash?)` (default = operator).
- Surface: groups / DM / join, channel send (+ files), reactions / pins / votes, member+role+channel governance, fork / reputation / denylist, federation catchup+tuning, session slots (persona / world / plugin / char / frequency), `triggerReply`, `streamingAuth`, `updateProfile` / `setOwner`, `entities.search`, bridge bot lifecycle, private-state namespaces.
- `OnMessage` may hydrate via `client.messageFrom(event)` and operate immediately; returning false skips `GetReply` without blocking those ops.
- Bridge groups: duck-typed `bridgeOperations` registered per bot; `group.bridgeBot().stop()` / `client.bridgeBots()`.
- Integration: `test/integration/chat_client_api.test.mjs`, `entity_private_state.test.mjs`, `entity_search.test.mjs`.

## Private state (per-entity)

Root: `{userDict}/shells/chat/entities/{entityHash}/`.

| Datum | File / module |
| --- | --- |
| bookmarks / groupFolders / aliases | JSON via `ChatClient.*` + `endpoints/preferences.mjs` |
| readMarkers | `lib/readMarkers.mjs` |
| notificationPreferences | `lib/notificationPreferences.mjs` (HTTP path still `/notify-prefs`) |
| custom emojis / emoji_usage / stickers | `client.emojis` / `client.stickers` |
| care | `client.care`（body: `targetEntityHash` only） |

Inbox storage remains `{userDict}/shells/chat/inbox/{recipientEntityHash}/…`; HTTP `/inbox` is operator-only (no `recipientEntityHash` query).

## Files

- **Message attachments**: chat DAG `file_upload` + `fileMasterKey` / chunk store (unchanged).
- **Shared group cabinets**: Cabinet shell op-log; chat only distributes keys via DAG `cabinet_bind` / `cabinet_key_update` / `cabinet_unbind` (`src/chat/cabinets/keys.mjs`). Hub lists binds; management UI is Cabinet `#shared:{id}`.

## HTTP

Thin wrappers: `endpoints/shared.mjs` → `chatClientFromReq` → operator client. API shapes: `public/llms.txt`.

## Specialized guides

| Area | Doc |
| --- | --- |
| Hub frontend | [hub/AGENTS.md](hub/AGENTS.md) |
| Session / viewer / WorldChatHost | [../src/chat/session/AGENTS.md](../src/chat/session/AGENTS.md) |
| Cold archive | [../src/chat/archive/AGENTS.md](../src/chat/archive/AGENTS.md) |
| Operational parity | [docs/review/human-agent-operational-parity-review.md](../../../../../../docs/review/human-agent-operational-parity-review.md) |
| Topology / roadmap | [docs/design/chat-social-dev-plan.md](../../../../../../docs/design/chat-social-dev-plan.md) |
