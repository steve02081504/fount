# Resource scheduling & runtime baselines

Suite parallelism is governed by `ResourceRunGate` (`runner/scheduler.mjs`):

- **No idle work** — if any suite is waiting and the machine is empty, admit at least one immediately. Budget never blocks starting work; it only limits packing more alongside running suites. Same invariant in `simulateParallelMakespanMs` (otherwise ETA→0 and the gate deadlocks).
- **`heavy: true`** — machine-exclusive (today: `p2p/sim` only).
- **All other suites** — 2D bin packing on free memory (`freemem × 0.7`) and CPU budget (85% cap). Ready suites acquire in BFD order; waiters wake by fill score `min(memUtil, cpuUtil)`.
- **`--no-parallel`** — serial gate: one non-heavy suite at a time; also forces `FOUNT_TEST_BUDGET_CORES=1` so `serial.mjs` inner file parallelism collapses to 1.

No CLI concurrency knob: suite packing and `serial.mjs` inner file parallelism both use `computeGlobalBudget()`.

## `dependsOn` optimistic overlap

`PlanRunCoordinator` (`runner/dependency_scheduler.mjs`):

- Hard-ready: all in-batch deps resolved **and passed** → normal `acquire`, sorted by footprint BFD (`suiteSchedulePriority`). Same-round hard-ready `tryAcquire` before any speculative fill.
- Speculative: deps still in-flight, **anchored only to hard-running deps** (never stacked on another speculative suite), and `tryAcquire` fits spare budget → start early.
- Speculative sort: proximity to hard-running work first, then cheaper suites (small mem/cpu/baseline).
- Mid-run: all deps pass → promote to hard anchor for the next layer; any dep fails → `AbortSignal` cancel + `awaitCommitGate()` discard (`blocked`).
- Dep fails before start (no spare to speculate) → `discardWithoutRun` blocked.
- Serial mode: no speculation.

ETA simulation (`simulateParallelMakespanMs`) uses the same one-layer hard-anchor overlap + promotion rules.

## Ordering

- **Manifest list / `report.md` slots / dispatch**: same topo + tie-break (`listManifestIds` / `topoSortSuites`). `--no-parallel` → FIFO = report list order. Parallel → ready set re-sorted by `suiteSchedulePriority` then bin-packed.

## Per-suite footprint

Effective demand = max(manifest `resources`, measured baseline if present else naming heuristic). CPU baselines `< 1%` are treated as sampling noise and ignored.

`run_command.mjs` samples the subprocess tree every 30s via `proc_sample.mjs` (RSS peak → `baselineMemMb`; avg CPU → `baselineCpuPct`). Baselines update on pass or non-watchdog failure.

**Idle / duration / sleep watchdog** (`run_command.mjs`):

- No stdall for `IDLE_TIMEOUT_MS` (10m) → kill as failed.
- Wall runtime over 2× baseline (floor 30m, same as no-baseline default) → kill as failed. Short polluted baselines must not shrink the floor below 30m.
- Watchdog poll gap ≥ `5 × WATCH_INTERVAL_MS` (5×30s) → treat as **system sleep**: abort the suite process and **re-run** from `runSuite` (not recorded as failure). Sleep wins over idle/duration because frozen timers make those clocks meaningless.

**Keep-awake** (proactive, complements sleep retry): [host-keep-awake.md](host-keep-awake.md). Opt out: `FOUNT_TEST_ALLOW_SLEEP=1`.

When `run` includes `serial.mjs`, `suite_run.mjs` injects `FOUNT_TEST_BUDGET_CORES` / `FOUNT_TEST_BUDGET_MEM`. Silent passes emit `[serial] ok …` for idle watchdog liveness.

Selftests: `fount test testkit` (`selftest/resources_scheduler.test.mjs`, `selftest/proc_sample.test.mjs`).
