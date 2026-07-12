---
description: P2P federation, trust graph, Mailbox, Chat crypto, EVFS, and reputation
globs: src/scripts/p2p/**, src/decl/p2pAPI.ts, src/server/web_server/p2p_endpoints.mjs
alwaysApply: false
---

# P2P / Federation / Entity Files Guide

## Package layers (`@steve02081504/fount-p2p`)

- **L0** cross-runtime pure（包内真源）：`hexIds`、`entity_id_parse`（仅寻址原语）、`entity_id`（`hashFromPubKeyHex` / `userEntityHashFrom*`）、`entity/logical_entity`（sentinel nodeHash 逻辑实体寻址）
- **L1** crypto & wire：`crypto`、`key_crypto`、`channel_crypto`（domain-key 信封）、`wire_ingress`、`schemas/*`
- **L2** node runtime：`initNode`、`node/identity`、`entity_store`、`denylist`、`reputation_store`
- **L3** transport：`discovery/*`、`link/*`、`link_registry`、`rooms/scoped_link`、`user_room`、`group_link_set`
- **L4** federation：`trust_graph_*`、`mailbox/*`、`dag/*`、`part_wire_*`、registry 族、EVFS

**包外（shell / 前端；p2p 不 import）：**

- **Chat 语义**：`shells/chat/src/chat/lib/entity.mjs`（`AGENT_SUBJECT_PREFIX` / `agentEntityHash` / `memberEntityHash`）、`lib/groupEntity.mjs`（`fount:chat:group:` 前缀与 groupId 反查）、`lib/groupEmojiPostEmbedRegistry.mjs`、`agentHosting.mjs`（经 `entity/hosting_registry` 注册 char 扫描/解析）
- **前端展示/提及**：`pages/scripts/lib/entity_hash.mjs`（`formatHashShort`）、`pages/scripts/p2p/mentions.mjs`（`extractMentionEntityHashes`）；浏览器镜像 `pages/scripts/p2p/{hexIds,entity_id_parse}.mjs` 带 `// TODO: esm.sh` 待发布后对齐包
- Social federation：`shells/social/src/federation/`（namespace、RPC、follower index、remote ingest、reputation social）
- Chat 权限预设：`shells/chat/src/permissions/chat.mjs`（基于 `permissions/evaluator.mjs`）
- 独立客户端 bootstrap：`import { startNode, createScopedLinkRoom } from 'fount/scripts/p2p/index.mjs'`（或 npm `@steve02081504/fount-p2p`）

**门面**：`index.mjs` 导出 `startNode`（= `initNode` + `ensureNodeDefaults` + `ensureRuntime`）、`createScopedLinkRoom`、`createGroupLinkSet`、`ensureUserRoom`、`registerDiscoveryProvider` 等常用路径；重子系统仍走 subpath。

**发布 TODO**：源码保留 Deno `npm:` 前缀供 monorepo 测试；发布 npm 时改裸 specifier 并去除 `npm:`。

生产 import 边界：`test/integration/p2p_shell_import_guard.test.mjs`（禁 shell/server、禁逃出包根、`fount:chat:`/`agentEntityHash` 字面量等）。

**测试**：`fount test p2p --no-parallel`（Windows 上并行 Deno 子进程易损坏 `node_modules`，见 [denoland/deno#35804](https://github.com/denoland/deno/issues/35804)）。

## Trust boundaries

- **Untrusted ingress**: discovery adverts/signals, link/overlay envelopes, group WebSocket federation frames, `remoteIngest`, `part_timeline_put`/`part_invoke` — validation and `canonicalize*` happen ONLY at this boundary.
- **Trusted after disk**: once read from `events.jsonl`, only `stripDagEventLocalExtensions` runs; reducer/Hub/Social UI do NOT re-run hex canonicalization.
- **P2P identity & node data**: singleton `{dataPath}/p2p/node/` — `node.json`, `network.json`, `denylist.json`, `reputation.json`; operator keypair at `{userDict}/settings/operator.json`; entity profile `{userDict}/entities/{entityHash}/profile.json`. HTTP routes in `src/server/web_server/p2p_endpoints.mjs` (`/api/p2p/federation`, `/network`, `/denylist`, `/personal-lists`, `/entities/*`, `/viewer`). Does not depend on shell Load.
- **TrustGraph fanout**: Social timeline/chunk exploration → `requireTrustGraphProvider().fanoutToTopNodes`; **targeted packets** (Mailbox) → `sendToNode`/User Room, never fanout. `sendToNode` tries `sendToNodeLink` before trust-graph `scopeIds` gate so follow/connect-node peers can answer `fed_chunk_get` even when not yet in merged graph scopes. Group rooms via `registerFederationRoomProvider` (Chat Load); P2P layer does not import Chat. User room password = `sha256('fount-user-room:' + nodeHash)`. Discovery auto-registers `mdns` + `nostr`; Bluetooth gated by `FOUNT_ENABLE_BT_DISCOVERY=1` (scan-only on Windows unless `FOUNT_BT_DISCOVERY_ROLE=dual`).
- **Group room startup invariant**: `group_link_set.start()` / `rooms/scoped_link.start()` must call `registry.ensureRuntime()` before topic subscribe/advertise.
- **User-room startup invariant**: `ensureUserRoom()` must call `registry.ensureRuntime()` on first init — otherwise node-topic advert/listen never starts.
- **Signaling & linking**: `link.mjs` is a stateless dumb pipe (no perfect-negotiation/rollback). Peers dial directly; a true simultaneous dial builds two PCs and deterministically keeps the one initiated by the smaller nodeHash (glare resolution keyed by `connId`). `group_link_set` is **not** a full mesh — `selectLinkTargetsFromMembers` (`peer_pool`) picks top-K trusted + random explore + mandatory initial anchors within budget, never proactively cutting. `dag_event` is relayed once on first sight (valid signature only) to speed DAG convergence, with no reputation penalty. Full mechanics + edge cases (glare, sparse linking, dag_event relay, Windows ICE, live-test relay override): [docs/signaling.md](docs/signaling.md).
- **Mailbox**: store-and-forward at `{dataPath}/p2p/node/mailbox/store.jsonl`; `sendToNode`/`deliverOrStoreMailboxPut`; parts consume via `registerMailboxConsumer`. `GET /api/p2p/mailbox/summary` → `{ pendingCount }`. Routing: `node.json` → `mailbox.maxHop`/`relayFanout*`/`wantFanout` (halved when `batterySaver`).
- **Manifest ACL routing**: shells register `registerManifestAclMatcher` + `registerManifestAcl` in `entity/files/manifest_acl_registry.mjs` — P2P core does not hardcode transfer-key types or logical-entity owners.
- **Manifest transfer owner**: shells register matchers via `registerManifestOwnerMatcher(ownerId, match)` in `files/transfer_key_registry.mjs`.
- **Social timeline fanout / operator key commit**: live in `shells/social/src/timeline/` (`fanout.mjs`, `operator_key_commit.mjs`), not in `scripts/p2p`.
- **Package**: `src/scripts/p2p/package.json` (`@steve02081504/fount-p2p`) with subpath `exports`; monorepo consumers keep `fount/scripts/p2p/...`.
- **Denylist vs personal lists**: node-level `denylist.json` (`scope: subject|entity|node`) = P2P infrastructure; per-entity `personal_block.json`/`personal_hide.json` = public block vs local hide. Social public `block`/`unblock` timeline events = federation truth source for block index.
- **Chat message encryption**: per-channel domain key `K_ch` (`channel_key_rotate` DAG + ECIES wraps); wire scheme **`ckg`**. **CKG-decrypted payload must NOT be trusted outside its enclosing DAG Ed25519 signature context**. Group file master key rotates via DAG `file_master_key_rotate`/HTTP `…/file-key-rotate`. Primitives: `scripts/p2p/key_crypto.mjs`. Types: `src/decl/p2pAPI.ts`.
- **Chat post storage**: hot + cold archive + DAG. Details: [Chat cold archive guide](../../public/parts/shells/chat/src/chat/archive/AGENTS.md).
- **Social follow source of truth**: no `following.json`; follow/unfollow writes only to operator timeline `events.jsonl` + federation fanout + `network.json` explore hints.

## Subjective reputation (`reputation.json`)

- **Single global score per peer** at `{dataPath}/p2p/node/reputation.json` (`byNodeHash[id].score` in `[-1, 1]`). No per-group scopes.
- **Public block → reputation**: shells register `registerBlockReputationHandler`; `applyBlockReputationSignal` propagates via handler.
- **Per-entity personal lists**: `personal_block.mjs` — public block index (`personal_block.json`); private hide (`personal_hide.json`, never federated).
- **Subjective slash**: `reputation_slash`/VOLATILE `reputation_slash_alert` adjust target's **global** score via `subjectiveSlashPenalty(claim, repSender, rep_max_eff)` — influence scales with sender trust. Do not remove this weighting.
- **Anti-Sybil**: `applyDecayCollusionAfterSlash` penalizes invite-chain upstream after slash/kick/ban.
- **Safe penalties** (self-observed, attributable): relay bump, gossip unknown-want, message rate, chunk store/fetch, archive digest mismatch, chunk replication ACK timeout on registered targets.
- **Do not add**: penalizing peers who merely forwarded invalid events (frameable); penalizing RPC timeouts/empty responses (network noise + attacker-triggerable).

## Entity files (EVFS)

- **URL**: `GET|PUT|HEAD /api/p2p/entities/{entityHash}/files/{*path}`.
- **Storage**: ciphertext chunks `{dataPath}/p2p/node/chunks/` (CAS); logical manifest `{userDict}/entities/{entityHash}/files/{path}.manifest.json`.
- **Group files**: chat shell `groupEntityHash` + path `chat/{fileId}`; chunk miss → group federation or TrustGraph `fed_chunk_get`.
- **Core modules**: `src/scripts/p2p/files/`, `src/scripts/p2p/entity/files/` (evfs, acl, url).
