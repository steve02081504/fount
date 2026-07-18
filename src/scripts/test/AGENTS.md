---
description: fount test framework — CLI, state DB, selection, dependencies, live driver, and operator diagnostics
globs: src/scripts/test/**, **/test/manifest.json
alwaysApply: false
---

# Test Framework Guide

Domain-specific traps (chat / social / federation) live in [docs/domain-harness.md](docs/domain-harness.md) or each part's own guide — not here.

## Architecture

- **Entry**: `fount test` → `cli.mjs` → `runner/index.mjs`.
- **i18n**: `fount/scripts/i18n/bare.mjs` only — never pull in the server module graph.
- **State DB**: `data/test/state/main.json` — per-suite status, fingerprint, baselines, log paths. `state/main.md` renders a dependency-tree mermaid.
- **Run report**: `data/test/report.md` + `report.json` — last run only. **Suite sum** = non-reused slot durations; **wall clock** = run span; **parallel rate** = suite sum / wall clock × 100% − 100%. Trigger reasons: `data/test/triggered-reasons.md`. Dead trigger globs warn on console and in `report.md`. Wave/reason details: [continue-report.md](docs/continue-report.md).
- **Default loop** (bare `fount test`): imperfect wave (failed/noisy/blocked/missing + one-level dependents) → fail exits 1; all-green → outdated wave (`unknown`) → back to imperfect; both empty → exit 0. Never full-repo (use `--all`). No auto-retry within one invocation.
- **Failure-first inside suite**: `FOUNT_TEST_FIRST` = last `failedFiles`; those run first; any still failing → exit without the rest. Protocol: [core/protocol.mjs](core/protocol.mjs).
- **Subtests**: `subtests: [{ name, triggers|trigger, spec? }]`. Suite-level `trigger` = shared infra; per-subtest triggers prefer inline `triggers` (no single-use triggerSet). Selector: `manifest:suite:subtest`. Runtime filter: `FOUNT_TEST_SUBTESTS`. Suite-level `noisy` only marks subtests when **no** file failed — otherwise only failedFiles go `failed`.
- **File filter (serial suites)**: third CLI segment is a `*.test.mjs` stem → `FOUNT_TEST_ONLY`. Unknown stem → exit 2. Explicit filter always forces a real run.
- **Subtest timing**: suite wall ≈ `baselineOverheadMs` + Σ(selected `durationMs`). Partial runs update overhead + selected subtest baselines only — not suite `baselineDurationMs`. ETA via `expectedRunDurationMs`.
- **`--no-parallel`**: serial dispatch **and** inner concurrency = 1. **Default for agents on Windows** / local verification. Parallel Deno children with `nodeModulesDir: auto` + `lock: false` can corrupt `node_modules` ([denoland/deno#35804](https://github.com/denoland/deno/issues/35804)). See [resource-scheduling.md](docs/resource-scheduling.md).
- **Verdict + plan**: `core/verdict.mjs` → `green`/`noisy`/`red`/`unknown`; `core/plan.mjs` → `reuse`/`run`/`blocked` + `subtestsToRun`. Fresh `green`/`noisy`/`red` → `reuse` (refresh fingerprint). Goal red/noisy/unknown always **run**. `--force` forces goals. Failed transitive dep with unchanged triggers stays `reuse(red)` and still **blocks**.
- **`dependsOn`**: downstream `blocked(by)` when a dependency's plan action is not green-capable. Selector: `manifest:suite` / `manifest:suite:subtest` (`core/selector.mjs`, longest manifest prefix).
- **Suite selectors**: exact suite name wins (`shells/chat:fed_emoji` ≠ `fed_emoji_*`). Prefix expansion only when no exact match. Explicit `*`/`?` always globs.
- **Ordering & dispatch**: [resource-scheduling.md](docs/resource-scheduling.md).
- **Live driver**: `live/runner.mjs` — ephemeral nodes, `FOUNT_TEST_NODE_*` env, teardown after.

## Framework libs

| Module | Role |
| --- | --- |
| `live/deno_run.mjs` | `denoLiveRun()` argv builder |
| `live/http.mjs` | fetch, multipart, `PollUntil` / `sleep` |
| `live/env.mjs` | `FOUNT_TEST_BASE_URL` / `FOUNT_API_KEY` |
| `live/wsHarness.mjs` | `waitForWsFrame` — shared Chat/Social WS wait (no custom polling) |
| `core/state.mjs` | state DB read/write/upsert, fingerprint refresh |
| `core/verdict.mjs` | suite verdicts |
| `core/trigger_audit.mjs` | dead trigger glob audit |
| `core/plan.mjs` | goals + verdicts → plan |
| `core/selector.mjs` | selector resolution |
| `core/dependencies.mjs` | `dependsOn`, topo, imperfect dependents |
| `core/estimate.mjs` | ETA / `expectedRunDurationMs` |
| `core/deno_panic.mjs` | `Deno has panicked` → gh auto-issue |
| `core/disposable_path.mjs` | refuse production `data/` as test `dataDir` |
| `runner/suite_run.mjs` | `buildSuiteInvocation` / `runSuite` |
| `runner/continue_reason.mjs` | wave/slot reasons → report |

## Taxonomy

| Kind | Meaning |
| --- | --- |
| `pure/` | Zero I/O |
| `integration/` | Single-process; no real HTTP/WS node (exception: `launchNode` HTTP suites) |
| `live/` | Real fount node + HTTP/WS |
| `frontend/` | Playwright (`playwright/`) |
| `sim/` | In-process simulation harness |

**Frontend browser diagnostics** (`playwright/browser_diagnostics.mjs`): collects `response ≥ 400` / `requestfailed` → `[browser:network]` noise → imperfect wave. `pageerror` hard-fails. Do not re-attach in shell fixtures. Prefer local `page.route` over external media. Fix broken Iconify names; do not allowlist 404s.

**pure/ boundary**: tested modules must not statically `import` `src/server/**` (P2P/native graph; Windows Deno child exit can hang). Use dynamic import or promote to `integration/`.

Manifest id = domain (`server`, `testkit`, `p2p`, `shells/chat`, …).

## Manifest fields

- **`triggers`**: glob match on changed files. Default ignores docs/metadata; override via **`triggerFilter`**: [trigger-filter.md](docs/trigger-filter.md). Watch scope = code the suite runs — not shared runners (`serial.mjs`/`boot.mjs` only on `pure`/`integration`/`testkit`). Federation: only `fed_core` watches `federation/**`. Cross-part: narrow paths; P2P package → `deno.json` or `src/server/p2p_server/**`.
- **`dependsOn`**: plan pulls transitive deps. **Imperfect wave** = failed/noisy/blocked/missing + one-level dependents — **not** stale `unknown` (outdated wave). Fresh upstream `reuse` does not block.
- **`subtests`**: `{ name, triggers|trigger, spec? }`. When splitting a frontend god-file, update that subtest's `triggers` to the new entrypoints.
- **Live layering**: Chat `server:live` → `smoke_chat` → `e2e_single` → `e2e_single_extended` / `frontend`; Social similar via `smoke_social`; WS `ws` → `ws_rpc` → `ws_stream`; federation `fed_core` → feature suites. Cross-shell fed probes depend on `fed_core` + `fed_emoji` + `smoke_social`, not full social e2e.
- **Browser scripts**: `/scripts/*` → `src/public/pages/scripts/`. Chat/Social P2P primitives: `shells/chat/public/shared/` or `/parts/shells:chat/shared/*`. Do not import `/scripts/test/*` from Deno-only trees.
- **`heavy`** / **`resources`**: [resource-scheduling.md](docs/resource-scheduling.md).

## Writing new tests

- Deno `.mjs` via `denoLiveRun(path)` or part-local `run.mjs` — no PowerShell probes.
- Every `deno run`/`test`/`install` carries `--allow-scripts --allow-all` (in that order). Sole exception: `deno cache` takes `--allow-scripts` alone.
- Native-addon / WebRTC: one `.test.mjs` per Deno child when the addon panics under reuse. Federation live needs `node-datachannel`; `--allow-scripts` builds it on first run.
- Single-node: `{ p2p: false, minP2pNode: true }`. Signaling: [p2p/docs/signaling.md](../p2p/docs/signaling.md).
- Domain harness (federation join, CKG asserts, `launchNode`, fixture probes, disposable paths): [domain-harness.md](docs/domain-harness.md).
- **`--no-parallel` + `serial.mjs`**: prints `[serial] ok …` so idle watchdog stays alive. On `node_modules` lock / flaky `ERR_MODULE_NOT_FOUND`, rerun `--no-parallel`; mid-suite corruption → `deno cache --reload` then re-run **only** the failed file.

## Operator tools

- **Hung run**: `data/test/state/logs/`; rerun `deno run --allow-scripts --allow-all -c deno.json <probe.mjs>` with env from the log.
- **OOM / heap**: [heap-snapshots.md](docs/heap-snapshots.md).
- **Deno panic auto-report**: `core/deno_panic.mjs` → GitHub issue on `denoland/deno` (if `gh` installed); dedup `data/test/deno_panics.json`. Override via `FOUNT_DENO_PANIC_REPO`. `testkit` excluded.
- **Selftests**: `fount test testkit`. Fixtures: `selftest/fixtures.mjs` (`makeSuite` / `makeStateEntry`). Keep manifest id `testkit`.
- **Naming**: readable identifiers (`context` not `ctx`). Suite/file/`Deno.test` names use domain semantics — never planning milestone codes.
