---
description: fount test framework — CLI, state DB, selection, dependencies, live driver, and operator diagnostics
globs: src/scripts/test/**, **/test/manifest.json
alwaysApply: false
---

# Test Framework Guide

Domain harness (federation join, channel-key asserts, `launchNode`, fixtures, disposable paths): [docs/domain-harness.md](docs/domain-harness.md).
Plan / verdict / continue reasons: [docs/continue-report.md](docs/continue-report.md).
Suite packing / optimistic overlap: [docs/resource-scheduling.md](docs/resource-scheduling.md).
Host keep-awake / sleep interrupts: [docs/host-keep-awake.md](docs/host-keep-awake.md).

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
- **Shell module graph**: `shellLoadProbe.mjs` — path resolve + **named export** check (`missingNamed`). Bot/chat/social integration probes assert `missingNamed === []`. When a shell imports another part's `public/shared`, put that shared glob on the consumer suite's triggers.

## Taxonomy

| Kind | Meaning |
| --- | --- |
| `pure/` | Zero I/O |
| `integration/` | Single-process; no real HTTP/WS node (exception: `launchNode` HTTP suites) |
| `live/` | Real fount node + HTTP/WS |
| `frontend/` | Playwright (`playwright/`) |
| `sim/` | In-process simulation harness |
| `checks/` | Repo static health (`checks` manifest under `src/scripts/checks/`): HTML meta/landmarks/`drawer-toggle`/aside ARIA; parts `locales.json` / `achievements_registry.json` info + remote icon URL; **i18n key structure** (`checks:i18n_keys` — no Suffix/Prefix affix keys, no ≥4 flat camelCase siblings sharing a prefix, no `xxx1`-style numbered keys); **Python reshape self-check** (`checks:reshape_i18n_keys` — `reshape_i18n_keys.py --self-test`); **AGENTS.md + agent-facing linked `.md` English-only** (`checks:agents_md_english` — no CJK except human-facing `docs/design/` and `docs/review/`; transitive markdown links must resolve); **纯英文 JSDoc** (`checks:jsdoc_english` — 摘要含拉丁字母且无 CJK；`deno run -A ./src/scripts/checks/tools/scan_jsdoc_english.mjs` 列出残留). Prefix-nest **writeback** of locale JSON: `.esh/commands/reshape_i18n_keys.py` (Python only — JS stringify reorders numeric keys like `404`). Formerly `.esh/commands/verify-meta.py` / `verify-info.py`. |

**Frontend**: fixtures, browser binary, network noise, i18n-missing / a11y / locale-script hard-fail, GitHub Pages — [playwright.md](docs/playwright.md). Prefer `[data-i18n]` selectors over locale-specific copy. Drive locale via `setLanguage` / `loadLocaleData` — do not fetch `/api/getlocaledata` from tests. CDN GET/HEAD (`esm.sh` / Iconify / jsDelivr) is reused across cases via `cdn_cache.mjs` (`data/test/cdn_cache`); set `FOUNT_TEST_CDN_CACHE=0` to disable.

**pure/ boundary**: tested modules must not statically `import` `src/server/**` (P2P/native graph; Windows Deno child exit can hang). Use dynamic import or promote to `integration/`.

Manifest id = domain (`server`, `testkit`, `p2p`, `shells/chat`, …).

## Manifest fields

- **`triggers`**: glob match on changed files. Default ignores docs/metadata; override via **`triggerFilter`**: [trigger-filter.md](docs/trigger-filter.md). Watch scope = code the suite runs — not shared runners (`serial.mjs`/`boot.mjs` only on `pure`/`integration`/`testkit`). Federation: only `fed_core` watches `federation/**`.
- **`dependsOn`**: plan pulls transitive deps. Imperfect wave = hard fails + one-level dependents (noisy re-runs but does not expand dependents); stale `unknown` → outdated wave.
- **`subtests`**: `{ name, triggers|trigger, spec? }`. When splitting a frontend god-file, update that subtest's `triggers`. Runtime filter: `FOUNT_TEST_SUBTESTS`. Suite-level `noisy` only marks subtests when **no** file failed.
- **Live layering**: use smoke → e2e gates; do not jump straight to full e2e. Details: [domain-harness.md](docs/domain-harness.md#live-layering).
- **Browser scripts**: `/scripts/*` → `src/public/pages/scripts/` (browser absolute URLs only). Cross-runtime pure+browser: `shells/*/public/shared/`. Do not import `/scripts/test/*` from Deno trees; pure tests use relative paths, not `/parts/` URLs. Relative climbs from part `public/` to `pages/scripts` resolve as `/pages/scripts/…` (404) — use `/scripts/…`. Split: pure → `shared/`, UI → `public/src/`.
- **`heavy`** / **`resources`**: [resource-scheduling.md](docs/resource-scheduling.md). Invariant: waiters + idle machine → admit ≥1.

## Writing new tests

- Deno `.mjs` via `denoLiveRun(path)` or part-local `run.mjs` — no PowerShell probes.
- **Live WS probes**: `createLiveShellHttp({ shell? })` from `wsHarness.mjs` — do not re-declare local HTTP helpers. End with `finishLiveWs` / `failLiveWsPrecondition`; frames via `waitForWsFrame`.
- **Polling**: `pollUntil` (live/fed, seconds, soft) / `waitUntil` (integration, ms, throws) — definitions only in `live/http.mjs`.
- **Chat / Social fixtures**: `createCharBoot` / `seedCharFixture` / `waitUntil` from `shells/chat/test/harness.mjs`; Social agents: `seedAgentChar` in `shells/social/test/harness.mjs`.
- **Platform bot / OnMessage contract**: [domain-harness.md](docs/domain-harness.md#platform-bot--onmessage-contract).
- Every `deno run`/`test`/`install` carries `--allow-scripts --allow-all` (in that order). Sole exception: `deno cache` takes `--allow-scripts` alone.
- Single-node: `{ p2p: false, minP2pNode: true }`. Domain traps (ports, native addons, federation): [domain-harness.md](docs/domain-harness.md).
- **Teardown crashes after green**: Windows napi / Linux fatal signals with `N passed | 0 failed` → `[serial] ok … (deno teardown crash after pass)`, not suite red.

## Operator tools

- **Hung run**: `data/test/state/logs/`; rerun `deno run --allow-scripts --allow-all -c deno.json <probe.mjs>` with env from the log. Idle watchdog (10m no stdall) fails the suite. Host sleep (wall-clock jump) aborts and retries — details in [host-keep-awake.md](docs/host-keep-awake.md).
- **Keep-awake**: wrappers keep the machine awake during runs — [host-keep-awake.md](docs/host-keep-awake.md). Opt out: `FOUNT_TEST_ALLOW_SLEEP=1`.
- **OOM / heap**: [heap-snapshots.md](docs/heap-snapshots.md).
- **Deno panic auto-report**: `core/deno_panic.mjs` → GitHub issue on `denoland/deno` (if `gh` + auth); dedup `data/test/deno_panics.json`. Override via `FOUNT_DENO_PANIC_REPO`. `testkit` excluded.
- **Selftests**: `fount test testkit`. Fixtures: `selftest/fixtures.mjs` (`makeSuite` / `makeStateEntry`). Keep manifest id `testkit`.
- **Naming**: readable identifiers (`context` not `ctx`). Suite/file/`Deno.test` names use domain semantics — never planning milestone codes.
