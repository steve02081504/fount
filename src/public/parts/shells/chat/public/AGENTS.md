---
description: Chat shell — unified entity model, ChatClient, private state, Hub pointers
globs: src/public/parts/shells/chat/**
alwaysApply: false
---

# Chat Shell Guide

Less-common entity traps (`member_join`, avatars, Load reentrancy, session tip frontier): [entity-details.md](entity-details.md).

## Entity model

- Human and local agent are the same kind of thing: an **entity** with its own keypair. Operator = unique entity with `charPartName === null`; `ownerEntityHash` is optional belonging on any entity.
- Identity / profile / EVFS HTTP: `src/entity/` and `/api/parts/shells:chat/{viewer,entities…}`. Network-only P2P: `/api/p2p/*`. Belonging: `PUT …/entities/owner` / `ChatClient.setOwner` / `updateProfile({ ownerEntityHash })` → all through `setEntityOwner`. Do not write `ownerEntityHash` to profile alone.
- Group writes use per-(group, entity) `signers/{entityHash}/local_signer_seed` — self-signed; no delegate path. `memberKind` is `agent` iff join carries `charname`. **Signer `pubKeyHash` ≠ entityHash**: use operator / DAG `member.entityHash`; never invent an entity from the ephemeral signing pubkey.
- **Webapi identity is always the operator.** Agents: in-process `getChatClient(username, agentEntityHash)`. No HTTP act-as.
- Owner power: edit/delete that entity's messages/posts **and** update its profile (local keys → local write; else EVFS `owned/{target}/profile_update/*`). Attribution stays the owner's signature. Hub never switches to agent view.
- Local profile write gate: `isWritableLocalEntityForUser` = node-writable **and** (operator **or** `ownerEntityHash === operator`). Do not gate on `charPartName` alone.
- **Agent master**: `entity/master.mjs` — trusted owner message requires cryptographic author === declared `ownerEntityHash` and no attribution mismatch. Care lists are UX-only.

## ChatClient

- Entry: `src/api/client/index.mjs` → `getChatClient(username, entityHash?)` (default = operator). API surface: `public/llms.txt`.
- **Message.content (ChatClient / chat_log / OnMessage) is fount text (`string`)**. DAG wire is separate — discriminated `type` (`text` omits `type`; `sticker`/`vote`/`group_invite`/`call` keep top-level fields). Convert at hydrate/serialize (`chatLogEntry_t`); chars must not unpack wire. Shell sidecars under `extension.chat` only (`eventId`, `channelId`, `bridge`, `replyTo`, … — not kind payloads). Wire `files[]` carry `fileId`; hydrated `files[].buffer` is a lazy getter. Types: `decl/channelWire.ts`.
- **Plugins**: per-group `local_plugins.json` (node-only, not DAG). World may inject via `GetChatPlugins` (local name wins). Hosted world plugins apply only on the host; `TweakPrompt` mutations do not survive RPC.
- `OnMessage` may hydrate via `client.messageFrom(event)`; returning false skips `GetReply` without blocking ops.
- **Platform bots (Discord/Telegram/WeChat)**: in-memory **virtual** sessions (`bridge:{platform}:{platformChatId}`), not Hub groups / DAG. Duck-typed via `bridgeOperations`; `getChatClient` → `group(virtualId)` returns virtual Group/Channel/Message; `group.bridgeBot().stop()` / `client.bridgeBots()`.

## Private state (per-entity)

Root: `{userDict}/shells/chat/entities/{entityHash}/` — bookmarks, folders, aliases, read markers, notify prefs, care via `ChatClient.*` / matching `lib/*`. Emoji usage/collection：用户级 shellData `emoji_usage`。Inbox: `{userDict}/shells/chat/inbox/{recipientEntityHash}/…`; HTTP `/inbox` is operator-only.

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
| Session / viewer | [../src/chat/session/AGENTS.md](../src/chat/session/AGENTS.md) |
| Cold archive | [../src/chat/archive/AGENTS.md](../src/chat/archive/AGENTS.md) |
