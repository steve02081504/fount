# P2P signaling notes

## connId dual-PC pick-one (glare elimination)

`link.mjs` is a stateless dumb pipe — it does not do WebRTC perfect-negotiation/rollback (the `node-datachannel` polyfill's `setLocalDescription` is a no-op for anything but an offer, and `rollback` is unavailable). The root cause of glare errors is an offer/answer state-machine conflict on a **single PeerConnection**: both sides enter `have-local-offer` at nearly the same time and `setRemoteDescription(offer)` throws `InvalidStateError`.

So link setup is "both sides dial directly; on a true simultaneous dial build two PCs, then deterministically drop one". The logic all lives in `link_registry.mjs`:

- **Dial directly when you want to connect — zero extra cost for a one-way dial.** `ensureDirectLinkToNode` generates a random `connId`, then builds `createConnSession(remote, connId)` + `createLink({ initiator: true })`. Every outbound signal frame looks like `{ type: 'signal', from, connId, body }`, and `signalSessions` is indexed by `connId`.
- **Inbound `handleIncomingSignal` routes by connId**:
  - Session already exists for that `connId` → deliver the body (follow-up answer/ice for a connection we initiated or are answering).
  - No session for that `connId` and body is an offer → build a **new independent answer PC**: `createConnSession` + `createLink({ initiator: false })`. The answer PC is created independently per `connId` and is **not blocked by the per-nodeHash `inflights` dedupe** — this is the key that allows simultaneous bidirectional setup.
  - No session for that `connId` and not an offer (a late ice/answer) → drop it.
- **Deterministic pick-one** `registerResolvedLink`: keep the link "initiated by the smaller nodeHash" (`linkIsPreferred`: `initiator ? local<remote : remote<local`), so both ends reach the same conclusion for any given link. The winner is set as the canonical link before the old link is closed (so on the old link's `onDown`, `links.get` already points at the winner and no spurious linkDown fires); the loser is closed silently with `close('glare-loser')`. **Only the final canonical link fires `linkUp`.**
- **`onDown` only emits `linkDown` when the link being closed is the current canonical one**, avoiding a spurious peer-leave when the loser is closed while both PCs coexist.
- On link close, its session is cleaned from `signalSessions` by `connId`.

In the normal case (one side online, the other just booting a one-way dial) no second PC is created — no callback/double-build cost; only a rare true-simultaneous dial briefly builds two PCs and then drops one. Historically this was mislabeled as "inherent Windows ICE convergence flakiness"; the real cause was the missing glare resolution plus `trickleIceOff` stretching the `have-local-offer` window across the whole ICE-gathering cycle, which amplified the hit rate. Regression guard: `test/live/link_glare_two_pc.test.mjs` (multiple rounds of simultaneous bidirectional setup → deterministic convergence to the single "smaller side initiates" link, usable on both ends).

## Sparse group linking (peer_pool)

Large groups no longer full-mesh `autoconnect`. `group_link_set.mjs` uses `selectLinkTargetsFromMembers` (`peer_pool.mjs`) to pick link targets within the `resolveFederationPoolLimits` budget: top-K trusted (by reputation, reusing `mergeTrustedWithAnchors`) + M random explore (`selectExploreWithSourceQuota`), filtered by `isQuarantinedPure`/denylist, and **forcibly including the initial anchors** (introducer/bootstrap/peer-hint, i.e. the initial `members` of `createGroupLinkSet`) to guarantee connectivity during bootstrap. `start()` selects once and dials; membership changes (advert/envelope) trigger a debounced recompute via `notePeerCandidate` that only dials newly-selected, not-yet-connected peers; it never proactively cuts (over-budget is handled by the registry's `trimToBudget` backstop).

## dag_event first-seen multi-hop relay

On a sparse mesh, DAG convergence cannot rely on gossip pull + tip heartbeats alone. In `roomHandlers/sync.mjs`, `dag.on` forwards `stripDagEventLocalExtensions(event)` to `pickFederationTargetPeerIds` (minus the sender) when the event is **first seen** (gated by `tryMarkSeenFederationEvent`, so each node forwards each event exactly once and never loops) and `ingestRemoteEvent` deems the **signature valid** (`applied`/`pending`/`quarantined`; `invalid` is not forwarded, to avoid amplifying forged events). Relaying carries no reputation penalty (the positive `bumpReputationOnRelay` stays as-is).

## Windows / libdatachannel

When `getSignalingRuntimeConfig().trickleIceOff === true`, send the final offer/answer only after ICE gathering completes, dedupe duplicate remote signal frames, and queue remote ICE until both local/remote descriptions are ready. Otherwise `node-datachannel` commonly fails with `Got a remote candidate without ICE transport` / duplicate-answer state errors.

## Live-test relay override

Live tests inject shared loopback relays via `init({ P2P: { signaling: { relayOverride, mdnsPolicy, trickleIceOff } } })` → `initP2PServer` → `initNode` (`src/scripts/test/node/p2p_signaling.mjs` + `--p2p-relay-url` on the node worker). Honor `getSignalingRuntimeConfig().relayOverride` in all discovery paths.
