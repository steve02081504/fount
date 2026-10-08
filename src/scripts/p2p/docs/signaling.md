# P2P signaling notes

Standing conclusions for live federation. Package: `@steve02081504/fount-p2p`.

## connId dual-PC glare elimination

No WebRTC perfect-negotiation/rollback on `node-datachannel`. **Rule**: both sides dial; on true simultaneous dial build two PCs, then drop one. Logic in `link_registry.mjs`:

- One-way dial: `ensureDirectLinkToNode` → random `connId` → `createConnSession` + `createLink({ initiator: true })`. Frames `{ type: 'signal', from, connId, body }`; `signalSessions` keyed by `connId`.
- Inbound `handleIncomingSignal`: existing `connId` → deliver; new `connId` + offer → independent answer PC (not blocked by per-nodeHash `inflights`); late ice/answer with no session → drop.
- Pick-one in `registerResolvedLink`: keep link initiated by the smaller nodeHash (`linkIsPreferred`). Winner becomes canonical before loser closes (`close('glare-loser')`). Only the canonical link fires `linkUp`. `onDown` emits `linkDown` only for the current canonical link.
- Session cleaned from `signalSessions` on close.

Normal one-way dial never builds a second PC. Candidates always travel inside the description (gathering-then-send is a fixed semantic — there is no trickle mode), which stretches `have-local-offer` and raises glare rate. Regression: `test/live/link_glare_two_pc.test.mjs`.

## hello/auth handshake frame ordering

Handshake: each side sends `hello` (`{ v, nodeHash, nodePubKey, nonce }`), then `auth` (`sign(peerNonce + localFingerprint + localNodeHash)`) after seeing peer `hello`.

On simultaneous dial, initiator may reply `auth` before emitting its own `hello`. **Buffer early `auth` and verify once `hello` arrives — never drop** (`pendingAuth` in `link/link.mjs`). Dropping leaves `remoteAuthVerified` false → handshake timeout → no federation `members>=2`. Regression: `test/pure/link_handshake_reorder.test.mjs`.

## Sparse group linking (peer_pool)

Large groups do not full-mesh. `group_link_set.mjs` uses `selectLinkTargetsFromMembers` (`peer_pool.mjs`) within `resolveFederationPoolLimits`: top-K trusted + M random explore, filtered by quarantine/denylist, **forcibly including initial anchors**. `start()` selects once; membership changes debounce via `notePeerCandidate` (dial newly selected only; never proactively cut — over-budget via registry `trimToBudget`).

## dag_event first-seen multi-hop relay

Sparse mesh cannot rely on gossip pull alone. In `roomHandlers/sync.mjs`, on first seen (`tryMarkSeenFederationEvent`) and signature valid (`applied`/`pending`/`quarantined`; not `invalid`), forward `stripDagEventLocalExtensions(event)` to `pickFederationTargetPeerIds` (minus sender). Relaying carries no reputation penalty.

## Windows / libdatachannel ICE

Candidates always travel inside the description (no trickle mode): send the final offer/answer only after ICE gathering settles; dedupe duplicate remote frames; queue remote ICE until both descriptions are ready. Otherwise common failures: `Got a remote candidate without ICE transport` / duplicate-answer state errors.

`iceLocalHostnamePolicy` is the **start** of a ladder (`drop` → `none`), not a platform guess. A rung that gathered no candidate at all cannot work regardless of what the peer supports, so the initiator rebuilds the peer connection on the next rung and re-sends the offer; the offer carries the rung number and the responder rebuilds on that rung, never escalating on its own. `rewrite-loopback` sits outside the ladder — setting it pins that single policy, which is what same-machine tests want. Gathering completion is event-driven (`icecandidate` events; `node-datachannel` keeps `localDescription.sdp` free of candidate lines), so it can finish while `iceGatheringState` stays `gathering`: on a quiet candidate stream once candidates arrived, or on a stall fallback when nothing was gathered at all — the latter is logged and leaves DTLS / data-channel timeouts to decide instead of failing the dial outright.

## Direct WebRTC behind a proxy / on a virtualised host

