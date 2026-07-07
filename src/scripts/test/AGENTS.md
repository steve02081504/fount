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
- **Run report**: `data/test/report.md` + `report.json` — last run only; non-specified suites show **触发原因** (`continueReason`). `--continue`: [continue-report.md](docs/continue-report.md).
- **`--outdated`**: trigger-relevant files changed since the recorded commit, plus never-run suites.
- **`--no-parallel`**: serial execution. Default: [resource-scheduling.md](docs/resource-scheduling.md). **Prefer `--no-parallel`** for local verification and `--continue` reruns while Deno parallel scheduling is flaky.
- **`dependsOn`**: runtime gate (`manifest:suite` or same-manifest name). Unmet deps → `blocked`. Exact selector match (`prefixExpand: false`).
- **Manifest 列表顺序**：`listManifestIds` — 依赖在前；否则被依赖数少→前、依赖数少→前、字典序。
- **`report.md` 槽位顺序**：`RunReportWriter` / `topoSortSuites` — 同上规则（suite 级；tie-break 用全库计数）。
- **Live driver**: `live/runner.mjs` — ephemeral nodes, `FOUNT_TEST_NODE_*` env, teardown after.

### Framework libs

| Module | Role |
| --- | --- |
| `live/deno_run.mjs` | `denoLiveRun()` argv builder |
| `live/http.mjs` | fetch, multipart, `PollUntil` / `sleep` |
| `live/env.mjs` | `FOUNT_TEST_BASE_URL` / `FOUNT_API_KEY` |
| `core/state.mjs` | state DB read/write/upsert |
| `core/deps.mjs` | `dependsOn` resolve, topo sort, expansion |
| `runner/suite_run.mjs` | `buildSuiteInvocation` / `runSuite` |
| `runner/continue_reason.mjs` | `--continue` slot reasons → report |

## Taxonomy

| Kind | Meaning |
| --- | --- |
| `pure/` | Zero I/O |
| `integration/` | Single-process; no real HTTP/WS node |
| `live/` | Real fount node + HTTP/WS |
| `frontend/` | Playwright (`playwright/`) |
| `sim/` | In-process simulation harness |

Manifest id = domain (`server`, `testkit`, `p2p`, `shells/chat`, …).

## Manifest fields

- **`triggers`**: diff selection — glob match on changed files. Default ignores docs/metadata; override via **`triggerFilter`**: [trigger-filter.md](docs/trigger-filter.md). Shell manifests partition **backend** (`src/**`), **per-suite test dirs**, and **frontend** (`public/**`, `test/frontend/**`) so test-only or UI changes do not fan out to unrelated suites.
- **`dependsOn`**: expand transitive deps; block downstream when upstream is not green at the current fingerprint. **Explicit suite names** (`manifest:suite`): only `expandWithDependencies` — pull non-green upstream (trigger hit / failed / never run); **no** `expandWithDependents`. Diff/outdated/continue: `expandWithDependents` only when parent is trigger-outdated or imperfect, then `expandWithDependencies` for non-green upstream. Upstream gating uses **`isDependencySatisfied`** (passed/noisy + trigger-fresh); commit / uncommittedHash 漂移不拉间接依赖。`commit_mismatch` 仅显式指名或 `--continue` 无历史不完美项时作为 seed 重跑。
- **Live layering** (avoid re-probing the same failure in every suite): `server:live` → `smoke_chat` → `e2e_single` → `e2e_single_ext` / `frontend`; Social: `server:live` → `smoke_social` → `e2e_single` → `frontend` (`integration/posts_http` covers HTTP POST before live); WS chain `ws` → `ws_rpc` → `ws_stream` (`av_relay` after `ws`); federation `p2p:live` + `p2p:sim` → `fed_core` → feature suites; cross-shell fed probes depend on `shells/chat:fed_core` + `fed_emoji` + `smoke_social`, not full social e2e.
- **Browser scripts**: paths under `/scripts/*` map to `src/public/pages/scripts/` (e.g. `/scripts/test/ready_gate.mjs` → `public/pages/scripts/test/ready_gate.mjs`; shared P2P pure helpers → `public/pages/scripts/p2p/`). Shell `public/**` must import these via absolute `/scripts/...` URLs — relative `../../../../scripts/p2p/` escapes to the same URL but is easy to break. Do not import `/scripts/test/*` from Deno-only trees.
- **`heavy`**: machine-exclusive scheduling — [resource-scheduling.md](docs/resource-scheduling.md).
- **`resources`**: optional `{ "memMb", "cpuPct" }`; omitted fields use heuristics + learned baselines.

## New live tests

- Deno `.mjs` via `denoLiveRun(path)` or a part-local `run.mjs` — no PowerShell probes.
- Native-addon / WebRTC: one `.test.mjs` per Deno child when the addon panics under reuse (common on Windows). **`p2p:live`** needs `node-datachannel` native build — run once after clone: `deno install --allow-scripts=npm:node-datachannel --entrypoint ./src/scripts/p2p/test/live/link_smoke.test.mjs` (requires `deno.json` `"nodeModulesDir": "auto"`).
- Single-node: `{ p2p: false, minP2pNode: true }`. P2P signaling: [p2p/docs/signaling.md](../p2p/docs/signaling.md).

## Operator tools

- **Hung run**: `data/test/state/logs/`; rerun `deno run --allow-all -c deno.json <probe.mjs>` with env from the log.
- **OOM / heap**: [heap-snapshots.md](docs/heap-snapshots.md).
- **Selftests**: `selftest/` — `fount test testkit`.
