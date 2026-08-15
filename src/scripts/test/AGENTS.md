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
| Fixture mocks (ImportHandlers / OpenAI cache) | [docs/fixtures-mocks.md](docs/fixtures-mocks.md) |
| Upstream blockers (do not silence) | [docs/upstream-blockers.md](docs/upstream-blockers.md) |
| OOM / heap | [docs/heap-snapshots.md](docs/heap-snapshots.md) |
| Trigger filter | [docs/trigger-filter.md](docs/trigger-filter.md) |

## Architecture

- **Entry**: `fount test` → `cli.mjs` ensures a detached kernel then `display/` paints. `--watch` is a flag, not a selector. `--update-estimates` rewrites manifests and skips the kernel. Internals: [kernel.md](docs/kernel.md). Overview/multi print failed/noisy suite tails once at `job-done` (CI last-lines); stream mode already live-prints.
- **CLI `--help`**: `fountConsole.test.help` is a usage tutorial (invocation, selectors, flags, examples). Kernel bind, state paths, manifest fields, and scheduler internals belong in this guide / `docs/` — not `--help`.
- **`--update-estimates`**: rewrite suite/subtest `expected` from state EMA baselines (`baselineDurationMs` / subtest `durationMs`); skip the kernel; selectors narrow the set. Does not run tests. Combine with `--watch` / `--all` / `--force` is an error.
- **`--kernel shutdown|reboot`**: talk to the detached hub only — do not enqueue a job. `shutdown` POSTs `/shutdown` (no-op if already down); `reboot` shuts down then `ensure`s. Incompatible with other flags or selectors. A hung kernel: `fount test --kernel reboot`.
- **i18n**: `src/scripts/i18n/bare.mjs` only — never pull in the server module graph. Display/CLI sets `FOUNT_TEST` via `mark.mjs` (not `env.mjs`).
- **State DB**: `data/test/state/main.json` — per-suite status, fingerprint, baselines, log paths. `state/main.md` = dependency-tree mermaid. Fingerprints update only after that suite's plan slot finishes — never batch-align at wave start. Each run prunes orphan suite/subtest entries (and logs / Playwright dirs) missing from manifests.
- **Run report**: `data/test/report.md` + `report.json` — last job/wave only; empty default wave does not overwrite. Trigger reasons: `data/test/triggered-reasons.md`.
- **Default plan** (bare `fount test`): one wave of imperfect ∪ outdated (each suite once). Imperfect queues first; a failure only blocks dependents. Exit non-zero if any suite is failed, blocked, noisy, or pending. Never full-repo unless `--all`. Details: [continue-report.md](docs/continue-report.md).
- **Selectors**: `manifest:suite` / `manifest:suite:subtest`. Exact name wins; prefix only when no exact match; `*`/`?` always globs. Third CLI segment on serial suites = `*.test.mjs` stem → `FOUNT_TEST_ONLY`.
- **`FOUNT_TEST_SUBTESTS`**: ambient env merges when CLI selects a suite without `:subtest` (CLI wins; not for dependsOn-only or wave goals without suiteSelectors).
- **`FOUNT_TEST_TRIGGERED_FILES`**: temp file of repo-relative paths that matched this wave's triggers (empty = unconstrained). Protocol: [protocol.mjs](core/protocol.mjs).
- **`--force`**: disable reuse of fresh green/noisy/red.
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
- **`expected`**: duration seed (`16s` / `4m12s` / ms number) for ETA when state has no baseline. Suite = full-run wall; subtest = that spec. Refresh with `fount test --update-estimates`.
- **`heavy`** / **`resources`**: [resource-scheduling.md](docs/resource-scheduling.md). Invariant: waiters + idle machine → admit ≥1.

## Writing new tests

- Deno `.mjs` via `denoLiveRun(path)` or part-local `run.mjs` — no PowerShell probes.
- **Live WS probes**: `createLiveShellHttp({ shell? })` from `wsHarness.mjs` — end with `finishLiveWs` / `failLiveWsPrecondition`; frames via `waitForWsFrame`.
- **Polling**: `pollUntil` (live/fed, seconds, soft) / `waitUntil` (integration & selftest, ms, throws) — `core/wait.mjs`.
- **Chat / Social fixtures**: `createCharBoot` / `seedCharFixture` / `seedStubCharPart` / `waitUntil` from `shells/chat/test/harness.mjs`; Social agents: `seedAgentChar` / `seedStubAgent` in `shells/social/test/harness.mjs`. Char names via `resolveCharPartName` at write boundaries; Hub compares with exact `===`.
- **ImportHandlers / easynew / OpenAI prompt-cache mock**: [fixtures-mocks.md](docs/fixtures-mocks.md).
- **Platform bot / OnMessage contract**: [domain-harness.md](docs/domain-harness.md#platform-bot--onmessage-contract).
- Every `deno run`/`test`/`install` carries `--allow-scripts --allow-all` (in that order). Sole exception: `deno cache` takes `--allow-scripts` alone.
- Single-node: `{ p2p: false, minP2pNode: true }`. Domain traps: [domain-harness.md](docs/domain-harness.md).
- **Teardown crashes after green**: Windows napi / Linux fatal signals with `N passed | 0 failed` → `[serial] ok … (deno teardown crash after pass)`, not suite red.

## Operator tools

- **Hung run**: `data/test/state/logs/`; rerun with env from the log. Watchdogs / sleep retry / baselines: [host-keep-awake.md](docs/host-keep-awake.md), [resource-scheduling.md](docs/resource-scheduling.md). Opt out: `FOUNT_TEST_ALLOW_SLEEP=1`. Module-check mutex leaks (killed Deno child never POSTs ready) auto-release the mutex after the idle window and still fail the suite as missed-ready; they must not freeze later suites. Stuck detached kernel: `fount test --kernel shutdown` / `--kernel reboot`.
- **Deno panic auto-report**: `core/deno_panic.mjs` → `denoland/deno` (if `gh` + auth); dedup `data/test/deno_panics.json`. Override: `FOUNT_DENO_PANIC_REPO`. `testkit` excluded.
- **`[aria-ignore]`**: value = GitHub issue URL; closed-state via hub `github_issue` + Playwright `assertAriaIgnoreIssues`. Policy: `pages/scripts/test/aria_ignore.mjs`. No hub / `gh` → treat as still open. Page watch: [playwright.md](docs/playwright.md#page-watch).
- **`[language-check-ignore]`**: boolean; page-watch locale script scan skips the subtree (language name lists, EULA in a chosen locale). Not `user-content`. Selector: `LOCALE_CHECK_SKIP_SELECTOR` in `pages/scripts/test/watch/locale_script.mjs`.
- **Locale triggers**: [trigger-filter.md](docs/trigger-filter.md#locale-triggers).
- **Selftests**: `fount test testkit`. Fixtures: `selftest/fixtures.mjs`. Timeout races: `awaitWithTimeout` in `selftest/kernel_fixtures.mjs` (clears the timer). Keep manifest id `testkit`.
- **Naming**: readable identifiers (`context` not `ctx`). Suite/file/`Deno.test` names use domain semantics — never planning milestone codes.
