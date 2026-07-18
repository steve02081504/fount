# Domain harness notes (chat / social / live)

Framework-agnostic traps that only matter when writing those suites. Prefer semantic helpers over raw HTTP scans.

## Live federation

- Reuse `InitializeOpenGroupJoin` / `InitializeOpenGroupJoinMulti` from `live/federation/common.mjs` (`WarmupFedNodeLinks` → `rebind` → members gate → re-invite fallback). Bare create→invite→join without warmup hangs at `members>=2`.
- A `members>=2` hang is usually link/handshake/ICE — inspect logs before rerunning ([signaling.md](../../p2p/docs/signaling.md)).
- Prefer `TestFedHasMessage` / `TestFedHasReaction` over raw `GET /events?limit=…` (paged streams miss rows that already ingested).

## Chat integration

- After `postChannelMessage`, wire `event.content` is often CKG (`scheme: 'ckg'`). Assert extras (`locale` / `content_warning`) via `readChannelMessagesForUser` decrypted rows.
- `message_edit` is folded out of `events.jsonl` during checkpoint rebuild. Assert edits with `readChannelMessagesForUser` + `mergeChannelMessagesForDisplay`.
- Agent hashes: `ensureLocalAgentEntityHash` / `ensureAgentEntityIdentity` (or `keyPairFromSeed` + `entityHashFromRecoveryPubKeyHex`). Never path-derive from `chars/`.
- Social inbound may call `rebuildSignedTimelineSnapshot` with no local identity — that path must not throw through `getEntitySecretKey`.

## HTTP route integration (`launchNode`)

Spawn via `fount/scripts/test/node/launch.mjs`, seed with env scenario + bootstrap worker, then `fetch` `http://127.0.0.1:{port}/api/parts/shells:…?fount-apikey=…`. Example: chat `routes_http.test.mjs` + `FOUNT_TEST_HTTP_SCENARIO` → `routes_http_bootstrap.mjs`.

## Disposable data paths

Never point `dataDir`/`dataPath` at the repo `data/` root. `assertDisposableDataPath` (`core/disposable_path.mjs`) requires OS `tmpdir()` or `{repo}/data/test`. Wired into `startTestServer`, `bootInProcess({ resetData: true })`, and `stopNode` cleanup.

## In-process server

`createTestServerBoot` / `startTestServer`: one `init()` per Deno child. First call boots under `ensureSharedTestDataDir()`; later calls register new usernames into the live config (dirs / `loadParts` / `afterInit`) — isolation is by **random username**, not fresh `dataDir`. Import `node/boot.mjs` before registering `Deno.test` (`sanitizeOps`/`sanitizeResources` default false).

## Fixture probes

Share state via module-level singletons under `…/test/fixtures/probes/*.mjs` (e.g. `onMessageProbe`). Do not use `globalThis.__fount*`. Placeholder origins must not be production endpoints (`http://live-bridge.test`, not `127.0.0.1:8931`).

## Defaults / imports

- Missing-file `loadX` defaults must be freshly created (`structuredClone` / new object) — never `{ ...DEFAULT }` sharing nested arrays across entities.
- From `shells/social/src/endpoints/` to chat backend use `../../../chat/...` (`../../../../chat` resolves to `parts/chat` and breaks `Load`).
