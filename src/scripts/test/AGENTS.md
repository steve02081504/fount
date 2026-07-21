---
description: fount test framework — CLI, state DB, selection, dependencies, live driver, and operator diagnostics
globs: src/scripts/test/**, **/test/manifest.json
alwaysApply: false
---

# Test Framework Guide

Domain harness (federation join, CKG asserts, `launchNode`, fixtures, disposable paths): [docs/domain-harness.md](docs/domain-harness.md).

## Architecture

- **Entry**: `fount test` → `cli.mjs` → `runner/index.mjs`.
- **i18n**: `fount/scripts/i18n/bare.mjs` only — never pull in the server module graph.
- **State DB**: `data/test/state/main.json` — per-suite status, fingerprint, baselines, log paths. `state/main.md` renders a dependency-tree mermaid. **CI** caches `data/test` as `fount-test-data` across pushes (strips logs/tmp/playwright/heapsnapshots/report). **Fingerprint timing**: `commitHash` / `uncommittedHash` / `triggerHash` update only after that suite's plan slot finishes (`upsertSuiteRun` on run, `refreshEntryFingerprint` on reuse) — never batch-align at wave start (Ctrl+C must not mark unrun suites current).
- **Run report**: `data/test/report.md` + `report.json` — last run only. Trigger reasons: `data/test/triggered-reasons.md`. Details: [continue-report.md](docs/continue-report.md).
- **Default loop** (bare `fount test`): imperfect wave (`failed`/`blocked`/missing/fresh `noisy` + one-level dependents of hard fails only — noisy does not drag dependents) → `failed`/`blocked`/`noisy`/pending exits 1; else outdated wave (`unknown`) → back to imperfect; both empty → 0. Never full-repo unless `--all`. No auto-retry of failures/noise within one invocation (noisy is re-run once per wave, then exit 1 if still noisy). Report lists noisy separately with log paths.
- **Suite keys**: state / report / labels use `manifest:suite` (`shells/chat:frontend`). CLI still accepts legacy `manifest/suite`. `readState` migrates old slash keys on disk.
- **Failure-first inside suite**: `FOUNT_TEST_FIRST` = last `failedFiles`; those run first; any still failing → exit without the rest.
- **Subtests**: `subtests: [{ name, triggers|trigger, spec? }]`. Selector: `manifest:suite:subtest`. Runtime filter: `FOUNT_TEST_SUBTESTS`. Suite-level `noisy` only marks subtests when **no** file failed.
- **File filter (serial suites)**: third CLI segment is a `*.test.mjs` stem → `FOUNT_TEST_ONLY`. Unknown stem → exit 2.
- **`--no-parallel`**: serial dispatch **and** inner concurrency = 1. **Default for agents on Windows** / local verification ([denoland/deno#35804](https://github.com/denoland/deno/issues/35804)). See [resource-scheduling.md](docs/resource-scheduling.md).
- **`dependsOn` optimistic overlap**: while a **hard-running** dep suite is in-flight, direct dependents may `tryAcquire` spare budget (not stacked on speculative suites; promoted to hard anchor once deps pass). Spare crumbs are used even if other hard suites are already running/queued. Dep failure aborts the speculative process early; discard keeps logs as `blocked`. See [resource-scheduling.md](docs/resource-scheduling.md).
- **Verdict + plan**: `core/verdict.mjs` → `green`/`noisy`/`red`/`unknown`; `core/plan.mjs` → `reuse`/`run`/`blocked` + `subtestsToRun`. Fresh green/noisy/red → `reuse`. Goal red/noisy/unknown always **run**. Suite-level `failed` (e.g. watchdog) with all subtests still green/noisy elevates to **red** and full re-run. `--force` forces goals. Failed transitive dep with unchanged triggers stays `reuse(red)` and still **blocks**.
- **`dependsOn`**: downstream `blocked(by)` when a dependency's plan action is not green-capable. Same-wave: dep failure also blocks dependents (no commit of speculative/post-fail runs). Selector: `manifest:suite` / `manifest:suite:subtest` (`core/selector.mjs`, longest manifest prefix).
- **Suite selectors**: exact suite name wins (`shells/chat:fed_emoji` ≠ `fed_emoji_*`). Prefix expansion only when no exact match. Explicit `*`/`?` always globs.
- **Live driver**: `live/runner.mjs` — ephemeral nodes, `FOUNT_TEST_NODE_*` env, teardown after. Launch/ping failures **return exit 1**. Non-worker `env.mjs` sets `process.exitCode = 1` on `unhandledRejection`/`uncaughtException` — otherwise a logged rejection exits 0 (**passed with noise**).

## Framework libs

| Module | Role |
| --- | --- |
| `live/deno_run.mjs` | `denoLiveRun()` argv builder |
| `live/http.mjs` | fetch, multipart, `okStatus` / `pollUntil` (sec, soft) / `waitUntil` (ms, throws) / `sleep` |
| `live/env.mjs` | `FOUNT_TEST_BASE_URL` / `FOUNT_API_KEY` |
| `live/wsHarness.mjs` | `createLiveShellHttp` / `finishLiveWs` / `waitForWsFrame` — live WS probes |
| `live/singleNode/helpers.mjs` | `createSingleNodeProbe` / `createShellProbe` (wraps `createLiveShellHttp`) + `testCase` / summary |
| `playwright/config.mjs` | `createPlaywrightConfig` / `createPhasedPlaywrightConfig` |
| `core/state.mjs` | state DB read/write/upsert, fingerprint refresh |
| `core/verdict.mjs` | suite verdicts |
| `core/plan.mjs` | goals + verdicts → plan |
| `core/selector.mjs` | selector resolution |
| `core/dependencies.mjs` | `dependsOn`, topo, imperfect dependents |
| `core/estimate.mjs` | ETA / `expectedRunDurationMs` |
| `core/deno_panic.mjs` | `Deno has panicked` → gh auto-issue |
| `core/disposable_path.mjs` | refuse production `data/` as test `dataDir` |
| `runner/suite_run.mjs` | `buildSuiteInvocation` / `runSuite` |

## Taxonomy

| Kind | Meaning |
| --- | --- |
| `pure/` | Zero I/O |
| `integration/` | Single-process; no real HTTP/WS node (exception: `launchNode` HTTP suites) |
| `live/` | Real fount node + HTTP/WS |
| `frontend/` | Playwright (`playwright/`) |
| `sim/` | In-process simulation harness |

**Frontend** (`playwright/`): fixtures, browser binary, network noise — [playwright.md](docs/playwright.md).

**pure/ boundary**: tested modules must not statically `import` `src/server/**` (P2P/native graph; Windows Deno child exit can hang). Use dynamic import or promote to `integration/`.

Manifest id = domain (`server`, `testkit`, `p2p`, `shells/chat`, …).

## Manifest fields

- **`triggers`**: glob match on changed files. Default ignores docs/metadata; override via **`triggerFilter`**: [trigger-filter.md](docs/trigger-filter.md). Watch scope = code the suite runs — not shared runners (`serial.mjs`/`boot.mjs` only on `pure`/`integration`/`testkit`). Federation: only `fed_core` watches `federation/**`.
- **`dependsOn`**: plan pulls transitive deps. **Imperfect wave** = `failed`/`blocked`/missing/fresh `noisy` + one-level dependents of hard fails (noisy itself is re-run but does not expand dependents); stale `unknown` → outdated wave.
- **`subtests`**: `{ name, triggers|trigger, spec? }`. When splitting a frontend god-file, update that subtest's `triggers`.
- **Live layering**: Chat `server:live` → `smoke_chat` → `e2e_single` → `e2e_single_extended` / `frontend`; Social similar via `smoke_social`; WS `ws` → `ws_rpc` → `ws_stream`; federation `fed_core` → feature suites. Cross-shell fed probes depend on `fed_core` + `fed_emoji` + `smoke_social`, not full social e2e. **Triggers follow the same gate**: `shellBackend` only on `pure` / `integration` / `smoke_*`; deeper live suites watch infra + their own script (like fed suites).
- **Browser scripts**: `/scripts/*` → `src/public/pages/scripts/` (browser-only absolute URLs). **Shared cross-runtime** (Deno `pure/` + browser): `shells/*/public/shared/`; browser ESM may use `/parts/shells:…/shared/*` when the file exists under that shell's `public/`. `shellLoadProbe.mjs` (`probeShellPart`) permits resolvable `/scripts/` and `/parts/…/shared/` targets; flags missing ones as `publicMissing` and backend↔`public/src` / `src/scripts` crossings as `crossBoundary`. Do not import `/scripts/test/*` from Deno trees; pure tests reach shared code via relative paths, not `/parts/` URL specifiers. **Trap**: relative climbs from part `public/` to `pages/scripts` resolve in the browser as `/pages/scripts/…` (404); browser-only modules use absolute `/scripts/…`. Split pure → `shared/`, UI → `public/src/`.
- **`heavy`** / **`resources`**: [resource-scheduling.md](docs/resource-scheduling.md). Invariant: waiters + idle machine → admit ≥1 (budget packs extras, never leaves the queue empty).

## Writing new tests

- Deno `.mjs` via `denoLiveRun(path)` or part-local `run.mjs` — no PowerShell probes.
- **Live WS probes**: `createLiveShellHttp({ shell? })` from `wsHarness.mjs` — do not re-declare local HTTP helpers. Dual-shell: call twice. End with `finishLiveWs` / `failLiveWsPrecondition`; frames via `waitForWsFrame`. Keep `liveWsBaseUrl()` for WS URLs.
- **Polling**: `pollUntil` (live/fed, seconds, soft) / `waitUntil` (integration, ms, throws) — definitions only in `live/http.mjs`. Chat harness re-exports `waitUntil`; fed may also import `pollUntil` from `federation/common.mjs`.
- **Chat / Social fixtures**: `createCharBoot` / `seedCharFixture` / `waitUntil` from `shells/chat/test/harness.mjs`; Social agents: `seedAgentChar` in `shells/social/test/harness.mjs`.
- Every `deno run`/`test`/`install` carries `--allow-scripts --allow-all` (in that order). Sole exception: `deno cache` takes `--allow-scripts` alone.
- Native-addon / WebRTC: one `.test.mjs` per Deno child when the addon panics under reuse. Federation live needs `node-datachannel`.
- Single-node: `{ p2p: false, minP2pNode: true }`. Signaling: [p2p/docs/signaling.md](../p2p/docs/signaling.md). Domain traps: [domain-harness.md](docs/domain-harness.md).
- **`--no-parallel` + `serial.mjs`**: prints `[serial] ok …` so idle watchdog stays alive. On `node_modules` lock / flaky `ERR_MODULE_NOT_FOUND`, rerun `--no-parallel`; mid-suite corruption → `deno cache --reload` then re-run **only** the failed file.
- **Teardown crashes after green**: Windows napi exit codes and Linux `SIGSEGV`/`SIGABRT`/`SIGBUS`/`SIGILL` with `N passed | 0 failed` → `[serial] ok … (deno teardown crash after pass)`, not suite red.
- **`launchNode` port races**: hold→release→spawn TOCTOU under parallel suites → `EADDRINUSE`; mitigated by cross-process port leases (`core/port_lease.mjs`, kept until child ready) plus up to 5 re-holds. Startup stderr is buffered until ready so a recovered race does not mark the suite `noisy`. `serial.mjs` sets `DENO_JOBS=1` so within-file `Deno.test` cannot stack multiple nodes.

## Operator tools

- **Hung run**: `data/test/state/logs/`; rerun `deno run --allow-scripts --allow-all -c deno.json <probe.mjs>` with env from the log.
- **OOM / heap**: [heap-snapshots.md](docs/heap-snapshots.md).
- **Deno panic auto-report**: `core/deno_panic.mjs` → GitHub issue on `denoland/deno` (if `gh` + auth); dedup `data/test/deno_panics.json`. Override via `FOUNT_DENO_PANIC_REPO`. `testkit` excluded.
- **Selftests**: `fount test testkit`. Fixtures: `selftest/fixtures.mjs` (`makeSuite` / `makeStateEntry`). Keep manifest id `testkit`.
- **Naming**: readable identifiers (`context` not `ctx`). Suite/file/`Deno.test` names use domain semantics — never planning milestone codes.
