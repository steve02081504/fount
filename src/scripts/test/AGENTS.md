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
- **Run report**: `data/test/report.md` + `report.json` — last run only. `--continue`: [continue-report.md](docs/continue-report.md).
- **`--outdated`**: trigger-relevant files changed since the recorded commit, plus never-run suites.
- **`--no-parallel`**: serial execution. Default: [resource-scheduling.md](docs/resource-scheduling.md).
- **`dependsOn`**: runtime gate (`manifest:suite` or same-manifest name). Unmet deps → `blocked`. Exact selector match (`prefixExpand: false`).
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

- **`triggers`**: diff selection — glob match on changed files. Default ignores docs/metadata; override via **`triggerFilter`**: [trigger-filter.md](docs/trigger-filter.md).
- **`dependsOn`**: expand transitive deps; block downstream when upstream is not green at the current fingerprint.
- **`heavy`**: machine-exclusive scheduling — [resource-scheduling.md](docs/resource-scheduling.md).
- **`resources`**: optional `{ "memMb", "cpuPct" }`; omitted fields use heuristics + learned baselines.

## New live tests

- Deno `.mjs` via `denoLiveRun(path)` or a part-local `run.mjs` — no PowerShell probes.
- Native-addon / WebRTC: one `.test.mjs` per Deno child when the addon panics under reuse (common on Windows).
- Single-node: `{ p2p: false, minP2pNode: true }`. P2P signaling: [p2p/docs/signaling.md](../p2p/docs/signaling.md).

## Operator tools

- **Hung run**: `data/test/state/logs/`; rerun `deno run --allow-all -c deno.json <probe.mjs>` with env from the log.
- **OOM / heap**: [heap-snapshots.md](docs/heap-snapshots.md).
- **Selftests**: `selftest/` — `fount test testkit`.
