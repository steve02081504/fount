# P2P signaling notes

Standing conclusions for live federation. Package: `@steve02081504/fount-p2p`.

## connId dual-PC glare elimination

No WebRTC perfect-negotiation/rollback on `node-datachannel`. **Rule**: both sides dial; on true simultaneous dial build two PCs, then drop one. Logic in `link_registry.mjs`:

- One-way dial: `ensureDirectLinkToNode` → random `connId` → `createConnSession` + `createLink({ initiator: true })`. Frames `{ type: 'signal', from, connId, body }`; `signalSessions` keyed by `connId`.
- Inbound `handleIncomingSignal`: existing `connId` → deliver; new `connId` + offer → independent answer PC (not blocked by per-nodeHash `inflights`); late ice/answer with no session → drop.
- Pick-one in `registerResolvedLink`: keep link initiated by the smaller nodeHash (`linkIsPreferred`). Winner becomes canonical before loser closes (`close('glare-loser')`). Only the canonical link fires `linkUp`. `onDown` emits `linkDown` only for the current canonical link.
- Session cleaned from `signalSessions` on close.

Normal one-way dial never builds a second PC. `trickleIceOff` stretches `have-local-offer` and raises glare rate. Regression: `test/live/link_glare_two_pc.test.mjs`.

## hello/auth handshake frame ordering

Handshake: each side sends `hello` (`{ v, nodeHash, nodePubKey, nonce }`), then `auth` (`sign(peerNonce + localFingerprint + localNodeHash)`) after seeing peer `hello`.

On simultaneous dial, initiator may reply `auth` before emitting its own `hello`. **Buffer early `auth` and verify once `hello` arrives — never drop** (`pendingAuth` in `link/link.mjs`). Dropping leaves `remoteAuthVerified` false → handshake timeout → no federation `members>=2`. Regression: `test/pure/link_handshake_reorder.test.mjs`.

## Sparse group linking (peer_pool)

Large groups do not full-mesh. `group_link_set.mjs` uses `selectLinkTargetsFromMembers` (`peer_pool.mjs`) within `resolveFederationPoolLimits`: top-K trusted + M random explore, filtered by quarantine/denylist, **forcibly including initial anchors**. `start()` selects once; membership changes debounce via `notePeerCandidate` (dial newly selected only; never proactively cut — over-budget via registry `trimToBudget`).

## dag_event first-seen multi-hop relay

Sparse mesh cannot rely on gossip pull alone. In `roomHandlers/sync.mjs`, on first seen (`tryMarkSeenFederationEvent`) and signature valid (`applied`/`pending`/`quarantined`; not `invalid`), forward `stripDagEventLocalExtensions(event)` to `pickFederationTargetPeerIds` (minus sender). Relaying carries no reputation penalty.

## Windows / libdatachannel

When `trickleIceOff === true`: send final offer/answer only after ICE gathering completes; dedupe duplicate remote frames; queue remote ICE until both descriptions ready. Otherwise common failures: `Got a remote candidate without ICE transport` / duplicate-answer state errors.

## Live-test relay override

Live tests inject shared loopback relays via `init({ P2P: { signaling: { relayOverride, mdnsPolicy, trickleIceOff } } })` → `initP2PServer` → `initNode` (`src/scripts/test/node/p2p_signaling.mjs` + `--p2p-relay-url`). Honor `getSignalingRuntimeConfig().relayOverride` in all discovery paths.
