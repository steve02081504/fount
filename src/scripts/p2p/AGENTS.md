# P2P / Federation / Entity Files Guide

> Read this when working on P2P, federation, trust graph, Mailbox, Chat crypto/archive, Social federation, or EVFS. No need to load it otherwise.

## 1. Trust boundaries

- **Untrusted ingress**: Trystero, group WebSocket federation frames, `remoteIngest`, `part_timeline_put` / `part_invoke` (Social RPC is a `kind` inside `part_invoke`) — validation and `canonicalize*` happen ONLY at this boundary.
- **Trusted after disk**: once read from `events.jsonl`, only `stripDagEventLocalExtensions` runs (strips extension keys); reducer / Hub / Social UI do NOT re-run hex canonicalization.
- **P2P identity & node data**: singleton node dir `{dataPath}/p2p/node/` — `node.json` (transport, mailbox routing, `batterySaver`), `network.json`, `blocklist.json`, `reputation.json`; per-user operator keypair in `{userDict}/settings/operator.json`; entity profile `{userDict}/entities/{entityHash}/profile.json`. HTTP `/api/p2p/federation` aggregates node transport + operator pubkey (no single on-disk `federation.json`). Other routes: `/api/p2p/network`, `/api/p2p/blocklist`, `/api/p2p/entities/*`, `/api/p2p/viewer` (`src/server/web_server/p2p_endpoints.mjs`). Does not depend on shell Load.
- **TrustGraph fanout**: Social timeline / chunk exploration go through `fanoutToTopNodes`; **targeted business packets** (Mailbox, `deliver`) use only `sendToNode` / User Room, never fanout. Group rooms are injected via `registerFederationRoomProvider` (registered by Chat Load); the P2P layer does not import Chat. User room password is `sha256('fount-user-room:' + nodeHash)`, serving as a global Public Inbox.
- **Mailbox (P2P)**: store-and-forward at `{dataPath}/p2p/node/mailbox/store.jsonl`; `deliver` / `deliverOrStoreMailboxPut` (`scripts/p2p/deliver.mjs`, `mailbox/deliver_or_store.mjs`); Parts consume envelopes via `registerMailboxConsumer`. HTTP `GET /api/p2p/mailbox/summary`. Routing params in `node.json` → `mailbox.maxHop` / `relayFanout*` / `wantFanout` (fanout halved when `batterySaver`).
- **Chat message encryption**: per-channel domain key `K_ch` (`channel_key_rotate` DAG + HPKE wraps); wire scheme **`ckg`**. **A CKG-decrypted payload must NOT be passed or trusted outside its enclosing DAG Ed25519 signature context** (the symmetric layer provides confidentiality only). Group file master key `fileMasterKey` (`fileKeyWraps` from `peer_invite` / federation pull, named symmetrically with `channelKeyWraps`). Crypto primitives in `scripts/p2p/key_crypto.mjs`. Inbound validation via `channel_key_rotate` and `assertFederatedCkgContent`.
- **Chat post storage**: hot zone (`snapshot.json` checkpoint + `hot_posts.latestByChannel`, latest N per channel + pin ±N; group setting `hotLatestMessageCount`) + cold archive (`archive/{channelId}/{YYYY-MM}.jsonl`, plaintext `PostSnapshot`, month digest = rolling SHA-256 in eventId order) + DAG holding only foldable process events. Visible history is not auto-deleted by default; users with a local replica may delete **local** cold-archive copies per month in group settings (DAG untouched). Federation pulls per month: `digest` + `fed_chunk_*` chunked transfer + `monthDigests` multi-peer reputation arbitration (`ARCHIVE_QUORUM_PEER_MIN` may end collection early; `ARCHIVE_QUORUM_PEER_STRICT_MIN` gates writes when reputation is absent); join checkpoint follows the same model; remote manifest only unions month hints. Details in [Chat cold archive guide](../../public/parts/shells/chat/src/chat/archive/AGENTS.md).
- **Social follow source of truth**: there is no `following.json`; follow/unfollow only writes to the operator timeline `events.jsonl` + federation fanout + `network.json` explore hints.

## 2. Subjective reputation (`reputation.json`)

- **Single global score per peer** at `{dataPath}/p2p/node/reputation.json` (`byNodeHash[id].score` in `[-1, 1]`). No per-group scopes.
- **Social public block → reputation**: when a followed entity (including implicit self-follow) emits `block`/`unblock` on their timeline, observers apply `applySocialBlockReputationSignal` — penalty targets the **blocked entity's nodeHash** (user/agent equal); `selfTrust` on local block uses full weight.
- **Per-entity personal lists**: `personal_block.mjs` — public block index in entity store (`personal_block.json`, synced from timeline `blocked`); private hide (`personal_hide.json`, never federated). Chat Hub and Social share these APIs.
- **Subjective slash**: `reputation_slash` / VOLATILE `reputation_slash_alert` adjust the target's **global** score via `subjectiveSlashPenalty(claim, repSender, rep_max_eff)` — influence scales with how much you trust the sender. Do not remove this weighting.
- **Anti-Sybil lever**: `applyDecayCollusionAfterSlash` penalizes invite-chain upstream after slash/kick/ban (global score).
- **Safe reputation penalties** (self-observed, attributable): relay bump, gossip unknown-want, message rate, chunk store/fetch, archive digest mismatch, chunk replication ACK timeout on registered targets.
- **Do not add**: penalizing peers who merely forwarded invalid events (frameable); penalizing RPC timeouts/empty responses (network noise + attacker-triggerable).

## 3. Entity files (EVFS)

- **Unified URL**: `GET|PUT|HEAD /api/p2p/entities/{entityHash}/files/{*path}`.
- **Two-layer storage**: ciphertext chunks `{dataPath}/p2p/node/chunks/` (CAS); logical manifest `{userDict}/entities/{entityHash}/files/{path}.manifest.json`.
- **Group files**: `groupEntityHash` + path `chat/{fileId}`; chunk miss goes through group federation or TrustGraph `fed_chunk_get`.
- **Core modules**: `src/scripts/p2p/files/`, `src/scripts/p2p/entity/files/` (evfs, acl, url).

**See also**: [Root AGENTS.md](../../../AGENTS.md)
