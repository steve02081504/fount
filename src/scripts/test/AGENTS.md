---
description: fount test framework — CLI, state DB, selection, dependencies, live driver, and operator diagnostics
globs: src/scripts/test/**, **/test/manifest.json
alwaysApply: false
---

# Test Framework Guide

Domain-specific traps (chat federation, P2P/WebRTC, etc.) belong in each part's own guide — not here.

## Architecture

- **Entry**: `fount test` → `cli.mjs` → `runner/index.mjs`.
- **i18n**: `fount/scripts/i18n/bare.mjs` only — never pull in the server module graph.
- **State DB**: `data/test/state/main.json` — per-suite status, fingerprint, baselines, log paths. `state/main.md` renders a dependency-tree mermaid.
- **Run report**: `data/test/report.md` + `report.json` — last run only. **Suite sum** = non-reused slot durations; **wall clock** = run span; **parallel rate** = suite sum / wall clock × 100% − 100% (≈0% serial, higher = more parallelism). Trigger reasons in `data/test/triggered-reasons.md`. Dead trigger globs (no repo file match) warn on console and appear in `report.md`. Wave/reason details: [continue-report.md](docs/continue-report.md).
- **Default loop** (bare `fount test`): imperfect wave (failed/noisy/blocked/missing + one-level dependents) → on failure exit 1; on all-green → outdated wave (verdict `unknown`) → back to imperfect check; both empty → exit 0. Never full-repo scan (use `--all`). Failure is not auto-retried within the same invocation.
- **Failure-first inside suite**: `FOUNT_TEST_FIRST` = last `failedFiles`; run those first; if any still fail after the failure group finishes, exit without running the rest. Failure group all green → run remaining. Protocol: [core/protocol.mjs](core/protocol.mjs).
- **Subtests**: suite may register `subtests: [{ name, triggers|trigger, spec? }]` in manifest. Suite-level `trigger` = shared infra (hit → all subtests stale); each subtest has its own triggers (prefer inline `triggers` globs when only used once — no single-use triggerSet) + state fingerprint. Selector: `manifest:suite:subtest` / `manifest/suite/subtest`. Runtime filter: `FOUNT_TEST_SUBTESTS`. Plan slots stay suite-scoped but carry `subtestsToRun`.
- **File filter (serial suites)**: pure/integration via `serial.mjs` have no registered `subtests`. CLI third segment is a `*.test.mjs` **stem** (`shells/chat:pure:channel_archive` → `FOUNT_TEST_ONLY` that file). Unknown stem / unsupported suite → exit 2 (do not silently run the whole suite). Explicit CLI filter always forces a real run even if the suite is green.
- **Subtest timing model**: suite wall ≈ `baselineOverheadMs` + Σ(selected subtest `durationMs`). Playwright runners write per-spec ms to `FOUNT_TEST_TIMINGS_OUT`; orchestrator maps them to subtest names. Partial runs update overhead + selected subtest baselines only — **not** suite `baselineDurationMs` (full-run only). ETA / duration watchdog use `expectedRunDurationMs(suite, entry, subtestsToRun)`. Mem/CPU baselines stay suite-scoped (serial subtests; peak ≈ suite peak).
- **`--no-parallel`**: serial suite dispatch **and** inner file concurrency = 1 (`FOUNT_TEST_BUDGET_CORES=1` via `serial.mjs`). **Default for agents on Windows** and for local verification. Parallel `deno run`/`deno test` children against the same cwd with `nodeModulesDir: auto` + `lock: false` can corrupt `node_modules` (missing entrypoints, junction errors, native addon `EBUSY`) — [denoland/deno#35804](https://github.com/denoland/deno/issues/35804). See [resource-scheduling.md](docs/resource-scheduling.md).
- **Verdict + plan**: `core/verdict.mjs` builds one freshness verdict per suite (`green`/`noisy`/`red`/`unknown`), aggregating subtests when present; `core/plan.mjs` turns goals + verdicts into `reuse`/`run`/`blocked` slots with provenance + `subtestsToRun`. **`reuse`** when verdict is `green`/`noisy`/`red` and content is still fresh (and no subtests need run); on reuse, `refreshEntryFingerprint` updates fingerprints. Goal red/noisy/unknown always **run**. **`--force`** forces goal suites to run. A failed transitive dep with unchanged triggers stays `reuse(red)` and still **blocks** the goal.
- **`dependsOn`**: runtime gate via plan — downstream `blocked(by)` when a dependency's plan action is not green-capable. Selector: `manifest:suite` / `manifest:suite:subtest` or `/` forms (`core/selector.mjs`, longest manifest prefix).
- **Suite selectors** (`manifest:suite`): a selector that is itself a full suite id/name is exact — `shells/chat:fed_emoji` runs only `fed_emoji`, never `fed_emoji_nearcache`/`_nonmember`. Prefix expansion (`fed` → `fed_*`) only kicks in when no suite is named exactly that. Explicit `*`/`?` always globs. (Dependencies still pull in via `dependsOn`, that's not prefix matching.)
- **Ordering & dispatch**: manifest list order, `report.md` slot order, and serial-vs-parallel dispatch share the same topo + tie-break rules. Details: [resource-scheduling.md](docs/resource-scheduling.md).
- **Live driver**: `live/runner.mjs` — ephemeral nodes, `FOUNT_TEST_NODE_*` env, teardown after.

## Framework libs

| Module | Role |
| --- | --- |
| `live/deno_run.mjs` | `denoLiveRun()` argv builder |
| `live/http.mjs` | fetch, multipart, `PollUntil` / `sleep` |
| `live/env.mjs` | `FOUNT_TEST_BASE_URL` / `FOUNT_API_KEY` |
| `core/state.mjs` | state DB read/write/upsert, fingerprint refresh |
| `core/verdict.mjs` | one-pass suite verdicts (green/noisy/red/unknown) |
| `core/trigger_audit.mjs` | dead trigger glob audit (no repo file match → warn + report) |
| `core/plan.mjs` | goals + verdicts → reuse/run/blocked plan |
| `core/selector.mjs` | `manifest:suite` / `manifest/suite` resolution |
| `core/dependencies.mjs` | `dependsOn` resolve, topo sort, imperfect one-level dependents |
| `core/estimate.mjs` | ETA / `expectedRunDurationMs` (subtest-aware) |
| `core/deno_panic.mjs` | detect `Deno has panicked` in suite output → gh auto-issue |
| `runner/suite_run.mjs` | `buildSuiteInvocation` / `runSuite` |
| `runner/continue_reason.mjs` | wave/slot reasons → report |

## Taxonomy

| Kind | Meaning |
| --- | --- |
| `pure/` | Zero I/O |
| `integration/` | Single-process; no real HTTP/WS node (exception: `launchNode` HTTP route suites — see below) |
| `live/` | Real fount node + HTTP/WS |
| `frontend/` | Playwright (`playwright/`) |
| `sim/` | In-process simulation harness |

**Frontend browser diagnostics** (`playwright/browser_diagnostics.mjs`, wired in `createFountFixtures`): every page collects `response ≥ 400` and `requestfailed`, aggregates by `kind/method/status/url/error`, and flushes one `[browser:network] <JSON>` line per bucket after the test. Suite stays exit 0 if assertions pass, but `detectNoiseHits` treats `browser_network` as noise → state `noisy` → imperfect wave. Uncaught `pageerror` still hard-fails the Playwright case (`failed`). Do not re-attach these listeners in shell-local fixtures.

**pure/ boundary**: tested modules must not statically `import` `src/server/**` (pulls in the P2P/native graph; Deno child-process exit can hang on Windows). When server access is required, use dynamic import or promote to an `integration/` suite.

Manifest id = domain (`server`, `testkit`, `p2p`, `shells/chat`, …).

## Manifest fields

- **`triggers`**: diff selection — glob match on changed files. Default ignores docs/metadata; override via **`triggerFilter`**: [trigger-filter.md](docs/trigger-filter.md). **Watch scope** = code this suite actually runs against — not shared runners (`serial.mjs`/`boot.mjs` only on `pure`/`integration`/`testkit`; live suites use but do not watch them). No `federation/**` on every fed feature suite — only `fed_core`. Cross-part deps: narrow paths; for P2P package changes watch `deno.json` or `src/server/p2p_server/**`.
- **`dependsOn`**: plan pulls transitive deps; downstream `blocked` when upstream is not green-capable in the plan. **Imperfect wave**: `failed`/`noisy`/`blocked`/`missing_state_record` + one-level `expandImperfectDependents` — **not** stale `unknown` (that is the outdated wave). Fresh upstream `reuse` does not block downstream.
- **`subtests`**: optional per-suite list; each entry `{ name, triggers|trigger, spec? }` (`spec` defaults to `${name}.spec.mjs`). Prefer inline `triggers` globs for per-subtest paths; keep shared sets (e.g. `frontendShared`) at suite level. Editing `feed.mjs` only expires `frontend:feed`. **When splitting a frontend god-file into modules, update that subtest's `triggers` to the new entrypoints** — otherwise suite-level `public/**` keeps the whole suite stale while the subtest fingerprint still only watches the old paths.
- **Live layering** (avoid re-probing the same failure in every suite): `server:live` → `smoke_chat` → `e2e_single` → `e2e_single_extended` / `frontend`; Social: `server:live` → `smoke_social` → `e2e_single` → `frontend` (`integration/posts_http` covers HTTP POST before live); WS chain `ws` → `ws_rpc` → `ws_stream` (`av_relay` after `ws`); federation `fed_core` → feature suites; cross-shell fed probes depend on `shells/chat:fed_core` + `fed_emoji` + `smoke_social`, not full social e2e.
- **Browser scripts**: paths under `/scripts/*` map to `src/public/pages/scripts/` (e.g. `/scripts/test/ready_gate.mjs` → `public/pages/scripts/test/ready_gate.mjs`); Chat/Social P2P and mention/avatar primitives live in `shells/chat/public/shared/` or `/parts/shells:chat/shared/*`. Do not import `/scripts/test/*` from Deno-only trees.
- **`heavy`**: machine-exclusive scheduling — [resource-scheduling.md](docs/resource-scheduling.md).
- **`resources`**: optional `{ "memMb", "cpuPct" }`; omitted fields use heuristics + learned baselines.

## New live tests

- Deno `.mjs` via `denoLiveRun(path)` or a part-local `run.mjs` — no PowerShell probes.
- **WebSocket frame wait**: `live/wsHarness.mjs` — `waitForWsFrame({ url, types, trigger, timeoutMs })`: optionally call `trigger()` to fire an HTTP action after connect, returns `{ ok: true }` on first matching frame type, `{ ok: false }` on timeout/error. Shared by Chat and Social live WS probes — do not write custom polling loops.
- **Permission flags invariant**: every deno `run`/`test`/`install` invocation carries both `--allow-scripts --allow-all`, in that order. `--allow-scripts` builds native addons (argon2, node-datachannel, etc.) via npm postinstall; omitting it leaves `build/Release/*.node` empty. **Sole exception**: `deno cache` takes `--allow-scripts` alone (no `--allow-all` flag).
- Native-addon / WebRTC: one `.test.mjs` per Deno child when the addon panics under reuse (common on Windows). Federation live requires a `node-datachannel` native build; `--allow-scripts` handles this automatically on first run — no manual install after clone.
- Single-node: `{ p2p: false, minP2pNode: true }`. P2P signaling: [p2p/docs/signaling.md](../p2p/docs/signaling.md).
- Federation live probes: reuse `InitializeOpenGroupJoin` / `InitializeOpenGroupJoinMulti` from `live/federation/common.mjs` (they bundle `WarmupFedNodeLinks` → `rebind` → members gate → re-invite fallback). A hand-rolled bare join (create → invite → join) with no warmup/rebind will hang at `members>=2`. A `members>=2` hang is usually a real link/handshake or ICE bug — inspect handshake/ICE logs before rerunning (signaling traps: [p2p/docs/signaling.md](../p2p/docs/signaling.md)).
- Federation convergence assertions should prefer semantic helpers (`TestFedHasMessage`, `TestFedHasReaction`, etc.) over raw `GET /events?limit=...` scans: event streams are paged/windowed and can miss the target row even when ingestion succeeded, causing false negatives.
- **HTTP route integration (`launchNode`)**: spawn an isolated node (`fount/scripts/test/node/launch.mjs`), seed fixtures via env scenario + bootstrap worker (e.g. `shells/chat` `routes_http.test.mjs` + `FOUNT_TEST_HTTP_SCENARIO` → `routes_http_bootstrap.mjs`), then `fetch` against `http://127.0.0.1:{port}/api/parts/shells:chat/...?fount-apikey=…`.
- **Chat message content after `postChannelMessage`**: returned `event.content` is often CKG-encrypted (`scheme: 'ckg'`); assert extras (`locale` / `content_warning`) via `readChannelMessagesForUser` decrypted rows, not the wire event.
- **`message_edit` not in `events.jsonl`**: `foldDagProcessEvents` unconditionally folds `message_edit` during checkpoint rebuild (into channel sidecar + materialized overlay). Integration tests asserting edit results should use `readChannelMessagesForUser` + `mergeChannelMessagesForDisplay`, not scan `events.jsonl` for `type === 'message_edit'`.
- **In-process integration (`createTestServerBoot` / `startTestServer`)**: same-process server, **one `init()` per Deno child**. First call boots (`resetData` once) under `ensureSharedTestDataDir()`; later calls **incrementally register** the new username into the live `config.data.users` (plus dirs / `loadParts` / `afterInit`) instead of swapping `data_path` — otherwise fire-and-forget char reply chains from a previous test explode on missing `user.locales` / `Not a member`. Isolation is by **random username**, not by fresh dataDir. `node/boot.mjs` patches `Deno.test` on import to default `sanitizeOps`/`sanitizeResources: false`, otherwise leftover timers/handles flip a green file to exit 1. Prefer importing harness/`boot.mjs` before any `Deno.test(...)` registration.
- **Fixture probes (shared in-process state)**: char/world/persona fixtures are copied to temp `users/…` but must be imported as **module-level singletons** via `fount/public/parts/shells/…/test/fixtures/probes/*.mjs` (e.g. `onMessageProbe` / `groupEventProbe` / `socialOnMessageProbe`) so tests and fixtures share the same instance. **Do not use** `globalThis.__fount*`. Metadata placeholder origins must not be production endpoints (e.g. live `bridgeOrigin` uses `http://live-bridge.test`, not `127.0.0.1:8931`).
- **Disposable data paths only**: tests must never point `dataDir`/`dataPath` at the repo's real `data/` root (or any other production state). `assertDisposableDataPath` (`core/disposable_path.mjs`) throws unless the path resolves under OS `tmpdir()` or `{repo}/data/test`; wired into `startTestServer`, `bootInProcess({ resetData: true })`, and `stopNode` cleanup. 2026-07-13 incident: a test set `dataDir = join(fountRoot, 'data')` and `resetData` wiped the operator's whole tree.
- **`--no-parallel` + `serial.mjs`**: orchestrator sets `FOUNT_TEST_BUDGET_CORES=1` so inner file concurrency is 1. Each finished file prints `[serial] ok …` so idle watchdog does not kill long all-silent suites. If you see `Blocking waiting for file lock on node_modules directory` or flaky `ERR_MODULE_NOT_FOUND` under parallel runs, rerun with `--no-parallel` ([denoland/deno#35804](https://github.com/denoland/deno/issues/35804)). Long serial runs can still corrupt mid-suite: `deno cache --reload` the missing package, then re-run **only** the failed file via `serial.mjs` — do not treat as product regression without a second green pass.
- **Agent entityHash in tests**: no path-derived hashes (old `agentEntityHash(node, 'chars/X')` is removed). Use `ensureLocalAgentEntityHash` / `ensureAgentEntityIdentity` when a username is available; construct synthetic identities with `keyPairFromSeed` + `entityHashFromRecoveryPubKeyHex`. Social inbound for remote owners triggers `maintainSocialTimeline` → `rebuildSignedTimelineSnapshot`; the latter must tolerate no local identity (do not let `getEntitySecretKey` throw through).
- **Social → chat relative imports**: when referencing the chat backend from `shells/social/src/endpoints/`, use `../../../chat/...` (`../../../../chat` resolves to `parts/chat` and breaks `Load`).
- **Per-entity default structures**: if `loadX` returns `{ ...DEFAULT }` (shallow copy) when a file is missing, nested arrays/objects are shared across callers — causing "entity A writes → entity B reads stale A data before any flush". Defaults must always be freshly created (e.g. `{ folders: {}, unfiled: [] }` / `structuredClone`); integration isolation tests (`entity_parity` / `entity_private_state`) will catch this immediately.

## Operator tools

- **Hung run**: `data/test/state/logs/`; rerun `deno run --allow-scripts --allow-all -c deno.json <probe.mjs>` with env from the log.
- **OOM / heap**: [heap-snapshots.md](docs/heap-snapshots.md).
- **Deno panic auto-report** (`core/deno_panic.mjs`): on `Deno has panicked` in suite output, files a GitHub issue on `denoland/deno` if `gh` is installed; dedup in `data/test/deno_panics.json`. `parseDenoPanic` folds multiline messages until `stack backtrace:`; `fitGhIssueTitle` fits GitHub's 256-char title cap (shrink `(xxx)` in summary, then truncate). All test child spawns use `childEnv()` / explicit `RUST_BACKTRACE=full`. Override target repo via `FOUNT_DENO_PANIC_REPO`. `testkit` suites are excluded so fixtures don't fire real reports.
- **Selftests**: `selftest/` — `fount test testkit`. One suite per `*.test.mjs` (suite name = file basename). **Fixtures**: shared builders in `selftest/fixtures.mjs` — `makeSuite(manifestId, name, { dependsOn, triggers, ...rest })` and `makeStateEntry(overrides)`; reuse them, never re-declare per-file stubs. **Lint**: `jsdoc/require-jsdoc` demands a JSDoc block on every function with `@param` types + `@returns`; `import/order` requires a blank line between `../` and `./` groups, alphabetical within — fix import order by hand (eslint 10 crashes on fixable violations). Keep manifest id `testkit` — the panic auto-report skip keys on it.
- **Naming**: prefer readable identifiers in framework code — `context` not `ctx`, `core/dependencies.mjs` not `deps.mjs`, `dependencyEdges` not `deps`. Suite / file / fixture / `Deno.test` names and comments must use domain semantics — never planning milestone codes (`M1`/`M7a`/`G4`, etc.); milestones belong only in design docs.