`fount eval -f src/scripts/p2p/rtc_probe.mjs` reports what this host can actually offer ICE (backend, every candidate's type/address, STUN errors) without touching the network or dialing anyone. Two nodes in different provinces/ISPs, both behind a Clash TUN, could not hold a direct link; the probe plus live instrumentation of `RTCPeerConnection` (candidate list, state transitions, `close()` callers) showed this is environmental, not a defect in the link code:

- **`srflx` is unstable or absent.** Re-running the probe on the same host alternated between two server-reflexive candidates (public `103.151.173.197`, then `111.18.136.39` inside one session) and none at all. When UDP egress is a proxy pool, the advertised reflexive address belongs to a proxy node and the peer cannot come back through it; when STUN is dropped, the peer only ever sees RFC1918 host candidates. Either way UDP hole punching cannot complete.
- **Both sides advertise unreachable virtual adapters.** The Clash TUN address `198.18.0.1` was present on *both* hosts (so ICE pairs involving it point at the sender's own tunnel), plus VirtualBox host-only `192.168.56.1`, APIPA `169.254.*`, and libdatachannel's fabricated IPv6 `fdfe:dcba:9876::1`. ICE treats them as ordinary candidates, so they only burn check budget.
- **Inbound can be firewalled per network profile.** On Windows the Deno allow rule may be `Profile: Public` while the active WLAN is `Private`, so the peer cannot open the direct path at all. One-directional checks can still occasionally connect, which reads as flapping instead of failure.
- **ICE is not always broken**: one attempt reached `iceConnectionState: connected` (and died ~40 s later), the next stayed in `checking` until it closed. A green `fed_*` run cannot rule this out — those relays are loopback.

For hosts like these the relay transport is the correct outcome, not a bug. A direct transport needs one of: node traffic exempted from the proxy so STUN reports a stable address; both hosts in one shared overlay network (ZeroTier/Tailscale) whose addresses both sides can reach; or a TURN server. Node links accept a node-local ICE list through `p2p.iceServers` in `data/config.json`; fount passes it to `configureLinkRegistry` before node startup. For example:

```json
{
	"p2p": {
		"iceServers": [
			{ "urls": "turn:turn.example.net:3478", "username": "node-user", "credential": "local-secret" }
		]
	}
}
```

Fount uses the package sanitizer to validate `stun:`, `turn:`, and `turns:` URLs, drop malformed entries, and enforce the 12-entry limit; it drops duplicate entries first so they do not consume that limit. When no valid entries remain, the package default STUN list is used. Keep TURN credentials in this local config only: they are passed to the link registry for `RTCPeerConnection` and must not be copied into adverts, DAG data, logs, or `/api/p2p/*` responses. To check whether the host can gather useful candidates before testing a relay, run `fount eval -f src/scripts/p2p/rtc_probe.mjs`. Then test two nodes behind the affected networks with TURN configured and confirm `ensureLinkToNode()` resolves to `providerId=webrtc`; inspect `link.stats()` for `rttMs` and frame counters.

## Live-test relay override

Live tests inject shared loopback relays via `init({ P2P: { signaling: { channels } } })` → `initP2PServer` → `initNode` (`src/scripts/test/node/p2p_signaling.mjs` + `--p2p-relay-url`). Test configs are **nostr-only**: `channels.nostr.relay` carries the loopback URLs, `lan`/`bt` are `false` (so test nodes never link real nodes on the same LAN), and `channels.webrtc` sets `iceLocalHostnamePolicy: 'rewrite-loopback'` (pins the ICE ladder's single policy for same-machine candidates). All discovery/link paths honor `getSignalingRuntimeConfig().channels`.

## Nostr relay publish health and answer retries

Fixed in `0.0.51`, which fount now pins ([#42](https://github.com/steve02081504/fount-p2p/issues/42), `f361376` + `7155b3b`): each publish target's result is recorded, including results that arrive after another relay already accepted the event. `publishEvent()` succeeds as soon as any target accepts, and when every target rejects or times out it records each outcome before failing. A publish failure demotes that relay for 30 minutes. Probe successes do not clear that publish-failure cooldown; a later successful publish does.

`getListenRelays()` excludes only the known `NIP66_BOOTSTRAP_RELAYS` until this node has successfully published to them. These bootstrap relays remain discovery sources while ordinary NIP-66 discoveries remain eligible for publish testing. Explicit relay URLs in `channels.nostr.relay` or node `relayUrls` remain configured publish targets even while their pool health is poor; their outcomes still update pool health.

When an answerer's initial WebRTC answer publish fails before the link is ready, it retries after 200 ms and then 500 ms, for up to three sends total. It stops retrying if the peer connection was replaced or closed, or the link is already ready.

The measurement below was collected one relay at a time through `sendNodeSignalPacket()` (kind 20787) on 2026-10-07, on `0.0.50` (pre-#42, so rejections were not recorded yet):

| relay | publish result |
| --- | --- |
| `wss://relay.primal.net` | accepted, 380 ms |
| `wss://relay.snort.social` | accepted, 394 ms |
| `wss://relay.nostr.com` | accepted, 360 ms |
| `wss://nostr.bitcoiner.social` | no `OK` (3 s timeout); retry: `Policy violated and pubkey is not in our web of trust.` |
| `wss://relay.damus.io` | `banned: too many rate-limit violations` |
| `wss://relay.nostr.watch` | no `OK` (3 s timeout) |
| `wss://relaypag.es` | `blocked: the event doesn't match the allowed filters` |
| `wss://monitorlizard.nostr1.com` | `rejected` |
| `wss://nos.lol`, `wss://nostr.mom` | connect timeout (20 s) |

The old failure symptom was that discovery and ICE were healthy but the dial died after the answerer's publish was rejected:

```
p2p:webrtc answer gathered { rung: 0, policy: 'drop', candidates: 6, hasCandidates: true }
p2p:webrtc fail { err: 'p2p: link closed before ready (signal-error:nostr: publish ok timeout for wss://relay.nostr.watch)' }
```

Before `0.0.51` this could leave `ensureLinkToNode()` returning `null` while the peer only reported `remote-close`, which looked like an ICE/NAT failure. A green `fed_*` run cannot catch this because its loopback relays always accept. Since `0.0.51` records per-relay publish health and retries a failed answer signal, a relay that will not carry our kinds is demoted out of `getWorkingRelays()` / `getListenRelays()` instead.

The fount pin (`deno.json`) is `^0.0.51`, which carries those fixes, so pinning a relay set is no longer required to reach a peer; a pinned set must still contain at least one relay that accepts our kinds. For `0.0.x` the caret admits no newer patch — picking up a later fix means bumping that pin.

To pin a known-good relay set explicitly (optional), update `node.json` through the package API and re-register signaling:

```js
const { saveNodeTransportSettings } = await import('npm:@steve02081504/fount-p2p/node/identity')

// Pin a set that carries us; an explicit list stays a configured publish target regardless of pool health.
saveNodeTransportSettings({ relayUrls: ['wss://relay.primal.net', 'wss://relay.snort.social', 'wss://relay.nostr.com'] })
const { emitNodeChange } = await import('npm:@steve02081504/fount-p2p/node/instance')
emitNodeChange('signaling-changed')   // reloadDiscoveryRelays(): re-register providers + re-listen
```

`setConnectivityDebug(true)` from `npm:@steve02081504/fount-p2p/node/log` is what makes this class of failure readable at all: it turns on the `p2p:dial*` / `p2p:webrtc*` / `p2p:nostr*` trace that distinguishes "no route", "provider skipped", "ICE never connected" and "signalling publish failed".

For a one-shot read-only dump of the same state (links with frame/ping counters, per-peer health and routes, `node.json` relay pin vs resolved publish set vs pool working/listen sets), run [live_state.mjs](../live_state.mjs) through the eval bridge: `fount eval -f src/scripts/p2p/live_state.mjs`. It never dials, publishes or rewrites `node.json`, so it is safe against a live node while a peer agent is watching it.
