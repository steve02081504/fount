# P2P signaling notes

## Windows / libdatachannel

When `getSignalingRuntimeConfig().trickleIceOff === true`, send final offer/answer only after ICE gathering completes, dedupe duplicate remote signal frames, and queue remote ICE until both local/remote descriptions are ready. Otherwise `node-datachannel` commonly fails with `Got a remote candidate without ICE transport` / duplicate-answer state errors.

## Live-test relay override

Live tests inject shared loopback relays via `init({ P2P: { signaling: { relayOverride, mdnsPolicy, trickleIceOff } } })` → `initP2PServer` → `initNode` (`src/scripts/test/node/p2p_signaling.mjs` + `--p2p-relay-url` on the node worker). Honor `getSignalingRuntimeConfig().relayOverride` in all discovery paths.
