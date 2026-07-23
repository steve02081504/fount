---
description: fount test framework — CLI, state DB, selection, dependencies, live driver, and operator diagnostics
globs: src/scripts/test/**, **/test/manifest.json
alwaysApply: false
---

# Test Framework Guide

Domain harness (federation join, CKG asserts, `launchNode`, fixtures, disposable paths): [docs/domain-harness.md](docs/domain-harness.md).
Plan / verdict / continue reasons: [docs/continue-report.md](docs/continue-report.md).
Suite packing / optimistic overlap: [docs/resource-scheduling.md](docs/resource-scheduling.md).

## Architecture

- **Entry**: `fount test` → `cli.mjs` → `runner/index.mjs`.
- **i18n**: `fount/scripts/i18n/bare.mjs` only — never pull in the server module graph.
- **State DB**: `data/test/state/main.json` — per-suite status, fingerprint, baselines, log paths. `state/main.md` renders a dependency-tree mermaid. Fingerprints update only after that suite's plan slot finishes — never batch-align at wave start (Ctrl+C must not mark unrun suites current). Details: [continue-report.md](docs/continue-report.md).
- **Run report**: `data/test/report.md` + `report.json` — last run only. Trigger reasons: `data/test/triggered-reasons.md`.
- **Default loop** (bare `fount test`): imperfect wave (`failed`/`blocked`/missing/fresh `noisy` + one-level dependents of hard fails only — noisy does not drag dependents) → `failed`/`blocked`/`noisy`/pending exits 1; else outdated wave (`unknown`) → back to imperfect; both empty → 0. Never full-repo unless `--all`. Noisy is re-run once per wave, then exit 1 if still noisy.
- **Selectors**: `manifest:suite` / `manifest:suite:subtest`. Exact suite name wins; prefix expansion only when no exact match; explicit `*`/`?` always globs. Third CLI segment on serial suites = `*.test.mjs` stem → `FOUNT_TEST_ONLY`.
- **`--no-parallel`**: serial dispatch **and** inner concurrency = 1. **Default for agents on Windows** / local verification ([denoland/deno#35804](https://github.com/denoland/deno/issues/35804)). See [resource-scheduling.md](docs/resource-scheduling.md).
- **`dependsOn`**: downstream `blocked(by)` when a dependency is not green-capable. Optimistic overlap while hard deps run: [resource-scheduling.md](docs/resource-scheduling.md).
- **Live driver**: `live/runner.mjs` — ephemeral nodes, `FOUNT_TEST_NODE_*` env, teardown after. Launch/ping failures return exit 1. Non-worker `env.mjs` sets `process.exitCode = 1` on `unhandledRejection`/`uncaughtException` — otherwise a logged rejection exits 0 (**passed with noise**).
- **Libs**: import from `core/`, `live/`, `runner/`, `playwright/` — do not reimplement HTTP/WS/state helpers.

## Taxonomy

| Kind | Meaning |
| --- | --- |
| `pure/` | Zero I/O |
| `integration/` | Single-process; no real HTTP/WS node (exception: `launchNode` HTTP suites) |
| `live/` | Real fount node + HTTP/WS |
| `frontend/` | Playwright (`playwright/`) |
| `sim/` | In-process simulation harness |

**Frontend**: fixtures, browser binary, network noise, GitHub Pages + a11y — [playwright.md](docs/playwright.md).

**pure/ boundary**: tested modules must not statically `import` `src/server/**` (P2P/native graph; Windows Deno child exit can hang). Use dynamic import or promote to `integration/`.

Manifest id = domain (`server`, `testkit`, `p2p`, `shells/chat`, …).

## Manifest fields

- **`triggers`**: glob match on changed files. Default ignores docs/metadata; override via **`triggerFilter`**: [trigger-filter.md](docs/trigger-filter.md). Watch scope = code the suite runs — not shared runners (`serial.mjs`/`boot.mjs` only on `pure`/`integration`/`testkit`). Federation: only `fed_core` watches `federation/**`.
- **`dependsOn`**: plan pulls transitive deps. Imperfect wave = hard fails + one-level dependents (noisy re-runs but does not expand dependents); stale `unknown` → outdated wave.
- **`subtests`**: `{ name, triggers|trigger, spec? }`. When splitting a frontend god-file, update that subtest's `triggers`. Runtime filter: `FOUNT_TEST_SUBTESTS`. Suite-level `noisy` only marks subtests when **no** file failed.
- **Live layering**: use smoke → e2e gates; do not jump straight to full e2e. Details: [domain-harness.md](docs/domain-harness.md#live-layering).
- **Browser scripts**: `/scripts/*` → `src/public/pages/scripts/` (browser-only absolute URLs). **Shared cross-runtime** (Deno `pure/` + browser): `shells/*/public/shared/`. Do not import `/scripts/test/*` from Deno trees; pure tests use relative paths, not `/parts/` URL specifiers. Relative climbs from part `public/` to `pages/scripts` resolve in the browser as `/pages/scripts/…` (404) — use absolute `/scripts/…`. Split pure → `shared/`, UI → `public/src/`.
- **`heavy`** / **`resources`**: [resource-scheduling.md](docs/resource-scheduling.md). Invariant: waiters + idle machine → admit ≥1.

## Writing new tests

- Deno `.mjs` via `denoLiveRun(path)` or part-local `run.mjs` — no PowerShell probes.
- **Live WS probes**: `createLiveShellHttp({ shell? })` from `wsHarness.mjs` — do not re-declare local HTTP helpers. End with `finishLiveWs` / `failLiveWsPrecondition`; frames via `waitForWsFrame`.
- **Polling**: `pollUntil` (live/fed, seconds, soft) / `waitUntil` (integration, ms, throws) — definitions only in `live/http.mjs`.
- **Chat / Social fixtures**: `createCharBoot` / `seedCharFixture` / `waitUntil` from `shells/chat/test/harness.mjs`; Social agents: `seedAgentChar` in `shells/social/test/harness.mjs`.
- Every `deno run`/`test`/`install` carries `--allow-scripts --allow-all` (in that order). Sole exception: `deno cache` takes `--allow-scripts` alone.
- Single-node: `{ p2p: false, minP2pNode: true }`. Domain traps (ports, native addons, federation): [domain-harness.md](docs/domain-harness.md).
- **Teardown crashes after green**: Windows napi exit codes and Linux fatal signals with `N passed | 0 failed` → `[serial] ok … (deno teardown crash after pass)`, not suite red.

## Operator tools

- **Hung run**: `data/test/state/logs/`; rerun `deno run --allow-scripts --allow-all -c deno.json <probe.mjs>` with env from the log.
- **OOM / heap**: [heap-snapshots.md](docs/heap-snapshots.md).
- **Deno panic auto-report**: `core/deno_panic.mjs` → GitHub issue on `denoland/deno` (if `gh` + auth); dedup `data/test/deno_panics.json`. Override via `FOUNT_DENO_PANIC_REPO`. `testkit` excluded.
- **Selftests**: `fount test testkit`. Fixtures: `selftest/fixtures.mjs` (`makeSuite` / `makeStateEntry`). Keep manifest id `testkit`.
- **Naming**: readable identifiers (`context` not `ctx`). Suite/file/`Deno.test` names use domain semantics — never planning milestone codes.
