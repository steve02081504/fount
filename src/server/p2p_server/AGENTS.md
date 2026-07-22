---
description: fount-side P2P integration — npm @steve02081504/fount-p2p, server glue, shell boundaries
globs: src/server/p2p_server/**, src/server/web_server/p2p*.mjs, src/decl/p2pAPI.ts
alwaysApply: false
---

# P2P Integration Guide (fount monorepo)

Core lives in [@steve02081504/fount-p2p](https://www.npmjs.com/package/@steve02081504/fount-p2p) ([source](https://github.com/steve02081504/fount-p2p)). Package tests run in that repo.

## Import conventions

- **Deno / shell / server**: `npm:@steve02081504/fount-p2p/...`
- **Browser**: `https://esm.sh/@steve02081504/fount-p2p/...`
- **Archive tunables**: `npm:@steve02081504/fount-p2p/dag/tunables.json` → mapped to `shells/chat/src/chat/lib/archive.tunables.json`

## fount-side responsibilities

| Area | Path |
| --- | --- |
| Node startup / entity store | `src/server/p2p_server/index.mjs`, `shells/chat/src/entity/store.mjs` (`findHostingUser` matches profile **or** existing entity dir — groups/shared cabinets may have no profile). `initNode({ nodeDir, entityStore })` only; signaling via `setSignalingRuntimeConfig`. `ensureUserRoom({ replicaUsername, attachDefaultWires: true })` for mailbox / part / part_query / chunks |
| Public-good infra | optional `startInfra` / `stopInfra` / `setInfraPriority` / `pullReputationFromNode` / `lockReputationMax` (package `docs/infra.md`). Subfount client always runs infra; with a host it pulls the host reputation table and prioritizes that node |
| HTTP `/api/p2p/*` | `src/server/web_server/p2p_endpoints.mjs` |
| Entity / profile / EVFS HTTP | `shells/chat/src/entity/endpoints.mjs`, `filesEndpoints.mjs` |
| Chat federation / DAG / encryption | `shells/chat/src/chat/` |
| Social timeline federation | `shells/social/src/federation/`, `timeline/` |
| S3 / multi-replica group files | `shells/chat/src/chat/lib/remoteStoragePlugins.mjs` |
| Frontend entityHash / mentions | `shells/chat/public/shared/` |

## Trust boundaries

- **Untrusted inbound**: discovery, link envelopes, WS federation, `remoteIngest`, `part_timeline_put`/`part_invoke`, `part_query_*` — validate only at `wire/ingress`, `schemas/*`, shell inbound gates.
- **Trusted after disk read**: `events.jsonl` only strips local extensions; reducers/UI do not re-canonicalize hex.
- **Node data**: `{dataPath}/p2p/node/`; entity identities `{userDict}/entities/{entityHash}/identity.json` (operator = `charPartName === null`).
- **Mailbox**: `{dataPath}/p2p/node/mailbox/store.jsonl`; directed `sendToNode`; discovery fanout via TrustGraph.
- **part_query**: multi-hop opaque query; chat Load registers `entity_search` after `registerShellPartpath`. Relay cache is unverified clue only.
- **Denylist vs personal lists**: node `denylist.json` vs per-entity `personal_block.json` / `personal_hide.json`.
- **Agent identity**: `ensureAgentEntityIdentity` / `ensureLocalAgentEntityHash` — key-derived hash; never path-derive from `chars/`. Frontend char→hash via `GET …/viewer` `agents[]`.

## Related

- Permissions: `shells/chat/src/permissions/chat.mjs`
- Cold archive: [archive/AGENTS.md](../../public/parts/shells/chat/src/chat/archive/AGENTS.md)
- Hub: [hub/AGENTS.md](../../public/parts/shells/chat/public/hub/AGENTS.md)
- Types: `src/decl/p2pAPI.ts`
