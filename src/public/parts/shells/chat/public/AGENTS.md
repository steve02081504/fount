---
description: Chat shell — unified entity model, ChatClient, private state, Hub pointers
globs: src/public/parts/shells/chat/**
alwaysApply: false
---

# Chat Shell Guide

## Entity model

- Human and local agent are the same kind of thing: an **entity** with its own keypair. Operator = unique entity with `charPartName === null`; `ownerEntityHash` is optional belonging on any entity.
- Identity / profile / EVFS HTTP: `src/entity/` and `/api/parts/shells:chat/{viewer,entities…}`. Network-only P2P: `/api/p2p/*`. Belonging: `PUT …/entities/owner` / `ChatClient.setOwner` / `updateProfile({ ownerEntityHash })` → all through `setEntityOwner`. Do not write `ownerEntityHash` to profile alone.
- Profile `handle` (`[a-z0-9_.-]{2,32}`, optional, not unique) lives in signed `profile.json`. Network search: `GET …/entities/search` / `ChatClient.entities.search` via `part_query` kind `entity_search`. **Handler registered in chat `Load`** (`registerChatEntitySearchHandler`, after `registerShellPartpath` — not `initP2PServer`). Local agent hits also match `charPartName` (Hub friend search → char DM).
- Group writes use per-(group, entity) `signers/{entityHash}/local_signer_seed` — self-signed; no delegate path. `memberKind` is `agent` iff join carries `charname`. **Signer `pubKeyHash` ≠ entityHash**: use operator / DAG `member.entityHash`; never invent an entity from the ephemeral signing pubkey.
- **`member_join`**: `bindingSig` + `verifyEntityActivePubKeyBelongs` — cannot spoof another entityHash with a self-made active key.
- **Webapi identity is always the operator.** Agents: in-process `getChatClient(username, agentEntityHash)`. No HTTP act-as.
- Owner power: edit/delete that entity's messages/posts **and** update its profile (local keys → local write; else EVFS `owned/{target}/profile_update/*`). Attribution stays the owner's signature. Hub never switches to agent view.
- Local profile write gate: `isWritableLocalEntityForUser` = node-writable **and** (operator **or** `ownerEntityHash === operator`). Do not gate on `charPartName` alone.
- **Agent master**: `entity/master.mjs` — trusted owner message requires cryptographic author === declared `ownerEntityHash` and no attribution mismatch. Care lists are UX-only.
- **Agent-only groups**: `createInvite` → `activateGroupFederation` must include `entityHash` or `group_settings_update` is rejected.
- **Avatars**: `shared/hashAvatar.mjs` + `entityAvatar.mjs` + Hub `avatarCover.mjs`. Empty → hash letter. Part `info.avatar` syncs via `syncAgentProfileFromCharPart`. `/parts/<part>/…` avatar URLs map to that part's `public/`. Backfill missing on ensure; do not overwrite existing.
- **Load reentrancy**: char `Load` → `ensureLocalAgentEntityHash` → `syncAgentProfileFromCharPart` must not `loadPart` the same char. Prefer `part.info` over re-running `UpdateInfo`.

## ChatClient

- Entry: `src/api/client/index.mjs` → `getChatClient(username, entityHash?)` (default = operator).
- Surface: groups/DM/join, channel send (+ files), reactions/pins/votes, governance, fork/reputation/denylist, federation, session slots (persona/world/**node-local plugins**/char/frequency), `triggerReply`, `streamingAuth`, profile/owner/search, bridge bots, private-state namespaces.
- **Plugins**: per-group `local_plugins.json` (node-only, not DAG). World may inject via `GetChatPlugins` (local name wins). Hosted world plugins apply only on the host; `TweakPrompt` mutations do not survive RPC.
- `OnMessage` may hydrate via `client.messageFrom(event)`; returning false skips `GetReply` without blocking ops.
- Bridge groups: duck-typed `bridgeOperations`; `group.bridgeBot().stop()` / `client.bridgeBots()`.

## Private state (per-entity)

Root: `{userDict}/shells/chat/entities/{entityHash}/`.

| Datum | File / module |
| --- | --- |
| bookmarks / groupFolders / aliases | JSON via `ChatClient.*` + `endpoints/preferences.mjs` |
| readMarkers | `lib/readMarkers.mjs` |
| notificationPreferences | `lib/notificationPreferences.mjs` (HTTP still `/notify-prefs`) |
| custom emojis / stickers | `client.emojis` / `client.stickers` |
| care | `client.care` (`targetEntityHash` only) |

Inbox: `{userDict}/shells/chat/inbox/{recipientEntityHash}/…`; HTTP `/inbox` is operator-only.

## Files

- Message attachments: DAG `file_upload` + `fileMasterKey` / chunk store.
- Shared group cabinets: Cabinet op-log; chat only distributes keys via `cabinet_bind` / `cabinet_key_update` / `cabinet_unbind`. Hub lists binds; manage at Cabinet `#shared:{id}`.

## HTTP

Thin wrappers: `endpoints/shared.mjs` → `chatClientFromReq` → operator client. Shapes: `public/llms.txt`.

`GET …/groups/:id/state` → `{ meta, viewer, federation }`. Frontend flatten must **not** let `viewer.roles` (held role IDs) overwrite `meta.roles` (role definition map) — write held roles into `myRoles`.

## Specialized guides

| Area | Doc |
| --- | --- |
| Hub frontend | [hub/AGENTS.md](hub/AGENTS.md) |
| Session / viewer / WorldChatHost | [../src/chat/session/AGENTS.md](../src/chat/session/AGENTS.md) |
| Cold archive | [../src/chat/archive/AGENTS.md](../src/chat/archive/AGENTS.md) |
