# World shared state + WorldChatHost

Day-to-day session / viewer rules: [AGENTS.md](../AGENTS.md).

- DAG `world_state`: `{ worldname, action: 'set'|'delete', key, value? }` → `state.worldStates[worldname][key]` (LWW, group-scoped — use key prefixes for channel scope).
- Shell reducer is ACL-agnostic; world's fold layer ignores unauthorized ops.
- `WorldChatHost` (`session/worldHost.mjs`): `state`, `localData`, `triggerCharReply`, `postSystemMessage`, `listMembers`/`listChannels`. Wired once on local `resolveWorld` via `ChatHostConnected` (not for builtin/remote proxy).
- `session_*` is node-local (federation ingest rejects). Federation inbound: `aclGated` + 64KB content limit.
