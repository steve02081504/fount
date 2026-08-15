# Resource scheduling & runtime baselines

Suite parallelism is governed by `ResourceRunGate` (`runner/scheduler.mjs`):

- **No idle work** — if any suite is waiting and the machine is empty, admit at least one immediately. Budget never blocks starting work; it only limits packing more alongside running suites. Same invariant in `simulateParallelMakespanMs` (otherwise ETA→0 and the gate deadlocks).
- **`heavy: true`** — machine-exclusive (today: `p2p/sim` only).
- **All other suites** — 2D bin packing on free memory (`freemem × 0.7`) and CPU budget (85% cap). Ready suites acquire in BFD order; waiters wake by fill score `min(memUtil, cpuUtil)`.
- **Module-check mutex** — at most one Deno process may be in the spawn→JS-ready window against the shared `node_modules` ([denoland/deno#35804](https://github.com/denoland/deno/issues/35804)). Parent `acquire`s before spawn; child `env.mjs` or `--preload module_check_ready.mjs` POSTs ready (so `deno test` files that do not import `env.mjs` still signal). Exit without ready is a framework error (`ModuleCheckMissedReadyError`), not a silent release. Spawn failure only abandons the ticket. After ready, wall-clock overlap is allowed. Playwright `node` is not gated. `launchNode` `{ ready, baseUrl }` is too late to use as the signal.

No CLI concurrency knob: suite packing and `serial.mjs` inner file parallelism both use `computeGlobalBudget()`. `serial.mjs` still forces `DENO_JOBS=1` so one file cannot stack parallel `launchNode`s.

## `dependsOn` optimistic overlap

`PlanRunCoordinator` (`runner/dependency_scheduler.mjs`):

- Hard-ready: all in-batch deps resolved **and passed** → normal `acquire`, sorted by footprint BFD (`suiteSchedulePriority`). Same-round hard-ready `tryAcquire` before any speculative fill.
- Speculative: deps still in-flight, **anchored only to hard-running deps** (never stacked on another speculative suite), and `tryAcquire` fits spare budget → start early.
- Speculative sort: proximity to hard-running work first, then cheaper suites (small mem/cpu/baseline).
- Mid-run: all deps pass → promote to hard anchor for the next layer; any dep fails → `AbortSignal` cancel + `awaitCommitGate()` discard (`blocked`).
- Dep fails before start (no spare to speculate) → `discardWithoutRun` blocked.

ETA simulation (`simulateParallelMakespanMs`) uses the same one-layer hard-anchor overlap + promotion rules, plus a serialized module-check timeline (`t_check`).

## Ordering

- **Manifest list / `report.md` slots / dispatch**: same topo + tie-break (`listManifestIds` / `topoSortSuites`). Ready set re-sorted by `suiteSchedulePriority` then bin-packed. CLI queue: later equal-`priority` items first.

## Per-suite footprint

Effective demand = max(manifest `resources`, measured baseline if present else naming heuristic). CPU baselines `< 1%` are treated as sampling noise and ignored.

`run_command.mjs` samples the subprocess tree every 30s via `proc_sample.mjs` (RSS peak → `baselineMemMb`; avg CPU → `baselineCpuPct`). Baselines update on pass or non-watchdog failure.

**Idle / duration / sleep watchdog** (`run_command.mjs`):

- No stdall for `IDLE_TIMEOUT_MS` (10m) → kill as failed.
- Wall runtime over 2× baseline (floor 30m, same as no-baseline default) → kill as failed. Short polluted baselines must not shrink the floor below 30m.
- Watchdog poll gap ≥ `5 × WATCH_INTERVAL_MS` (5×30s) → treat as **system sleep**: abort the suite process and **re-run** from `runSuite` (not recorded as failure). Sleep wins over idle/duration because frozen timers make those clocks meaningless.

**Keep-awake** (proactive, complements sleep retry): kernel holds while a suite is running (`kernel/keep_awake.mjs`). `fount test --watch` idle does not hold. Path wrapper still wraps one-shot CLI as a second belt. Details: [host-keep-awake.md](host-keep-awake.md). Opt out: `FOUNT_TEST_ALLOW_SLEEP=1`.

When `run` includes `serial.mjs`, `suite_run.mjs` injects `FOUNT_TEST_BUDGET_CORES` / `FOUNT_TEST_BUDGET_MEM`. Silent passes emit `[serial] ok …` for idle watchdog liveness.

Selftests: `fount test testkit` (`selftest/resources_scheduler.test.mjs`, `selftest/proc_sample.test.mjs`).
