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
- **Run report**: `data/test/report.md` + `report.json` — last run only. **Suite sum** = non-reused slot durations; **wall clock** = run span; **parallel rate** = suite sum / wall clock × 100% − 100% (≈0% serial, higher when suites overlap). Each real run logs **expected** duration from `baselineDurationMs` at `>>> 正在运行`. **Trigger reasons** (`continueReason`) are split into `data/test/triggered-reasons.md` (linked from `report.md`); `report.json` still carries per-slot reasons. `--continue`: [continue-report.md](docs/continue-report.md).
- **`--outdated`**: trigger-relevant files changed since the recorded commit, plus never-run suites.
- **`--no-parallel`**: serial execution. Default: [resource-scheduling.md](docs/resource-scheduling.md). **Prefer `--no-parallel`** for local verification and `--continue` reruns while Deno parallel scheduling is flaky.
- **Rerun reuse**: at dispatch time each selected suite is reused (not re-run, `ranAt`/`durationMs`/baselines untouched, report marks `（复用）` and reports a `复用数`) when its last result was real (passed/**failed**/noisy — failures included) and nothing relevant changed since that run: commits since `entry.commitHash` don't hit its `triggers` **and** its trigger-relevant uncommitted file contents are byte-identical (`entry.triggerHash`, a digest over just those files — committed content is covered by the commit check, so it isn't read). This is finer than `isSuiteOutdated`, which flags a long-dirty trigger file forever; `triggerHash` compares against the *last run*, not the last commit. `isSuiteReusable`/`computeSuiteTriggerHash` live in `core/state.mjs`; uncommitted file contents are read **once** into a `rel→sha256` map (`hashUncommittedFiles` in `core/changed.mjs`) that both the global `uncommittedHash` and every per-suite `triggerHash` fold from via `digestFileHashes` — no per-suite re-reads, one hashing algorithm. **`--force`** disables reuse for the whole run (real re-run, e.g. to chase flakiness or retry a deterministic failure).
- **`dependsOn`**: runtime gate (`manifest:suite` or same-manifest name). Unmet deps → `blocked`. Exact selector match (`prefixExpand: false`).
- **Suite selectors** (`manifest:suite`): a selector that is itself a full suite id/name is exact — `shells/chat:fed_emoji` runs only `fed_emoji`, never `fed_emoji_nearcache`/`_nonmember`. Prefix expansion (`fed` → `fed_*`) only kicks in when no suite is named exactly that. Explicit `*`/`?` always globs. (Dependencies still pull in via `dependsOn`, that's not prefix matching.)
- **Ordering & dispatch**: manifest list order, `report.md` slot order, and serial-vs-parallel dispatch share the same topo + tie-break rules; under `--no-parallel` execution order = report list order. Details: [resource-scheduling.md](docs/resource-scheduling.md).
- **Live driver**: `live/runner.mjs` — ephemeral nodes, `FOUNT_TEST_NODE_*` env, teardown after.

### Framework libs

| Module | Role |
| --- | --- |
| `live/deno_run.mjs` | `denoLiveRun()` argv builder |
| `live/http.mjs` | fetch, multipart, `PollUntil` / `sleep` |
| `live/env.mjs` | `FOUNT_TEST_BASE_URL` / `FOUNT_API_KEY` |
| `core/state.mjs` | state DB read/write/upsert |
| `core/dependencies.mjs` | `dependsOn` resolve, topo sort, expansion |
| `core/deno_panic.mjs` | detect `Deno has panicked` in suite output → gh auto-issue |
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
- **`dependsOn`**: expand transitive deps for upstream gating; block downstream when upstream is not green at the current fingerprint. **Explicit suite names** (`manifest:suite`): only `expandWithDependencies` — pull non-green upstream (trigger hit / failed / never run); **no** `expandWithDependents`. Diff/outdated/continue: `expandWithDependents` fires **only on trigger-outdated** parents and pulls **just one downstream level** (direct dependents), then `expandWithDependencies` for non-green upstream. Rationale: a real fix always edits relevant files → those files hit the downstream's own triggers when it truly matters; a parent that merely re-ran and passed (or only drifted commit) must **not** cascade — otherwise editing `server` would snowball the whole tree across `--continue`. Deeper layers propagate only when their own triggers fire. Upstream gating uses **`isDependencySatisfied`** (passed/noisy + trigger-fresh); commit / uncommittedHash drift does not pull dependencies nor re-run a passed suite. There is **no** commit-drift-only rerun and no `ranAt`-based cascade.
- **Live layering** (avoid re-probing the same failure in every suite): `server:live` → `smoke_chat` → `e2e_single` → `e2e_single_ext` / `frontend`; Social: `server:live` → `smoke_social` → `e2e_single` → `frontend` (`integration/posts_http` covers HTTP POST before live); WS chain `ws` → `ws_rpc` → `ws_stream` (`av_relay` after `ws`); federation `p2p:live` + `p2p:sim` → `fed_core` → feature suites; cross-shell fed probes depend on `shells/chat:fed_core` + `fed_emoji` + `smoke_social`, not full social e2e.
- **Browser scripts**: paths under `/scripts/*` map to `src/public/pages/scripts/` (e.g. `/scripts/test/ready_gate.mjs` → `public/pages/scripts/test/ready_gate.mjs`; shared P2P pure helpers → `public/pages/scripts/p2p/`). Shell `public/**` must import these via absolute `/scripts/...` URLs — relative `../../../../scripts/p2p/` escapes to the same URL but is easy to break. Do not import `/scripts/test/*` from Deno-only trees.
- **`heavy`**: machine-exclusive scheduling — [resource-scheduling.md](docs/resource-scheduling.md).
- **`resources`**: optional `{ "memMb", "cpuPct" }`; omitted fields use heuristics + learned baselines.

## New live tests

- Deno `.mjs` via `denoLiveRun(path)` or a part-local `run.mjs` — no PowerShell probes.
- **Permission flags invariant**: every deno `run`/`test`/`install` invocation across the whole project (launchers `path/fount.*` + bootstrap `path/fount.mjs`, `deno.json` tasks, CI workflows, manifest `run`, test-framework child spawns, standalone scripts like `subfount.mjs` / `sim/cli.mjs`) carries **both** `--allow-scripts --allow-all`, in that order — never just one. `--allow-scripts` lets Deno run npm lifecycle scripts (postinstall) so native addons (argon2, node-datachannel, bluetooth/usb/serialport bindings) actually build; without it Deno silently extracts the package, writes `.scripts-warned`, and leaves `build/Release/*.node` empty. When adding any new deno spawn, keep the pair together. **Sole exception**: `deno cache` (the serial-runner prewarm) takes `--allow-scripts` alone because `deno cache` has no `--allow-all` flag — it builds native addons up front to avoid parallel build races.
- Native-addon / WebRTC: one `.test.mjs` per Deno child when the addon panics under reuse (common on Windows). **`p2p:live`** needs `node-datachannel` native build; because every test child now passes `--allow-scripts`, Deno builds it (and self-heals a prior `.scripts-warned`) on first run — no manual `deno install --allow-scripts` after clone. **Symptom if the flag is ever dropped**: the addon dir under `node_modules/.deno/node-datachannel@*/` carries `.scripts-warned` (no `.scripts-run`) and `build/Release` is empty, nodes still boot fine, but every federation suite fails with `peers: 0` / `members>=2` gate never satisfied. Verify with `deno test --no-check --allow-scripts --allow-all -c ./deno.json ./src/scripts/p2p/test/live/link_smoke.test.mjs`.
- Single-node: `{ p2p: false, minP2pNode: true }`. P2P signaling: [p2p/docs/signaling.md](../p2p/docs/signaling.md).
- Federation live probes: reuse `InitializeOpenGroupJoin` / `InitializeOpenGroupJoinMulti` from `live/federation/common.mjs` (they bundle `WarmupFedNodeLinks` → `rebind` → members gate → re-invite fallback). A hand-rolled bare join (create → invite → join) with no warmup/rebind will hang at `members>=2`. A `members>=2` hang is usually a real link/handshake or ICE bug, not flakiness — inspect handshake/ICE logs before rerunning (signaling traps: [p2p/docs/signaling.md](../p2p/docs/signaling.md)).
- Federation convergence assertions should prefer semantic helpers (`TestFedHasMessage`, `TestFedHasReaction`, etc.) over raw `GET /events?limit=...` scans: event streams are paged/windowed and can miss the target row even when ingestion succeeded, causing false negatives.

## Operator tools

- **Hung run**: `data/test/state/logs/`; rerun `deno run --allow-scripts --allow-all -c deno.json <probe.mjs>` with env from the log.
- **OOM / heap**: [heap-snapshots.md](docs/heap-snapshots.md).
- **Deno panic auto-report** (`core/deno_panic.mjs`): a suite emitting `Deno has panicked. This is a bug in Deno.` triggers `parseDenoPanic` (extracts `panicked at <file>:<line>:<col>` + Deno version). If `gh` is installed & authed, files an issue on `denoland/deno` (English body: log excerpt + version + fount commit hash); if an upstream issue already matches, it only records locally and skips. Dedup lives in `data/test/deno_panics.json`, keyed by `file:line:col`; the file also stores the Deno version and is wiped on version drift. `testkit` self-tests are skipped so panic fixtures never fire real reports. Override target repo for testing via `FOUNT_DENO_PANIC_REPO` (e.g. point at `steve02081504/fount`, then close the probe issue).
- **Selftests**: `selftest/` — `fount test testkit`. One suite per `*.test.mjs` (suite name = file basename, e.g. `fount test testkit:continue_reason`); each suite's `triggers` point at the framework modules it exercises so `--outdated`/failure-retry stay per-file. Any edit under `src/scripts/test/**` still hits the infra escape hatch (`selectSuitesByDiff` → `infraHit` runs **all** manifests), so per-suite triggers matter for `--outdated`/explicit selection, not plain diff. Keep manifest id `testkit` — the panic auto-report skip (`runner/index.mjs`) keys on it.
- **Naming**: prefer readable identifiers in framework code — `context` not `ctx`, module `core/dependencies.mjs` not `deps.mjs`, topo maps named `dependencyEdges` not `deps`.
