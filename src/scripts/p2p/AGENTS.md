---
description: P2P federation, trust graph, Mailbox, Chat crypto, EVFS, and reputation
globs: src/scripts/p2p/**, src/decl/p2pAPI.ts, src/server/web_server/p2p_endpoints.mjs
alwaysApply: false
---

# P2P / Federation / Entity Files Guide

## Trust boundaries

- **Untrusted ingress**: discovery adverts/signals, link/overlay envelopes, group WebSocket federation frames, `remoteIngest`, `part_timeline_put`/`part_invoke` — validation and `canonicalize*` happen ONLY at this boundary.
- **Trusted after disk**: once read from `events.jsonl`, only `stripDagEventLocalExtensions` runs; reducer/Hub/Social UI do NOT re-run hex canonicalization.
- **P2P identity & node data**: singleton `{dataPath}/p2p/node/` — `node.json` (transport, mailbox routing, `batterySaver`), `network.json`, `denylist.json`, `reputation.json`; operator keypair at `{userDict}/settings/operator.json`; entity profile `{userDict}/entities/{entityHash}/profile.json`. HTTP `/api/p2p/federation` aggregates node transport + operator pubkey (`recoveryPubKeyHex` + `activePubKeyHex`; no `identityPubKeyHex` alias). Other routes: `/api/p2p/network`, `/api/p2p/denylist`, `/api/p2p/personal-lists`, `/api/p2p/entities/*`, `/api/p2p/viewer` (`src/server/web_server/p2p_endpoints.mjs`). Does not depend on shell Load.
- **TrustGraph fanout**: Social timeline/chunk exploration → `fanoutToTopNodes`; **targeted packets** (Mailbox) → `sendToNode`/User Room (`trust_graph.mjs`, `user_room.mjs`), never fanout. `sendToNode` tries `sendToNodeLink` before trust-graph `scopeIds` gate so follow/connect-node peers can answer `fed_chunk_get` even when not yet in merged graph scopes. Unit coverage: `test/trust_graph_send.test.mjs`. Group rooms injected via `registerFederationRoomProvider` (Chat Load); P2P layer does not import Chat. User room password = `sha256('fount-user-room:' + nodeHash)`. Discovery runtime auto-registers `mdns` + `nostr`; optional Bluetooth provider is gated by `FOUNT_ENABLE_BT_DISCOVERY=1`, and defaults to scan-only on Windows unless `FOUNT_BT_DISCOVERY_ROLE=dual`.
- **Group room startup invariant**: `group_link_set.start()` must bring up `registry.ensureRuntime()` before group-topic subscribe/advertise. Creator-only rooms otherwise never start self advert / signal listeners, so later joiners can have a valid room secret yet still dial into a dark owner.
- **User-room startup invariant**: `ensureUserRoom()` must also call `registry.ensureRuntime()` on first init; otherwise node-topic advert/listen never starts and `connect-node` / non-member CAS emoji paths cannot reach the owner until some unrelated outbound dial happens.
- **Discovery relay override**: any new `nostr`-based discovery path must honor `getSignalingRuntimeConfig().relayOverride` (live tests inject shared loopback relays via `FOUNT_TEST_RELAY_URLS`). If you bypass that and call `mergeSignalingRelayUrls()` directly, test nodes silently stop sharing a relay mesh and federation regresses to “peers=0”.
- **Windows/libdatachannel signaling**: when `getSignalingRuntimeConfig().trickleIceOff === true`, send final offer/answer only after ICE gathering completes, dedupe duplicate remote signal frames, and queue remote ICE until both local/remote descriptions are ready. Otherwise `node-datachannel` commonly fails with `Got a remote candidate without ICE transport` / duplicate-answer state errors.
- **Mailbox**: store-and-forward at `{dataPath}/p2p/node/mailbox/store.jsonl`; `sendToNode`/`deliverOrStoreMailboxPut`; parts consume via `registerMailboxConsumer`. `GET /api/p2p/mailbox/summary` → `{ pendingCount }`. Routing: `node.json` → `mailbox.maxHop`/`relayFanout*`/`wantFanout` (halved when `batterySaver`).
- **Denylist vs personal lists**: node-level `denylist.json` (`scope: subject|entity|node`) = P2P infrastructure; per-entity `personal_block.json`/`personal_hide.json` = public block vs local hide (Chat Hub + Social share `GET /api/p2p/personal-lists`). Social public `block`/`unblock` timeline events = federation truth source for block index.
- **Chat message encryption**: per-channel domain key `K_ch` (`channel_key_rotate` DAG + ECIES wraps); wire scheme **`ckg`**. **CKG-decrypted payload must NOT be trusted outside its enclosing DAG Ed25519 signature context** (symmetric layer = confidentiality only). Group file master key rotates via DAG `file_master_key_rotate`/HTTP `…/file-key-rotate`. Crypto primitives: `scripts/p2p/key_crypto.mjs`. Types: `src/decl/p2pAPI.ts` (`RuntimeGroupState` vs `SerializedGroupState`, `PermissionName`, `DenylistEntry`).
- **Chat post storage**: hot (`snapshot.json` + `hot_posts.latestByChannel`) + cold archive (`archive/{channelId}/{YYYY-MM}.jsonl`, plaintext `PostSnapshot`, month digest = rolling SHA-256 in eventId order) + DAG (foldable process events only). Users with local replica may delete local cold-archive per month (DAG untouched). Federation pulls per month: `digest` + `fed_chunk_*` + `monthDigests` multi-peer reputation arbitration (`ARCHIVE_QUORUM_PEER_MIN`; `ARCHIVE_QUORUM_PEER_STRICT_MIN` gates writes when reputation absent). Details: [Chat cold archive guide](../../public/parts/shells/chat/src/chat/archive/AGENTS.md).
- **Social follow source of truth**: no `following.json`; follow/unfollow writes only to operator timeline `events.jsonl` + federation fanout + `network.json` explore hints.

## Subjective reputation (`reputation.json`)

- **Single global score per peer** at `{dataPath}/p2p/node/reputation.json` (`byNodeHash[id].score` in `[-1, 1]`). No per-group scopes.
- **Social public block → reputation**: followed entity emits `block`/`unblock` → `applySocialBlockReputationSignal` penalizes **blocked entity's nodeHash**; `selfTrust` on local block uses full weight.
- **Per-entity personal lists**: `personal_block.mjs` — public block index (`personal_block.json`, synced from timeline `blocked`); private hide (`personal_hide.json`, never federated).
- **Subjective slash**: `reputation_slash`/VOLATILE `reputation_slash_alert` adjust target's **global** score via `subjectiveSlashPenalty(claim, repSender, rep_max_eff)` — influence scales with sender trust. Do not remove this weighting.
- **Anti-Sybil**: `applyDecayCollusionAfterSlash` penalizes invite-chain upstream after slash/kick/ban.
- **Safe penalties** (self-observed, attributable): relay bump, gossip unknown-want, message rate, chunk store/fetch, archive digest mismatch, chunk replication ACK timeout on registered targets.
- **Do not add**: penalizing peers who merely forwarded invalid events (frameable); penalizing RPC timeouts/empty responses (network noise + attacker-triggerable).

## Entity files (EVFS)

- **URL**: `GET|PUT|HEAD /api/p2p/entities/{entityHash}/files/{*path}`.
- **Storage**: ciphertext chunks `{dataPath}/p2p/node/chunks/` (CAS); logical manifest `{userDict}/entities/{entityHash}/files/{path}.manifest.json`.
- **Group files**: `groupEntityHash` + path `chat/{fileId}`; chunk miss → group federation or TrustGraph `fed_chunk_get`.
- **Core modules**: `src/scripts/p2p/files/`, `src/scripts/p2p/entity/files/` (evfs, acl, url).
