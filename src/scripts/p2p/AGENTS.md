---
description: P2P federation, trust graph, Mailbox, Chat crypto, EVFS, and reputation
globs: src/scripts/p2p/**, src/decl/p2pAPI.ts, src/server/web_server/p2p_endpoints.mjs
alwaysApply: false
---

# P2P / Federation / Entity Files Guide

## Trust boundaries

- **Untrusted ingress**: discovery adverts/signals, link/overlay envelopes, group WebSocket federation frames, `remoteIngest`, `part_timeline_put`/`part_invoke` — validation and `canonicalize*` happen ONLY at this boundary.
- **Trusted after disk**: once read from `events.jsonl`, only `stripDagEventLocalExtensions` runs; reducer/Hub/Social UI do NOT re-run hex canonicalization.
- **P2P identity & node data**: singleton `{dataPath}/p2p/node/` — `node.json`, `network.json`, `denylist.json`, `reputation.json`; operator keypair at `{userDict}/settings/operator.json`; entity profile `{userDict}/entities/{entityHash}/profile.json`. HTTP routes in `src/server/web_server/p2p_endpoints.mjs` (`/api/p2p/federation`, `/network`, `/denylist`, `/personal-lists`, `/entities/*`, `/viewer`). Does not depend on shell Load.
- **TrustGraph fanout**: Social timeline/chunk exploration → `requireTrustGraphProvider().fanoutToTopNodes`; **targeted packets** (Mailbox) → `sendToNode`/User Room, never fanout. `sendToNode` tries `sendToNodeLink` before trust-graph `scopeIds` gate so follow/connect-node peers can answer `fed_chunk_get` even when not yet in merged graph scopes. Group rooms via `registerFederationRoomProvider` (Chat Load); P2P layer does not import Chat. User room password = `sha256('fount-user-room:' + nodeHash)`. Discovery auto-registers `mdns` + `nostr`; Bluetooth gated by `FOUNT_ENABLE_BT_DISCOVERY=1` (scan-only on Windows unless `FOUNT_BT_DISCOVERY_ROLE=dual`).
- **Group room startup invariant**: `group_link_set.start()` must call `registry.ensureRuntime()` before group-topic subscribe/advertise — otherwise creator-only rooms never listen for joiners.
- **User-room startup invariant**: `ensureUserRoom()` must call `registry.ensureRuntime()` on first init — otherwise node-topic advert/listen never starts.
- **Signaling & linking**: `link.mjs` is a stateless dumb pipe (no perfect-negotiation/rollback). Peers dial directly; a true simultaneous dial builds two PCs and deterministically keeps the one initiated by the smaller nodeHash (glare resolution keyed by `connId`). `group_link_set` is **not** a full mesh — `selectLinkTargetsFromMembers` (`peer_pool`) picks top-K trusted + random explore + mandatory initial anchors within budget, never proactively cutting. `dag_event` is relayed once on first sight (valid signature only) to speed DAG convergence, with no reputation penalty. Full mechanics + edge cases (glare, sparse linking, dag_event relay, Windows ICE, live-test relay override): [docs/signaling.md](docs/signaling.md).
- **Mailbox**: store-and-forward at `{dataPath}/p2p/node/mailbox/store.jsonl`; `sendToNode`/`deliverOrStoreMailboxPut`; parts consume via `registerMailboxConsumer`. `GET /api/p2p/mailbox/summary` → `{ pendingCount }`. Routing: `node.json` → `mailbox.maxHop`/`relayFanout*`/`wantFanout` (halved when `batterySaver`).
- **Manifest transfer owner**: shells register matchers via `registerManifestOwnerMatcher(ownerId, match)` in `files/transfer_key_registry.mjs` — P2P core does not hardcode `chat`/`social`.
- **Social timeline fanout / operator key commit**: live in `shells/social/src/timeline/` (`fanout.mjs`, `operator_key_commit.mjs`), not in `scripts/p2p`.
- **Package**: `src/scripts/p2p/package.json` (`@steve02081504/fount-p2p`) with subpath `exports`; monorepo consumers keep `fount/scripts/p2p/...`.
- **Denylist vs personal lists**: node-level `denylist.json` (`scope: subject|entity|node`) = P2P infrastructure; per-entity `personal_block.json`/`personal_hide.json` = public block vs local hide. Social public `block`/`unblock` timeline events = federation truth source for block index.
- **Chat message encryption**: per-channel domain key `K_ch` (`channel_key_rotate` DAG + ECIES wraps); wire scheme **`ckg`**. **CKG-decrypted payload must NOT be trusted outside its enclosing DAG Ed25519 signature context**. Group file master key rotates via DAG `file_master_key_rotate`/HTTP `…/file-key-rotate`. Primitives: `scripts/p2p/key_crypto.mjs`. Types: `src/decl/p2pAPI.ts`.
- **Chat post storage**: hot + cold archive + DAG. Details: [Chat cold archive guide](../../public/parts/shells/chat/src/chat/archive/AGENTS.md).
- **Social follow source of truth**: no `following.json`; follow/unfollow writes only to operator timeline `events.jsonl` + federation fanout + `network.json` explore hints.

## Subjective reputation (`reputation.json`)

- **Single global score per peer** at `{dataPath}/p2p/node/reputation.json` (`byNodeHash[id].score` in `[-1, 1]`). No per-group scopes.
- **Social public block → reputation**: followed entity emits `block`/`unblock` → `applySocialBlockReputationSignal` penalizes **blocked entity's nodeHash**; `selfTrust` on local block uses full weight.
- **Per-entity personal lists**: `personal_block.mjs` — public block index (`personal_block.json`); private hide (`personal_hide.json`, never federated).
- **Subjective slash**: `reputation_slash`/VOLATILE `reputation_slash_alert` adjust target's **global** score via `subjectiveSlashPenalty(claim, repSender, rep_max_eff)` — influence scales with sender trust. Do not remove this weighting.
- **Anti-Sybil**: `applyDecayCollusionAfterSlash` penalizes invite-chain upstream after slash/kick/ban.
- **Safe penalties** (self-observed, attributable): relay bump, gossip unknown-want, message rate, chunk store/fetch, archive digest mismatch, chunk replication ACK timeout on registered targets.
- **Do not add**: penalizing peers who merely forwarded invalid events (frameable); penalizing RPC timeouts/empty responses (network noise + attacker-triggerable).

## Entity files (EVFS)

- **URL**: `GET|PUT|HEAD /api/p2p/entities/{entityHash}/files/{*path}`.
- **Storage**: ciphertext chunks `{dataPath}/p2p/node/chunks/` (CAS); logical manifest `{userDict}/entities/{entityHash}/files/{path}.manifest.json`.
- **Group files**: `groupEntityHash` + path `chat/{fileId}`; chunk miss → group federation or TrustGraph `fed_chunk_get`.
- **Core modules**: `src/scripts/p2p/files/`, `src/scripts/p2p/entity/files/` (evfs, acl, url).
