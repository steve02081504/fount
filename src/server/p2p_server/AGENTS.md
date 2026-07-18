---
description: fount-side P2P integration — npm @steve02081504/fount-p2p, server glue, shell boundaries
globs: src/server/p2p_server/**, src/server/web_server/p2p*.mjs, src/decl/p2pAPI.ts
alwaysApply: false
---

# P2P Integration Guide (fount monorepo)

P2P core lives in npm package [**@steve02081504/fount-p2p**](https://www.npmjs.com/package/@steve02081504/fount-p2p) (source: [fount-p2p](https://github.com/steve02081504/fount-p2p)). Package-internal pure/integration/live/sim tests run in the package repo (`npm test` / `npm run test:sim`).

## Import conventions

- **Deno / shell / server**: `npm:@steve02081504/fount-p2p/...`
- **Browser public**: `https://esm.sh/@steve02081504/fount-p2p/...`
- **Archive tunables JSON**: `npm:@steve02081504/fount-p2p/dag/tunables.json` → mapped to `shells/chat/src/chat/lib/archive.tunables.json` (kept in sync with the package's `dag/tunables.json`)

## fount-side responsibilities

| Area | Path |
| --- | --- |
| Node startup / entity store glue | `src/server/p2p_server/index.mjs`, `shells/chat/src/entity/store.mjs` (`findHostingUser` matches by profile **or** existing entity directory — groups/shared cabinets are logical entities with no profile) |
| HTTP `/api/p2p/*` (network level) | `src/server/web_server/p2p_endpoints.mjs` |
| HTTP `/api/parts/shells:chat/*` (entity/profile/EVFS) | `shells/chat/src/entity/endpoints.mjs`, `filesEndpoints.mjs` |
| Chat federation / DAG / encryption | `shells/chat/src/chat/` |
| Social timeline federation | `shells/social/src/federation/`, `timeline/` |
| S3 / multi-replica group file backend | `shells/chat/src/chat/lib/remoteStoragePlugins.mjs` |
| Frontend entityHash / mentions | `shells/chat/public/shared/` |

## Trust boundaries

- **Untrusted inbound**: discovery, link envelopes, WS federation frames, `remoteIngest`, `part_timeline_put`/`part_invoke`, `part_query_req`/`part_query_res` — validate only at gates: `wire/ingress`, `schemas/*`, shell inbound gates.
- **Trusted after disk read**: `events.jsonl` only runs `stripDagEventLocalExtensions`; reducers/UI do not re-canonicalize hex.
- **Node data**: `{dataPath}/p2p/node/` (`node.json`, `denylist.json`, `reputation.json`, etc.); entity identities at `{userDict}/entities/{entityHash}/identity.json` (operator = `charPartName === null`).
- **Mailbox**: `{dataPath}/p2p/node/mailbox/store.jsonl`; directed packets via `sendToNode`, discovery fanout via TrustGraph.
- **part_query**: multi-hop opaque query (`npm:…/wire/part_query`); chat shell Load registers `entity_search` via `registerChatEntitySearchHandler` (after `registerShellPartpath`). Initiator `queryNetwork` / shell `searchEntitiesNetwork`; replies reverse-path; relay cache is unverified clue only.
- **Denylist vs personal lists**: node-level `denylist.json` vs per-entity `personal_block.json` / `personal_hide.json`.
- **Agent identity**: `ensureAgentEntityIdentity(username, charPartName)` / chat `ensureLocalAgentEntityHash` — key-derived entityHash in `entities/{hash}/identity.json`; never path-derive from `chars/`. Frontend char→hash via `GET /api/parts/shells:chat/viewer` `agents[]`; on group join (`addchar`), server calls `ensureLocalAgentEntityHash`.

## Chat shell supplements

- Permission presets: `shells/chat/src/permissions/chat.mjs` (`npm:.../permissions`)
- Cold archive: [archive/AGENTS.md](../../public/parts/shells/chat/src/chat/archive/AGENTS.md)
- Hub frontend: [hub/AGENTS.md](../../public/parts/shells/chat/public/hub/AGENTS.md)

Types: `src/decl/p2pAPI.ts`.
