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

- **Entry**: `fount test` → path CLI `deno upgrade canary` → `cli.mjs` → `runner/index.mjs`.
- **i18n**: `fount/scripts/i18n/bare.mjs` only — never pull in the server module graph.
- **State DB**: `data/test/state/main.json` — per-suite status, fingerprint, baselines, log paths. `state/main.md` renders a dependency-tree mermaid. Fingerprints update only after that suite's plan slot finishes — never batch-align at wave start (Ctrl+C must not mark unrun suites current). Details: [continue-report.md](docs/continue-report.md).
- **Run report**: `data/test/report.md` + `report.json` — last run only. Trigger reasons: `data/test/triggered-reasons.md`.
- **Default loop** (bare `fount test`): imperfect wave (`failed`/`blocked`/missing/fresh `noisy` + one-level dependents of hard fails only — noisy does not drag dependents) → `failed`/`blocked`/`noisy`/pending exits 1; else outdated wave (`unknown`) → back to imperfect; both empty → 0. Never full-repo unless `--all`. Noisy is re-run once per wave, then exit 1 if still noisy.
- **Selectors**: `manifest:suite` / `manifest:suite:subtest`. Exact suite name wins; prefix expansion only when no exact match; explicit `*`/`?` always globs. Third CLI segment on serial suites = `*.test.mjs` stem → `FOUNT_TEST_ONLY`.
- **`FOUNT_TEST_SUBTESTS`**: when CLI selects a suite without `:subtest` (e.g. `shells/chat:frontend`), ambient `FOUNT_TEST_SUBTESTS=composer` is merged into that suite's filter (CLI `:subtest` wins; does not apply to dependsOn-only suites or wave goals without suiteSelectors).
- **`--no-parallel`**: serial dispatch **and** inner concurrency = 1. **Default for agents on Windows** / local verification ([denoland/deno#35804](https://github.com/denoland/deno/issues/35804)). See [resource-scheduling.md](docs/resource-scheduling.md).
- **`dependsOn`**: downstream `blocked(by)` when a dependency is not green-capable. Optimistic overlap while hard deps run: [resource-scheduling.md](docs/resource-scheduling.md).
- **Live driver**: `live/runner.mjs` — ephemeral nodes, `FOUNT_TEST_NODE_*` env, teardown after. Launch/ping failures return exit 1. Non-worker `env.mjs` sets `process.exitCode = 1` on `unhandledRejection`/`uncaughtException` — otherwise a logged rejection exits 0 (**passed with noise**).
- **Test hub**: parent `runTests` binds Express on `http://127.0.0.1:8903` (`hub/index.mjs`), sets `FOUNT_TEST_HUB_URL`. Suites inherit via env; Playwright injects `fount.test.hubUrl`. Route modules in `hub/apis/` (`health`, `github_issue`, `shared_store`); fetch clients in `hub/clients/`. No hub / hub down → issue still open / store miss.
- **Libs**: import from `core/`, `hub/`, `live/`, `runner/`, `playwright/` — do not reimplement HTTP/WS/state helpers.
- **Shell module graph**: `shellLoadProbe.mjs` — path resolve + **named export** check (`missingNamed`). Bot/chat/social integration probes assert `missingNamed === []`. When a shell imports another part's `public/shared`, put that shared glob on the consumer suite's triggers.

## Taxonomy

| Kind | Meaning |
| --- | --- |
| `pure/` | Zero I/O |
| `integration/` | Single-process; no real HTTP/WS node (exception: `launchNode` HTTP suites) |
| `live/` | Real fount node + HTTP/WS |
| `frontend/` | Playwright (`playwright/`) |
| `sim/` | In-process simulation harness |
| `checks/` | Repo static health — [checks/AGENTS.md](../checks/AGENTS.md) |

**Frontend**: fixtures, browser binary, network noise, i18n-missing / a11y / locale-script hard-fail, GitHub Pages — [playwright.md](docs/playwright.md). Prefer `[data-i18n]` selectors over locale-specific copy. Drive locale via `setLanguage` / `loadLocaleData` — do not fetch `/api/getlocaledata` from tests. CDN GET/HEAD (`esm.sh` / Iconify / jsDelivr) is reused across cases via `cdn_cache.mjs` (`data/test/cdn_cache`); set `FOUNT_TEST_CDN_CACHE=0` to disable. Product code under test must match production — do not skip probes/embeds via `fount.test.enabled`. Fix our throws; diagnostics ignore child-frame `SecurityError` (CDP `exception.className` + frame id; no text parsing), `ERR_BLOCKED_BY_ORB` / `ERR_ABORTED`, and Pages probe noise (`/api/ping`, `:8930`). Network diagnostic URLs are logged raw — never redact; test data must not carry durable secrets.

**pure/ boundary**: tested modules must not statically `import` `src/server/**` (P2P/native graph; Windows Deno child exit can hang). Use dynamic import or promote to `integration/`.

Manifest id = domain (`server`, `testkit`, `p2p`, `shells/chat`, …).

## Manifest fields

- **`triggers`**: glob match on changed files via `npm:picomatch` (braces `{a,b}`, `dot: true`). Default ignores docs/metadata; override via **`triggerFilter`**: [trigger-filter.md](docs/trigger-filter.md). Watch scope = code the suite runs — not shared runners (`serial.mjs`/`boot.mjs` only on `pure`/`integration`/`testkit`). Federation: only `fed_core` watches `federation/**`. **Dead triggers** (glob matches zero repo files) → `fount test` prints them and **exits 1 before any suite runs** — fix or remove the path; do not ship stale globs.
- **`dependsOn`**: plan pulls transitive deps. Imperfect wave = hard fails + one-level dependents (noisy re-runs but does not expand dependents); stale `unknown` → outdated wave.
- **`subtests`**: `{ name, triggers|trigger, spec? }`. When splitting a frontend god-file, update that subtest's `triggers`. Runtime filter: `FOUNT_TEST_SUBTESTS`. Suite-level `noisy` only marks subtests when **no** file failed.
- **Live layering**: use smoke → e2e gates; do not jump straight to full e2e. Details: [domain-harness.md](docs/domain-harness.md#live-layering).
- **Browser scripts**: `/scripts/*` → `src/public/pages/scripts/` (browser absolute URLs only). Cross-runtime pure+browser: `shells/*/public/shared/`. Do not import `/scripts/test/*` from Deno trees; pure tests use relative paths, not `/parts/` URLs. Relative climbs from part `public/` to `pages/scripts` resolve as `/pages/scripts/…` (404) — use `/scripts/…`. Split: pure → `shared/`, UI → `public/src/`.
- **`heavy`** / **`resources`**: [resource-scheduling.md](docs/resource-scheduling.md). Invariant: waiters + idle machine → admit ≥1.

## Writing new tests

- Deno `.mjs` via `denoLiveRun(path)` or part-local `run.mjs` — no PowerShell probes.
- **Live WS probes**: `createLiveShellHttp({ shell? })` from `wsHarness.mjs` — do not re-declare local HTTP helpers. End with `finishLiveWs` / `failLiveWsPrecondition`; frames via `waitForWsFrame`.
- **Polling**: `pollUntil` (live/fed, seconds, soft) / `waitUntil` (integration & selftest, ms, throws) — definitions in `core/wait.mjs`.
- **Chat / Social fixtures**: `createCharBoot` / `seedCharFixture` / `seedStubCharPart`（仅 `main.mjs` 占位，供 `resolveCharPartName` / `ensureAgent*`）/ `waitUntil` from `shells/chat/test/harness.mjs`; Social agents: `seedAgentChar` in `shells/social/test/harness.mjs`. 角色 part 名在写入边界经 `resolveCharPartName` 对齐 `chars/` 真实目录名；Hub 按原串 `===`，勿再 fold。
- **ImportHandlers (ST/Risu) / easynew**: shared mock AI via `scripts/test/fixtures/mock_ai.mjs` (`seedMockAiSource`, `PROMPT_MARKER`). ImportHandlers: `createImportBoot` / `importAndRunChar`. easynew: `createEasynewBoot` / `createFromTemplate` / `runEasyChar`. Installed part Templates must use `fount/` imports (not `../../../../../src/…`) so they load from disposable test data dirs.
- **OpenAI prompt-cache mock**: `scripts/test/fixtures/openai_prompt_cache_mock.mjs` + `serviceSources/AI/proxy_openai_mock` (env `FOUNT_TEST_OPENAI_MOCK_URL`). Assert **exact prefix match rate** (`prefixMatchRate`); OpenAI `cached_tokens` still applies ≥1024 / 128 flooring in the mock response. Default `system_prompt_at_depth: 10` moves the system block as the log grows — expect ~83% over 100 rounds, not near-100%.
- **Platform bot / OnMessage contract**: [domain-harness.md](docs/domain-harness.md#platform-bot--onmessage-contract).
- Every `deno run`/`test`/`install` carries `--allow-scripts --allow-all` (in that order). Sole exception: `deno cache` takes `--allow-scripts` alone.
- Single-node: `{ p2p: false, minP2pNode: true }`. Domain traps (ports, native addons, federation): [domain-harness.md](docs/domain-harness.md).
- **Teardown crashes after green**: Windows napi / Linux fatal signals with `N passed | 0 failed` → `[serial] ok … (deno teardown crash after pass)`, not suite red.

## Operator tools

- **CI `data/test` cache**: per-branch `fount-test-data-<branch>`. PR merge may promote head→base via `promote_test_data_cache.yaml` (git eligibility + `cache/restore`/`save` — do not treat `gh cache list` as success). Branch-delete and default-branch Run Tests wait for promote before dropping/restoring keys.
- **Hung run**: `data/test/state/logs/`; rerun the probe with env from the log. Idle watchdog (10m no stdall) fails the suite. Duration watchdog floor is 30m (same as no-baseline default) so a polluted short `baselineDurationMs` cannot shrink the cap; `FOUNT_TEST_ONLY` partial serial runs do not update suite wall baseline. Host sleep aborts and retries — [host-keep-awake.md](docs/host-keep-awake.md).
- **Upstream blockers** (do not filter/silence in product or tests): [upstream-blockers.md](docs/upstream-blockers.md).
- **Keep-awake**: [host-keep-awake.md](docs/host-keep-awake.md). Opt out: `FOUNT_TEST_ALLOW_SLEEP=1`.
- **OOM / heap**: [heap-snapshots.md](docs/heap-snapshots.md).
- **Deno panic auto-report**: `core/deno_panic.mjs` → `denoland/deno` issue (if `gh` + auth); dedup `data/test/deno_panics.json`. Override: `FOUNT_DENO_PANIC_REPO`. `testkit` excluded.
- **`[aria-ignore]` / GitHub issue probe**: policy in `pages/scripts/test/aria_ignore.mjs`; closed-state via test hub `github_issue` API + Playwright `assertAriaIgnoreIssues`. No hub / `gh` down → treat as still open. Selftest: `page_watch`.
- **Locale triggers**: put `src/public/locales/**` on **jsonEditor subtests** (aria-label asserts), not suite-level `frontendShared`. Locale-only waves also hit `checks:i18n_*`; do not hang locales on Pages / chat / social / cabinet frontends unless a subtest asserts copy.
- **Selftests**: `fount test testkit`. Fixtures: `selftest/fixtures.mjs`. Keep manifest id `testkit`. Object-literal methods trip `jsdoc/require-jsdoc` — pass named functions into a factory (see `selftest/page_watch.test.mjs`).
- **Naming**: readable identifiers (`context` not `ctx`). Suite/file/`Deno.test` names use domain semantics — never planning milestone codes.
