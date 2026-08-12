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
| Suite packing / optimistic overlap / `--no-parallel` | [docs/resource-scheduling.md](docs/resource-scheduling.md) |
| Host keep-awake / sleep interrupts | [docs/host-keep-awake.md](docs/host-keep-awake.md) |
| Playwright fixtures / CDN / diagnostics | [docs/playwright.md](docs/playwright.md) |
| Fixture mocks (ImportHandlers / OpenAI cache) | [docs/fixtures-mocks.md](docs/fixtures-mocks.md) |
| Upstream blockers (do not silence) | [docs/upstream-blockers.md](docs/upstream-blockers.md) |
| OOM / heap | [docs/heap-snapshots.md](docs/heap-snapshots.md) |
| Trigger filter | [docs/trigger-filter.md](docs/trigger-filter.md) |

## Architecture

- **Entry**: `fount test` → `cli.mjs` → `runner/index.mjs`.
- **i18n**: `src/scripts/i18n/bare.mjs` only — never pull in the server module graph.
- **State DB**: `data/test/state/main.json` — per-suite status, fingerprint, baselines, log paths. `state/main.md` renders a dependency-tree mermaid. Fingerprints update only after that suite's plan slot finishes — never batch-align at wave start. Each `fount test` prunes suite/subtest entries (and logs / Playwright dirs) that no longer exist in manifests — rename/remove does not leave orphans.
- **Run report**: `data/test/report.md` + `report.json` — last run only. Trigger reasons: `data/test/triggered-reasons.md`.
- **Default loop** (bare `fount test`): imperfect wave → outdated wave → 0 when both empty; never full-repo unless `--all`. Details: [continue-report.md](docs/continue-report.md).
- **Selectors**: `manifest:suite` / `manifest:suite:subtest`. Exact suite name wins; prefix expansion only when no exact match; explicit `*`/`?` always globs. Third CLI segment on serial suites = `*.test.mjs` stem → `FOUNT_TEST_ONLY`.
- **`FOUNT_TEST_SUBTESTS`**: when CLI selects a suite without `:subtest`, ambient env is merged into that suite's filter (CLI `:subtest` wins; not for dependsOn-only suites or wave goals without suiteSelectors).
- **`FOUNT_TEST_TRIGGERED_FILES`**: temp file of repo-relative paths that matched this wave's triggers. Empty = unconstrained. Protocol: [protocol.mjs](core/protocol.mjs); plan detail: [continue-report.md](docs/continue-report.md).
- **`--no-parallel`**: serial dispatch **and** inner concurrency = 1. **Default for agents on Windows** / local verification ([denoland/deno#35804](https://github.com/denoland/deno/issues/35804)).
- **`dependsOn`**: downstream `blocked(by)` when a dependency is not green-capable. Optimistic overlap: [resource-scheduling.md](docs/resource-scheduling.md).
- **Live driver**: `live/runner.mjs` — ephemeral nodes, `FOUNT_TEST_NODE_*` env, teardown after. Launch/ping failures → exit 1. Non-worker `env.mjs` sets `process.exitCode = 1` on `unhandledRejection`/`uncaughtException` — otherwise a logged rejection exits 0 (**passed with noise**).
- **Test hub**: parent `runTests` binds Express on `http://127.0.0.1:8903` (`hub/index.mjs`), sets `FOUNT_TEST_HUB_URL`. Suites inherit via env; Playwright injects `fount.test.hubUrl`. Routes in `hub/apis/`; clients in `hub/clients/`. No hub / hub down → issue still open / store miss.
- **Libs**: import from `core/`, `hub/`, `live/`, `runner/`, `playwright/` — do not reimplement HTTP/WS/state helpers.
- **Shell module graph**: `shellLoadProbe.mjs` — path resolve + **named export** check (`missingNamed`). When a shell imports another part's `public/shared`, put that shared glob on the consumer suite's triggers.

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

- **`triggers`**: glob match via `npm:picomatch` (braces `{a,b}`, `dot: true`). Default ignores docs/metadata; override via **`triggerFilter`**: [trigger-filter.md](docs/trigger-filter.md). Watch scope = code the suite runs — not shared runners (`serial.mjs`/`boot.mjs` only on `pure`/`integration`/`testkit`). Federation: only `fed_core` watches `federation/**`. **Dead triggers** (glob matches zero repo files) → `fount test` prints them and **exits 1 before any suite runs**.
- **`dependsOn`**: plan pulls transitive deps. Imperfect wave = hard fails + one-level dependents (noisy re-runs but does not expand dependents); stale `unknown` → outdated wave.
- **`subtests`**: `{ name, triggers|trigger, spec? }`. When splitting a frontend god-file, update that subtest's `triggers`. Runtime filter: `FOUNT_TEST_SUBTESTS`. Suite-level `noisy` only marks subtests when **no** file failed.
- **Live layering**: smoke → e2e gates; do not jump straight to full e2e. Details: [domain-harness.md](docs/domain-harness.md#live-layering).
- **Browser scripts**: `/scripts/*` → `src/public/pages/scripts/` (browser absolute URLs only). Cross-runtime pure+browser: `shells/*/public/shared/`. Do not import `/scripts/test/*` from Deno trees; pure tests use relative paths, not `/parts/` URLs. Relative climbs from part `public/` are URL-resolved (`/parts/<partKey>/…` → may land on `/scripts/…`); prefer absolute `/scripts/…`. `shellLoadProbe` uses the same URL rules. Split: pure → `shared/`, UI → `public/src/`.
- **`heavy`** / **`resources`**: [resource-scheduling.md](docs/resource-scheduling.md). Invariant: waiters + idle machine → admit ≥1.

## Writing new tests

- Deno `.mjs` via `denoLiveRun(path)` or part-local `run.mjs` — no PowerShell probes.
- **Live WS probes**: `createLiveShellHttp({ shell? })` from `wsHarness.mjs` — end with `finishLiveWs` / `failLiveWsPrecondition`; frames via `waitForWsFrame`.
- **Polling**: `pollUntil` (live/fed, seconds, soft) / `waitUntil` (integration & selftest, ms, throws) — `core/wait.mjs`.
- **Chat / Social fixtures**: `createCharBoot` / `seedCharFixture` / `seedStubCharPart` / `waitUntil` from `shells/chat/test/harness.mjs`; Social agents: `seedAgentChar` (fixture copy) / `seedStubAgent` (stub `main.mjs` for `getPartList` / `resolveCharPartName`) in `shells/social/test/harness.mjs`. Char part names via `resolveCharPartName` at write boundaries; Hub compares with exact `===`.
- **ImportHandlers / easynew / OpenAI prompt-cache mock**: [fixtures-mocks.md](docs/fixtures-mocks.md).
- **Platform bot / OnMessage contract**: [domain-harness.md](docs/domain-harness.md#platform-bot--onmessage-contract).
- Every `deno run`/`test`/`install` carries `--allow-scripts --allow-all` (in that order). Sole exception: `deno cache` takes `--allow-scripts` alone.
- Single-node: `{ p2p: false, minP2pNode: true }`. Domain traps: [domain-harness.md](docs/domain-harness.md).
- **Teardown crashes after green**: Windows napi / Linux fatal signals with `N passed | 0 failed` → `[serial] ok … (deno teardown crash after pass)`, not suite red.

## Operator tools

- **Hung run**: `data/test/state/logs/`; rerun with env from the log. Idle watchdog 10m; duration floor 30m; `FOUNT_TEST_ONLY` partial runs do not update suite wall baseline. Host sleep aborts and retries — [host-keep-awake.md](docs/host-keep-awake.md). Opt out: `FOUNT_TEST_ALLOW_SLEEP=1`.
- **Deno panic auto-report**: `core/deno_panic.mjs` → `denoland/deno` issue (if `gh` + auth); dedup `data/test/deno_panics.json`. Override: `FOUNT_DENO_PANIC_REPO`. `testkit` excluded.
- **`[aria-ignore]` / GitHub issue probe**: policy in `pages/scripts/test/aria_ignore.mjs`; closed-state via test hub `github_issue` + Playwright `assertAriaIgnoreIssues`. No hub / `gh` down → treat as still open. Selftest: `page_watch`.
- **Locale triggers**: put `src/public/locales/**` on **jsonEditor subtests** (aria-label asserts), not suite-level `frontendShared`. Locale-only waves also hit `checks:i18n_*`; do not hang locales on Pages / chat / social / cabinet frontends unless a subtest asserts copy.
- **Selftests**: `fount test testkit`. Fixtures: `selftest/fixtures.mjs`. Keep manifest id `testkit`. Object-literal methods trip `jsdoc/require-jsdoc` — pass named functions into a factory (see `selftest/page_watch.test.mjs`).
- **Naming**: readable identifiers (`context` not `ctx`). Suite/file/`Deno.test` names use domain semantics — never planning milestone codes.
