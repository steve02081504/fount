---
description: fount test framework — CLI, state DB, selection, dependencies, live driver, and operator diagnostics. Pull when changing the runner or diagnosing fount test behavior — not for ordinary product-suite cases under an existing manifest.
globs: src/scripts/test/**
alwaysApply: false
---

# Test Framework Guide

| Topic | Doc |
| --- | --- |
| Domain harness / federation / `launchNode` | [docs/domain-harness.md](docs/domain-harness.md) |
| Plan / verdict / continue reasons / CI cache | [docs/continue-report.md](docs/continue-report.md) |
| Kernel / display / `--watch` | [docs/kernel.md](docs/kernel.md) |
| Suite packing / optimistic overlap / module-check mutex | [docs/resource-scheduling.md](docs/resource-scheduling.md) |
| Host keep-awake / sleep interrupts | [docs/host-keep-awake.md](docs/host-keep-awake.md) |
| Playwright fixtures / CDN / diagnostics | [docs/playwright.md](docs/playwright.md) |
| Fixture mocks (ImportHandlers / AI prompt cache) | [docs/fixtures-mocks.md](docs/fixtures-mocks.md) |
| Upstream blockers (do not silence) | [docs/upstream-blockers.md](docs/upstream-blockers.md) |
| OOM / heap | [docs/heap-snapshots.md](docs/heap-snapshots.md) |
| Trigger filter | [docs/trigger-filter.md](docs/trigger-filter.md) |
| Concurrency / perf / output-noise diagnosis | [../../../docs/issues/fount-test-concurrency-performance.md](../../../docs/issues/fount-test-concurrency-performance.md) |

## Architecture

- **Entry**: `fount test` → `cli.mjs` ensures a detached kernel then `display/` paints. `--watch` is a flag, not a selector. `--update-estimates` rewrites manifests and skips the kernel. Internals: [kernel.md](docs/kernel.md). Overview/multi print failed/noisy suite tails once at `job-done` (CI last-lines); stream mode already live-prints.
- **Output modes**: `human` (TTY dashboard) / `plain` / `json` (NDJSON), via `FOUNT_TEST_OUTPUT` or `--output`/`--json`; non-TTY defaults to `plain`. `plain`/`json` drop the schedule ETA/reason stream (the `总剩余：0 个未知时长` flood) and instead emit discrete events (accepted / suite start–end / job-wait / job-done) plus a 30s heartbeat. `display/output.mjs`; diagnosis: [../../../docs/issues/fount-test-concurrency-performance.md](../../../docs/issues/fount-test-concurrency-performance.md).
- **Deno update**: kernel-owned (the path CLI no longer upgrades per invocation) via `kernel/deno_update.mjs` — on kernel startup and when the run queue drains. Throttled to once per `FOUNT_TEST_DENO_UPGRADE_INTERVAL` (default 1h) by `data/installer/deno_upgraded.test`; a successful upgrade restarts only the kernel. `FOUNT_TEST_SKIP_DENO_UPGRADE=1` / `FOUNT_TEST_DENO_UPGRADE_INTERVAL` are read by the **kernel process**, so a value set on a `fount test` invocation never reaches an already-running detached kernel — use `fount test --kernel reboot` to apply it. A crash/kill mid-upgrade leaves `data/installer/deno-update.lock`; locks older than `STALE_LOCK_MS` (15m) are reclaimed automatically (selftest `selftest/deno_update.test.mjs`). CI installs its own pinned deno.
- **CLI `--help`**: `fountConsole.test.help` is a usage tutorial (invocation, selectors, flags, examples). Kernel bind, state paths, manifest fields, and scheduler internals belong in this guide / `docs/` — not `--help`.
- **`--update-estimates`**: rewrite suite/subtest `expected` from state EMA baselines (`baselineDurationMs` / subtest `durationMs`); skip the kernel; selectors narrow the set. Does not run tests. Combine with `--watch` / `--all` / `--force` / `--list` is an error.
- **`--list`**: print available suites (grouped by manifest, subtests indented, `expected` inline) and exit; skip the kernel. Selectors narrow the scope; a group that matches nothing exits 2. Combine with `--watch` / `--all` / `--force` / `--update-estimates` / `--kernel` is an error.
- **`--kernel shutdown|reboot`**: talk to the detached hub only — do not enqueue a job. `shutdown` POSTs `/shutdown` (no-op if already down); `reboot` shuts down then `ensure`s. Incompatible with other flags or selectors. A hung kernel: `fount test --kernel reboot`.
- **i18n**: `src/scripts/i18n/bare.mjs` only — never pull in the server module graph. Display/CLI sets `FOUNT_TEST` via `mark.mjs` (not `env.mjs`).
- **State DB**: `data/test/state/main.json` — per-suite status, fingerprint, baselines, log paths. `state/main.md` = dependency-tree mermaid. Fingerprints update only after that suite's plan slot finishes — never batch-align at wave start. Each run prunes orphan suite/subtest entries (and logs / Playwright dirs) missing from manifests.
- **Run report**: `data/test/report.md` + `report.json` — last job/wave only; empty default wave does not overwrite. Trigger reasons: `data/test/triggered-reasons.md`. Overview failure-log replay must write **synchronously** (`fs.writeSync(1, …)`) — `process.stdout.write` is async and its content is dropped on `process.exit` (only the virtual-console titles survive). Keep `appendBoundedTail` byte-bounded from the tail (binary-search the trim point).
- **Default plan** (bare `fount test`): one wave of imperfect ∪ outdated (each suite once). Imperfect queues first; a failure only blocks dependents. Exit non-zero if any suite is failed, blocked, noisy, or pending. Never full-repo unless `--all`. Details: [continue-report.md](docs/continue-report.md).
- **Selectors**: `manifest:suite` / `manifest:suite:subtest`. Exact name wins; prefix only when no exact match; `*`/`?` always globs. Third CLI segment on serial suites = `*.test.mjs` stem → `FOUNT_TEST_ONLY`.
- **`FOUNT_TEST_SUBTESTS`**: ambient env merges when CLI selects a suite without `:subtest` (CLI wins; not for dependsOn-only or wave goals without suiteSelectors).
- **`FOUNT_TEST_TRIGGERED_FILES`**: temp file of repo-relative paths that matched this wave's triggers (empty = unconstrained). Protocol: [protocol.mjs](core/protocol.mjs).
- **`--force`**: disable reuse of fresh green/noisy/red.
- **`--debug`**: single-step serial — each suite is one step, runs one at a time. After each step, and for a whole non-debug run on non-CI platforms, verifies no `ms-playwright` dir or `fount[-_]*` Temp residue; a leak sets exit code `3` (`core/cleanup_check.mjs`).
- **`ms-playwright` residue**: local frontend tests reuse the **system Chrome/Edge** (`resolveBrowserUseOptions`, located via `where_command`) — never run `playwright install` / `npx playwright install` locally. Any platform (non-CI) with a `ms-playwright` dir (`%LOCALAPPDATA%\ms-playwright` on Windows, `~/Library/Caches/ms-playwright` on macOS, `$XDG_CACHE_HOME|~/.cache/ms-playwright` elsewhere) reports a cleanup leak (exit 3); the check itself is covered by `selftest/cleanup_check.test.mjs`.
- **`dependsOn`**: downstream `blocked(by)` when a dependency is not green-capable. Optimistic overlap: [resource-scheduling.md](docs/resource-scheduling.md).
- **Live driver**: `live/runner.mjs` — ephemeral nodes, `FOUNT_TEST_NODE_*`, teardown after. Launch/ping failures → exit 1. Non-worker `env.mjs` sets `process.exitCode = 1` on unhandled rejection/exception — else a logged rejection exits 0 (**passed with noise**).
- **Test hub**: kernel binds Express+WS on `http://127.0.0.1:8903`, sets `FOUNT_TEST_HUB_URL`. Playwright injects `fount.test.hubUrl`. No hub → issue still open / store miss.
- **Libs**: import from `core/`, `hub/`, `kernel/`, `display/`, `live/`, `runner/`, `playwright/` — do not reimplement helpers.
- **Shell module graph**: `shellLoadProbe.mjs` — path resolve + **named export** check (`missingNamed`). Consumer suites that import another part's `public/shared` must trigger that glob.

## Taxonomy

| Kind | Meaning |
| --- | --- |
| `pure/` | Zero I/O |
| `integration/` | Single-process; no real HTTP/WS node (exception: `launchNode` HTTP suites) |
| `live/` | Real fount node + HTTP/WS |
| `frontend/` | Playwright — [playwright.md](docs/playwright.md) |
| `sim/` | In-process simulation harness |
| `checks/` | Repo static health — [checks/AGENTS.md](../checks/AGENTS.md) |

**pure/ boundary**: tested modules must not statically `import` `src/server/**` (P2P/native graph; Windows Deno child exit can hang). Use dynamic import or promote to `integration/`.

Manifest id = domain (`server`, `testkit`, `p2p`, `shells/chat`, …).

## Manifest fields

- **`triggers`**: glob via `npm:picomatch` (braces `{a,b}`, `dot: true`). Default ignores docs/metadata; override: [trigger-filter.md](docs/trigger-filter.md). Watch code the suite runs — not shared runners (`serial.mjs`/`boot.mjs` only on `pure`/`integration`/`testkit`; **`live` never watches `src/scripts/test/`**). Federation: only `fed_core` watches `federation/**`. Locale JSON only on `checks` — not Playwright / path. Multi-subtest `frontendShared` = harness, not `test/frontend/**`. **Dead triggers** (zero matches) → print + **exit 1** before any suite runs.
- **`dependsOn`**: plan pulls transitive deps. Default goals = imperfect (hard fails + one-level dependents, including fresh noisy) ∪ outdated (`unknown`). A failure only blocks dependents of that slot.
- **`subtests`**: `{ name, triggers|trigger, spec? }`. When splitting a frontend god-file, update that subtest's `triggers`. Runtime filter: `FOUNT_TEST_SUBTESTS`. Suite-level `noisy` only marks subtests when **no** file failed.
- **Live layering**: smoke → e2e gates; do not jump straight to full e2e. Details: [domain-harness.md](docs/domain-harness.md#live-layering).
- **Browser scripts**: `/scripts/*` → `src/public/pages/scripts/` (browser absolute URLs only). Cross-runtime pure+browser: `shells/*/public/shared/`. Prefer absolute `/scripts/…` over relative climbs from part `public/` (URL-resolved; can land wrong). Do not import `/scripts/test/*` from Deno; pure tests use relative paths, not `/parts/` URLs. Split: pure → `shared/`, UI → `public/src/`.
- **`skip_because`**: GitHub issue URL, `{ url, delay, as }`, or an array of those on suite or subtest. Still open / `gh` fail / closed but within `delay` → skip. `as` defaults to `pass` (count as green; leftover failed does not enter imperfect and does not block dependents). `as: "skip_tree"` also omits all transitive dependents (plan `skipped`, not blocked). Closed and `now >= closedAt + delay` (or closed with no `closedAt` when delay is set) → fail and list URLs to follow up. `delay` uses the same duration syntax as `expected` (`14d` / `4m12s`); a number is milliseconds; omit for 0. Same URL keeps the larger delay; `skip_tree` wins over `pass`. Never reuse via fingerprint.
- **`expected`**: duration seed (`16s` / `4m12s` / ms number) for ETA when state has no baseline. Suite = full-run wall; subtest = that spec. Refresh with `fount test --update-estimates`. Full-run ETA prefers measured `baselineDurationMs` over Σ-subtest (internally-parallel suites would double-count); only subtest subsets sum per-subtest.
- **Schedule / ETA**: non-monotonic — rebuilt from an ideal plan (`kernel/schedule.mjs`) on every scheduling change; `schedule-update` events carry a per-consumer projection, consumers paint on ~5% change. Incremental manifest `expected` auto-rewrite on drift (`expectedDriftToleranceMs`; disable `autoUpdateExpected: false`). Details: [resource-scheduling.md](docs/resource-scheduling.md), [kernel.md](docs/kernel.md).
- **`heavy`** / **`resources`**: [resource-scheduling.md](docs/resource-scheduling.md). Invariant: waiters + idle machine → admit ≥1.

## Writing new tests

- Deno `.mjs` via `denoLiveRun(path)` or part-local `run.mjs` — no PowerShell probes.
- **Browser-only code (DOM at load or render time) is tested in `test/frontend/*.spec.mjs` — never under Deno.** Every framework-spawned `deno test` child carries a no-DOM-shim preload (`deno/no_dom_shim.mjs`): the moment anything assigns `globalThis.document` / `window` / `HTMLElement` / … the child explodes with a pointer to this rule (covered by `selftest/no_dom_shim.test.mjs`). Do not reintroduce happy-dom / linkedom / jsdom bridges. For logic-level checks use the `modulePage` fixture (all shell frontend suites have it): a same-origin minimal routed page (document ready, i18n bundle applied, **no page-watch**), then `modulePage.run(fn, arg)` evaluates in-page `import('/scripts/…')` / `import('/parts/…')` and returns the value for Node-side asserts; cache expensive modules on the page-persistent `globalThis.__fountModulePage`. Worked example: `shells/chat/test/frontend/markdownSecureRender.spec.mjs`; docs: [playwright.md](docs/playwright.md#module-logic-page-modulepage). Pure helpers extracted from browser modules stay Deno-testable only while zero-DOM (see Taxonomy `pure/`).
- **Live WS probes**: `createLiveShellHttp({ shell? })` from `wsHarness.mjs` — end with `finishLiveWs` / `failLiveWsPrecondition`; frames via `waitForWsFrame`.
- **Polling**: `pollUntil` (live/fed, seconds, soft) / `waitUntil` (integration & selftest, ms, throws) — `core/wait.mjs`.
- **Chat / Social fixtures**: `createCharBoot` / `seedCharFixture` / `seedStubCharPart` / `waitUntil` from `shells/chat/test/harness.mjs`; Social agents: `seedAgentChar` / `seedStubAgent` in `shells/social/test/harness.mjs`. Char names via `resolveCharPartName` at write boundaries; Hub compares with exact `===`.
- **ImportHandlers / easynew / AI prompt-cache mocks**: [fixtures-mocks.md](docs/fixtures-mocks.md).
- **Platform bot / OnMessage contract**: [domain-harness.md](docs/domain-harness.md#platform-bot--onmessage-contract).
- Every `deno run`/`test`/`install` carries `--allow-scripts --allow-all` (in that order). Sole exception: `deno cache` takes `--allow-scripts` alone.
- **Manual single-file runs**: `deno test --allow-scripts --allow-all --no-check -c ./deno.json <path/to/file.test.mjs>` from the repo root. A bare `deno test` (no `-c`) fails type-check on `src/public/decl/*.ts` (needs the import map). **Do not trust `RUST_BACKTRACE`**: when it is set (`1`), deno appends a backtrace to every reported error whose tail can bottom out in `aws_lc_*_jent_entropy_switch_notime_impl` — that is diagnostic noise, not a native crash. Unset it (or `Remove-Item Env:RUST_BACKTRACE`) before diagnosing an "aws_lc crash".
- Single-node: `{ p2p: false, minP2pNode: true }`. Domain traps: [domain-harness.md](docs/domain-harness.md).
- **Teardown crashes after green**: Windows napi / Linux fatal signals with `N passed | 0 failed` → `[serial] ok … (deno teardown crash after pass)`, not suite red.

## Operator tools

Deep detail (performance bench, isolation runs, temp-dir internals): [docs/operator-tools.md](docs/operator-tools.md).

- **Hung run**: `data/test/state/logs/`; rerun with env from the log. Watchdogs / sleep retry / baselines: [host-keep-awake.md](docs/host-keep-awake.md), [resource-scheduling.md](docs/resource-scheduling.md). Opt out: `FOUNT_TEST_ALLOW_SLEEP=1`. Module-check mutex leaks (killed Deno child never POSTs ready) release the mutex immediately when the suite is kicked, or after the spawn→ready cap (`3m`) otherwise, and still fail the suite as missed-ready; they must not freeze later suites. Stuck detached kernel: `fount test --kernel shutdown` / `--kernel reboot`.
- **Temp leak check**: every kernel job baselines Temp at submit; only `fount[-_]*` entries **created during the job** and still present at its end are reported (exit 3). Keep scratch dirs under the `fount[-_]` prefix and **always clean them up in a `finally`** — there is no prefix-based escape hatch. Long-lived data dirs (`fount_node_*`, `fount_test_*`) register via `FOUNT_TEST_DATA_DIRS_OUT`; hand-built kernel jobs must pass `cleanupBaseline: findCleanupLeaks()`.
- **Temp origin marker**: `core/temp_origin.mjs` writes `origin.txt` (creator + timestamp) into every `fount[-_]*` scratch dir at creation — **read it first when investigating leftover Temp dirs**.
- **Deno panic auto-report**: `core/deno_panic.mjs` → `denoland/deno` (if `gh` + auth); dedup `data/test/deno_panics.json`. Override: `FOUNT_DENO_PANIC_REPO`. `testkit` excluded.
- **`[aria-ignore]`**: value = GitHub issue URL; closed-state via hub `github_issue` + Playwright `assertAriaIgnoreIssues`. Policy: `pages/scripts/test/aria_ignore.mjs`. No hub / `gh` → treat as still open. Page watch: [playwright.md](docs/playwright.md#page-watch).
- **`[language-check-ignore]`**: boolean; page-watch locale script scan skips the subtree (language name lists, EULA in a chosen locale). Not `user-content`. `[prompt-content]` = prompt/model/plugin content (tool logs, tool cards) — same subtree skip, use it instead of `user-content` for prompt-side text. `user-content=""` skips the whole subtree; `user-content="aria-label"` skips only that element's own `aria-label`. Selector: `LOCALE_CHECK_SKIP_SELECTOR` in `pages/scripts/test/watch/locale_script.mjs`.
- **Locale triggers**: [trigger-filter.md](docs/trigger-filter.md#locale-triggers).
- **Selftests**: `fount test testkit`. Fixtures: `selftest/fixtures.mjs`. Timeout races: `awaitWithTimeout` in `selftest/kernel_fixtures.mjs` (clears the timer). Keep manifest id `testkit`.
- **Naming**: suite/file/`Deno.test` names use domain semantics.
