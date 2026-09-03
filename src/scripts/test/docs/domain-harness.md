# Domain harness notes (chat / social / live)

Framework-agnostic traps that only matter when writing those suites. Prefer semantic helpers over raw HTTP scans.

## Live layering

Prefer smoke → e2e gates; do not jump straight to full e2e.

- Chat: `server:live` → `smoke_chat` → `e2e_single` → `e2e_single_extended` / `frontend`
- Social: similar via `smoke_social`
- WS: `ws` → `ws_rpc` → `ws_stream`
- Federation: `fed_core` → feature suites. Cross-shell fed probes depend on `fed_core` + `fed_emoji` + `smoke_social`, not full social e2e.

**Triggers follow the same gate**: `shellBackend` only on `pure` / `integration` / `smoke_*`; deeper live suites watch infra + their own script (like fed suites).

Native-addon / WebRTC: one `.test.mjs` per Deno child when the addon panics under reuse. Federation live needs `node-datachannel`. Signaling: [signaling.md](../../p2p/docs/signaling.md). WHIP must lazy-import `node-datachannel` — static import breaks Termux (`MODULE_NOT_FOUND`; no android-arm64 — murat-dogan/node-datachannel#429).

## Live federation

- Reuse `InitializeOpenGroupJoin` / `InitializeOpenGroupJoinMulti` from `live/federation/common.mjs` (`WarmupFedNodeLinks` → `rebind` → members gate → re-invite fallback). Bare create→invite→join without warmup hangs at `members>=2`.
- Live P2P nodes run **nostr-only** via `p2p_signaling.mjs` (`testSignalingFromRelayUrls`): `channels` = nostr(loopback relay) + webrtc, `lan`/`bt` disabled. Test nodes therefore never discover/link a real node on the same LAN — do not re-enable LAN/BT for tests.
- A `members>=2` hang is usually link/handshake/ICE — inspect logs before rerunning ([signaling.md](../../p2p/docs/signaling.md)).
- Join invite URI (`formatJoinRunUri` / `parseJoinRunUri`): single segment `encodeURIComponent(JSON.stringify({ groupId, inviteCode, roomSecret?, … }))` after `join;` — no positional / `key=value` fields. Production room join awaits introducer dial briefly; live tests still warmup explicitly.
- Prefer `TestFedHasMessage` / `TestFedHasReaction` over raw `GET /events?limit=…` (paged streams miss rows that already ingested).

## Chat integration

- **Frontend join has two entry points — keep them in sync**: `deepLinkConsume` (`applyChatRunUri`, fount://run 深链) and `ensureGroupMembership` (`groupMembership.mjs`, Hub 选群/`?invite=` 邀请码). Both must solve PoW when the local replica cannot confirm `joinPolicy` — a local-less replica's `getGroupState` returns the **default** `joinPolicy: 'invite-only'` regardless of the real policy, so checking `state.groupSettings.joinPolicy === 'pow'` alone misses groups that were switched to pow after the invite link was minted (join then fails with "invalid or expired pow solution" since no `powSolution` is attached). Fall back to `getPowChallenge` when `resolvePowForJoin` yields null. Regression: `fed_invite_then_pow` live suite.
- **pow-challenge answers fast for non-pow groups**: `handleFedPowChallengeWant` replies `{ pow: false }` so the requester resolves null instead of waiting out `FETCH_TIMEOUT_MS` (14s) — do not regress this to silence; otherwise `ensureGroupMembership`/`deepLinkConsume` add a 14s stall to every invite/open join on a local-less replica.
- After `postChannelMessage`, wire `event.content` is often channel-key encrypted (`scheme: 'channel-key'`). Assert extras (`locale` / `content_warning`) via `readChannelMessagesForUser` decrypted rows.
- Local concurrent appends (fire-and-forget auto-reply vs `role_assign`, or `Promise.all` of two `appendSignedLocalEvent`) must compute tips **inside** the group write lock. Signing against a stale tip set forks the DAG; `authzFold` keeps one branch and drops the other.
- `message_edit` is folded out of `events.jsonl` during checkpoint rebuild. Assert edits with `readChannelMessagesForUser` + `mergeChannelMessagesForDisplay`.
- Agent hashes: `ensureLocalAgentEntityHash` / `ensureAgentEntityIdentity` (or `keyPairFromSeed` + `entityHashFromRecoveryPubKeyHex`). Never path-derive from `chars/`.
- Social inbound may call `rebuildSignedTimelineSnapshot` with no local identity — that path must not throw through `getEntitySecretKey`.

## HTTP route integration (`launchNode`)

Spawn via `fount/scripts/test/node/launch.mjs`, seed with env scenario + bootstrap worker, then `fetch` `http://127.0.0.1:{port}/api/parts/shells:…?fount-apikey=…`. Example: chat `routes_http.test.mjs` + `FOUNT_TEST_HTTP_SCENARIO` → `routes_http_bootstrap.mjs`. **Do not** call `pickAvailablePort` then pass `port:` — omit `port` so `launchNode` holds until spawn (avoids parallel TOCTOU). Live suite drivers use `runLiveSuiteCli({ buildNode })` — ports are allocated **per suite `fedNodes`**, never pre-hold a max fleet at module load. Cross-suite races after listen-hold release: `core/port_lease.mjs` (lease until child ready); `launchNode` re-holds up to 5 times. Integration `serial.mjs` forces `DENO_JOBS=1` so one file cannot stack parallel `launchNode`s. Ready wait aborts ping when the worker exits or after 2m; `stopNode` after ready must not surface as “exited before ready”. Selftest: `testkit:launch_node`.

## Bluetooth / BLE

fount-p2p treats BLE as optional: probe fails → unavailable and other discovery/link providers take over. Do not add env kill-switches for tests — degrade is the contract.

## Disposable data paths

Never point `dataDir`/`dataPath` at the repo `data/` root. `assertDisposableDataPath` (`core/disposable_path.mjs`) requires OS `tmpdir()` or `{repo}/data/test`. Wired into `startTestServer`, `bootInProcess({ resetData: true })`, and `stopNode` cleanup.

## In-process server

`createTestServerBoot` / `startTestServer`: one `init()` per Deno child. First call boots under `ensureSharedTestDataDir()`; later calls register new usernames into the live config (dirs / `loadParts` / `afterInit`) — isolation is by **random username**, not fresh `dataDir`. Prefer `const { dataDir } = await boot()` for `seedStubCharPart` / filesystem writes — a caller-supplied `mkdtemp` may be ignored after the first init. Import `node/boot.mjs` before registering `Deno.test` (`sanitizeOps`/`sanitizeResources` default false).

## Fixture probes

Share state via module-level singletons under `…/test/fixtures/probes/*.mjs` (e.g. `onMessageProbe`). Do not use `globalThis.__fount*`. Placeholder origins must not be production endpoints (`http://live-bridge.test`, not `127.0.0.1:8931`).

## Defaults / imports

- Missing-file `loadX` defaults must be freshly created (`structuredClone` / new object) — never `{ ...DEFAULT }` sharing nested arrays across entities.
- From `shells/social/src/endpoints/` to chat backend use `../../../chat/...` (`../../../../chat` resolves to `parts/chat` and breaks `Load`).

## Session / world bind (multi-node)

`session_*` is node-local (federation ingest rejects). Multi-node sim/tests must `appendSessionWorldBind` on **each** replica that needs the bind — do not expect gossip to copy session. Nodes without the world part pass `{ distribution, ownerUsername, homeNodeHash }` from a peer that already bound (`mirrorSessionWorldBind` in `world_distribution.test.mjs`); otherwise uninstalled nodes default `distribution` to `hosted` and point home at themselves.

## Social OnMessage / timeline commits

`commitTimelineEvent` / ingest `post` triggers `dispatchSocialMessage` → `loadPart`. Prefer real fixture chars, or `appendTimelineEvent` (skips dispatch).

## Platform bot / OnMessage contract

- Prefer mock Client / Telegraf / WeChat long-poll + no-AI fixture char (`on_message_yes`) over real tokens. Assert platform outbound and that `enumerateJoinedFederatedGroups` does not grow (virtual sessions must not create Hub groups). Threaded replies: forward `replyToPlatformMessageId` into Discord `reply.messageReference` / Telegram `reply_parameters` (first chunk only).
- OnMessage contract (`*/test/integration/on_message_contract.test.mjs` + `chat/test/bridgeContract.mjs`): use `gentian_shell_contract` — DM owner, guild `@bot` / Telegram `@BotUsername`, plain group silence, char log row `{ role: 'char', uid: CharUid }` (never `extension.charId`), Discord backfill-before-trigger, Discord DM with only `OwnerUserID`. Shared asserts: `assertOnMessageEventShape` / `assertCharReplyRowContract` / `assertBackfillBeforeTrigger`. `User*` = operator, `Char*` = agent, `ReplyTo*` = message author — never put the platform author in `User*`. Message.content is fount text; never hand wire `type` to chars.
- Bot shells import chat `public/shared/**`. Keep `chat/public/shared/**` + `shellLoadProbe.mjs` on bot integration triggers; `module_graph_probe.test.mjs` asserts named exports resolve.
