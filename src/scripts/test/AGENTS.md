---
description: fount test framework, taxonomy, live probes, debugging hung runs, and operator diagnostics
globs: src/scripts/test/**, **/test/live/**, **/test/manifest.json
alwaysApply: false
---

# Test Framework & Debugging Guide

## Architecture

- **Entry**: `fount test` -> `src/scripts/test/runner/index.mjs` -> per-manifest `test/manifest.json` -> Deno pure / Deno integration / live drivers.
- **CLI groups**: `manifest` or `manifest:suite1,suite2` (space-separated). PowerShell splits commas in `:suite` args into separate argv tokens; parser re-merges trailing tokens into the current group. Report replay commands use the same colon syntax in a single line with `--gen-report`.
- **`--continue`**: reads `data/test/report/report.json` pending slots, runs only those suites, merges results back into the in-progress report (survives kill/reboot).
- **Duration style**: in test/framework code, prefer `ms('30s')` / `ms('5m')` / `ms('1h')` from `src/scripts/ms.mjs` for named timeouts, `waitMs`/`ttlMs`, and long `sleep()` calls; keep raw numbers for sub-second polling ticks and fake timestamps.
- **Live driver**: `src/scripts/test/live/runner.mjs` spawns ephemeral fount nodes, injects `FOUNT_TEST_NODE_*_BASE_URL/KEY/DATA` env, runs suite via `deno run -c deno.json`, tears down after.
- **Chat live suites**: `src/public/parts/shells/chat/test/live/run.mjs`; `denoLiveRun()` in `src/scripts/test/live/deno_run.mjs` builds argv.
- **Shared libs**:
  - `src/scripts/test/live/http.mjs` - fetch, multipart, `PollUntil`/`sleep`, test PNG bytes
  - `src/scripts/test/live/singleNode/helpers.mjs` - `chatApi`, `testCase`, `allowNoise`
  - `src/scripts/test/live/federation/common.mjs` - multi-node env, `Api`/`Wait-FedConverged`, group setup/cleanup
  - `src/scripts/test/live/federation/cleanup.mjs` - pre/post fed suite group purge (invoked by `runner.mjs`)
  - `src/scripts/test/live/env.mjs` - `FOUNT_TEST_BASE_URL` / `FOUNT_API_KEY` helpers
  - `src/scripts/p2p/test/live/helpers.mjs` - shared `identity` / `createSignalPair` / `waitFor` for P2P live smoke tests

## Taxonomy

- **Manifest = domain**: `server`, `testkit`, `p2p`, `shells/chat`, `shells/social`.
- **`pure/`**: zero I/O; pure logic / in-memory reducers / formatters / hashing.
- **`integration/`**: single-process tests that touch filesystem, headless boot, module graph probing, or in-process part loading, but do not launch a real HTTP/WS node.
- **`live/`**: launches a real fount node and talks HTTP/WS.
- **`frontend/`**: Playwright browser suites; operationally live, kept separate because they use dedicated drivers and fixtures.
- **`sim/`**: P2P simulation harness suites.

## PowerShell banned for new tests

**All new HTTP/WebSocket live tests must be Deno `.mjs` via `denoLiveRun(path)`.** PS is banned: dynamic scoping bugs (scriptblock variable resolution against invoker's stack causes infinite recursion in wrapped helpers), cross-platform incompatibility, inability to import `fount/*` modules (crypto, dm intro, p2p helpers), and PS footguns (`"$uri?foo"` null-conditional, `$env:VAR?.Trim()` wildcard, hung-run requiring attach-to-`pwsh`).

**For `node-datachannel` / WebRTC live tests, isolate each `.test.mjs` in its own Deno child process.** On Windows + Deno 2.9.1, running multiple `node-datachannel` live files inside one `deno test` process can panic with `attempt to access Handle hosted by disposed Isolate`; use a small `run.mjs` launcher that shells out to `deno test <single-file>` per case.

**Do not hand-roll raw `RTCPeerConnection` offer/answer in P2P live smoke tests.** `backpressure_smoke.test.mjs` must build links via `createLink()` + `helpers.mjs#createSignalPair()` and read bulk channels through `link.channel('bulk')`; otherwise it races `trickleIceOff` / libdatachannel and flakes after `link_smoke` or heavy `p2p/sim` runs.

**`group_link_set_mock.test.mjs` needs both sides `start()`, bidirectional `getLink()`, and ~30s waits.** Single-sided dial + 10s timeout flakes under load even when transport is fine.

**If `shells/chat:fed_dm` goes silent for several minutes after other long fed suites, treat it as resource pressure first.** Rerun `fount test shells/chat:fed_dm` alone; do not assume a DM regression until an isolated run fails.

**If `node-datachannel` init fails with `prebuild-install ... EBUSY` on Windows, treat it as an environment file-lock issue first.** Stop other Deno / `fount test` jobs that may still hold `node_modules/.deno/node-datachannel/**/node_datachannel.node`, then retry; do not misclassify that as a sim/live logic regression.

**When a federated live test shows `federationEnabled=true` but `peers=0`, check runtime bootstrap before touching DAG logic.** The common regressions are: (1) the new discovery path stopped honoring `FOUNT_TEST_RELAY_URLS` / runtime `relayOverride`, so each node no longer shares the loopback relay; or (2) owner rooms never called `registry.ensureRuntime()` on startup, so the room exists but never advertises/listens until the first outbound dial.

**When `peers=1` but both sides stay at `members=1`, suspect pre-member bootstrap ACL, not transport.** The link is already up; the usual blocker is that group scope authorization still rejects bootstrap control-plane actions (`fed_join_snapshot_*`, `fed_tip_*`, bootstrap/discovery relay actions) before the remote member has fully materialized, causing a deadlock where transport is healthy but catchup can never complete.

Hand-rerun: `deno run --allow-all -c deno.json <probe.mjs>` with env from a prior `fount test` log, or `deno run ... src/public/parts/shells/chat/test/live/run.mjs --suite smoke_chat`.

## Diagnosing a hung live test

- **Logs**: `fount log` on ephemeral test nodes; runner streams probe stdout/stderr.
- **Hung Deno probe**: inspect the fetch poll loop - federation helpers use explicit `while` + `await probe()` (never nested scriptblock wrappers).
- **Stuck TCP**: `Get-NetTCPConnection -OwningProcess $pid` (Windows) shows which node/port an in-flight HTTP call targets.
