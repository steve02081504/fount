---
description: fount-side P2P integration — npm @steve02081504/fount-p2p, server glue, shell boundaries
globs: src/server/p2p_server/**, src/server/web_server/p2p*.mjs, src/decl/p2pAPI.ts
alwaysApply: false
---

# P2P Integration Guide (fount monorepo)

Core: [@steve02081504/fount-p2p](https://www.npmjs.com/package/@steve02081504/fount-p2p) ([source](https://github.com/steve02081504/fount-p2p)). Package tests live in that repo.

## Import conventions

- **Deno / shell / server**: `npm:@steve02081504/fount-p2p/...`
- **Browser**: `https://esm.sh/@steve02081504/fount-p2p/...`
- **Archive tunables**: `npm:@steve02081504/fount-p2p/dag/tunables.json` → `shells/chat/src/chat/lib/archive.tunables.json`
- **fount network only**: `startNode` / `ensureLinkToNode` / `sendToNodeLink` / public rooms (`link_registry`, `user_room`, `group_link_set`, `node_scope`, `room_scopes`, `remote_user_room`) + `node/network`. **Node ICE list**: `transport/ice_servers` (`sanitizeIceServersForSettings` / `DEFAULT_ICE_SERVERS`) through `p2p_server/ice_servers.mjs`. **Peer health (read-only)**: `transport/peer_health` → `createPeerHealthTracker`, wired once in `p2p_server/index.mjs` after `initNode`; consume via `getPeerHealthTracker()` (never build a synthetic ping). Do **not** import other `transport/*`. Chat fanout / group ICE / wire helpers: `shells/chat/src/chat/federation/` and `…/lib/iceServers.mjs`.

## fount-side responsibilities

| Area | Path |
| --- | --- |
| Node startup / entity store | `src/server/p2p_server/index.mjs`, `shells/chat/src/entity/store.mjs` (`findHostingUser` matches profile **or** existing entity dir). `initNode({ nodeDir, entityStore })`; signaling via `setSignalingRuntimeConfig`. `ensureUserRoom({ replicaUsername, attachDefaultWires: true })` for mailbox / part / part_query / chunks |
| Node ICE/TURN | Set `p2p.iceServers` in local `data/config.json`; `initP2PServer` normalizes it through `p2p_server/ice_servers.mjs` and configures the link registry before `initNode`. Keep TURN credentials local; never log or publish them |
| Public-good infra | optional `startInfra` / `stopInfra` / `setInfraPriority` / `pullReputationFromNode` / `lockReputationMax` (package `docs/infra.md`). Subfount always runs infra; with a host it pulls host reputation and prioritizes that node |
| HTTP `/api/p2p/*` | `src/server/web_server/p2p_endpoints.mjs` (`connect-node` → `ensureRemoteUserRoom(targetNodeHash)`, no username argument) |
| Network verification | `src/server/p2p_server/verification.mjs` + HTTP `/api/p2p/verification` (create), `/status/:challenge` (poll), `/local` (loopback Pages claim). Challenge/receipt node-scope messages use authenticated sender identity; the injected challenge state machine lives in `verification_service.mjs` (no node runtime imports); the local bridge mirrors `fount-p2p/js/node/verification.mjs` until that package export is published. |
| Entity / profile / EVFS HTTP | `shells/chat/src/entity/endpoints.mjs`, `filesEndpoints.mjs` |
| Chat federation / DAG / encryption | `shells/chat/src/chat/` |
| Social timeline federation | `shells/social/src/federation/`, `timeline/` |
| S3 / multi-replica group files | `shells/chat/src/chat/lib/remoteStoragePlugins.mjs` |
| Frontend entityHash / mentions | `shells/chat/public/shared/` |

**Cross-shell work for another node's shell: node-scope `part_invoke`.** A shell that must make the *peer's* shell do something sends `sendToNodeLink(targetNodeHash, { scope: 'node', action: 'part_invoke', payload: { partpath, invoke, nodeHash } })`. The receiving node's `p2p_server/inbound_handlers.mjs` resolves the username from `partpath`, **loads the target part on demand** (`loadPart`) and calls `interfaces.invokes.P2PInvokeHandler(username, invoke, { requesterNodeHash })`. That is what makes a bare node-scope action the wrong tool: `wire.on` handlers only exist while some part registered them, so an action sent to a shell the peer never loaded is dropped silently. Working example: `shells/chat/src/chat/dm/invitation.mjs` — the fresh node's home shell delivers its DM invitation as `{ kind: 'dm_invitation', … }` and the inviter's node joins the DM without having the chat shell open.

**Local identity with P2P off:** `src/server/server.mjs` `init()` calls `configureNodeStorage({ nodeDir: {dataPath}/p2p/node })` unconditionally (storage only — no runtime, no network). `initP2PServer` then calls `initNode` on the same dir when `P2P` is enabled. Entity identity (operator / agent) must keep working with `P2P: false`; never require a live node for local hash derivation.

## EVFS cross-node reads (targeted fanout)

- When pulling a public file across nodes (`profile.json` / avatar / banner / `cabinets.public.json` / …), **pass `fanoutTargets`** targeting the owner node or group roster — do not rely on the node-scope public fanout: it dials the full peer set before sending, and with many peers the dialing can block past the 8s wait window and the request is lost.
- `readPublicFile` / `readManifestPlaintext` / `readManifestPlaintextStream` / `fetchChunk` all accept and forward `fanoutTargets` (`files/evfs.mjs`, `files/chunk/fetch.mjs`); owner node = `parseEntityHash(entityHash).nodeHash`.
- Working examples to copy: `chat/src/entity/profile.mjs` (`readRemoteProfilePlain`), `chat/src/entity/profileFederation.mjs`, `chat/src/entity/filesEndpoints.mjs` GET, `cabinet/src/remote.mjs`. Do not call bare `readPublicFile(...)` (public fanout) for new code.

## Trust boundaries

- **Untrusted inbound**: discovery, link envelopes, WS federation, `remoteIngest`, `part_timeline_put`/`part_invoke`, `part_query_*` — validate at `wire/ingress`, `schemas/*`, shell inbound gates only.
- **Trusted after disk read**: `events.jsonl` strips local extensions; reducers/UI do not re-canonicalize hex.
- **Node data**: `{dataPath}/p2p/node/`; identities `{userDict}/entities/{entityHash}/identity.json` (operator = `charPartName === null`).
- **Mailbox**: `{dataPath}/p2p/node/mailbox/store.jsonl`; directed `sendToNode`; discovery fanout via TrustGraph.
- **part_query**: multi-hop opaque query; chat Load registers `entity_search` after `registerShellPartpath`. Relay cache is unverified clue only.
- **Denylist vs personal lists**: node `denylist.json` vs per-entity `personal_block.json` / `personal_hide.json`.
- **Agent identity**: `ensureAgentEntityIdentity` / `ensureLocalAgentEntityHash` — key-derived; never path-derive from `chars/`. Frontend char→hash via `GET …/viewer` `agents[]`.

## Related

- Overlay / wire protocol baseline: [p2p-overlay.md](../../../docs/design/p2p-overlay.md)
- Signaling / glare / handshake traps (live fed): [signaling.md](../../scripts/p2p/docs/signaling.md)
- Live node state dump (report-only): [live_state.mjs](../../scripts/p2p/live_state.mjs)
- Local RTC capability probe (report-only): [rtc_probe.mjs](../../scripts/p2p/rtc_probe.mjs)
- Permissions: `shells/chat/src/permissions/chat.mjs`
- Cold archive: [archive/AGENTS.md](../../public/parts/shells/chat/src/chat/archive/AGENTS.md)
- Hub: [hub/AGENTS.md](../../public/parts/shells/chat/public/hub/AGENTS.md)
- Types: `src/decl/p2pAPI.ts`
