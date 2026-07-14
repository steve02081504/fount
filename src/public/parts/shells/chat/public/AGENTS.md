---
description: Chat shell — unified entity model, ChatClient, private state, Hub pointers
globs: src/public/parts/shells/chat/**
alwaysApply: false
---

# Chat Shell Guide

## Entity model

- Human and local agent are the same kind of thing: an **entity** with its own keypair. Operator = the unique entity with `charPartName === null`; `ownerEntityHash` is an optional belonging field on **any** entity (human or agent).
- Identity / profile / EVFS HTTP live under `src/entity/` and `/api/parts/shells:chat/{viewer,entities…}`. Network-only P2P stays on `/api/p2p/*`. Set/clear belonging: `PUT …/entities/owner` (operator self) → `setEntityOwner` (identity + profile + DAG `member_owner_update` fanout).
- Group writes use per-(group, entity) `signers/{entityHash}/local_signer_seed` — self-signed; no delegate / acting path. `memberKind` is `agent` iff join carries `charname`.
- **Webapi identity is always the operator entity.** Agents operate in-process via `getChatClient(username, agentEntityHash)`. There is no HTTP parameter to act or view as another entity.
- Owner content power (only cross-entity privilege): an entity’s declared owner may edit/delete that entity’s messages (human or agent); attribution stays the owner’s signature.
- Agent-only groups：`createInvite` → `activateGroupFederation` 必须带 `entityHash`，否则会用 operator signer 写 `group_settings_update` 并被拒（`requires active member sender`）。

## ChatClient

- Entry: `src/api/index.mjs` → `getChatClient(username, entityHash?)`（缺省 = operator）.
- Surface: groups / DM / join, channel send (+ files), reactions / pins / votes, member+role+channel governance, fork / reputation / denylist, federation catchup+tuning, session slots (persona / world / plugin / char / frequency), `triggerReply`, `streamingAuth`, `updateProfile`, bridge bot lifecycle, private-state namespaces.
- `OnMessage` may hydrate via `client.messageFrom(event)` and operate immediately; returning false skips `GetReply` without blocking those ops.
- Bridge groups: duck-typed `bridgeOperations` registered per bot; `group.bridgeBot().stop()` / `client.bridgeBots()`.
- Integration: `test/integration/chat_client_api.test.mjs`, `entity_private_state.test.mjs`.

## Private state (per-entity)

Root: `{userDict}/shells/chat/entities/{entityHash}/`.

| Datum | File / module |
| --- | --- |
| bookmarks / groupFolders / aliases | JSON via `ChatClient.*` + `endpoints/preferences.mjs` |
| readMarkers | `lib/readMarkers.mjs` |
| notificationPreferences | `lib/notificationPreferences.mjs`（HTTP path still `/notify-prefs`） |
| custom emojis / emoji_usage / stickers | `client.emojis` / `client.stickers` |
| care | `client.care`（body: `targetEntityHash` only） |

Inbox storage remains `{userDict}/shells/chat/inbox/{recipientEntityHash}/…`; HTTP `/inbox` is operator-only (no `recipientEntityHash` query).

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
