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
- Speculative: deps still in-flight, **anchored only to hard-running deps** (never stacked on another speculative suite), and `tryAcquire` fits spare budget → start early. **Spare fill is intentional**: other hard suites may already be running or queued for more capacity; as long as crumbs fit, speculate.
- Speculative sort is a **separate pool**: proximity to hard-running work (same manifest / more hard anchors) first, then cheaper suites (small mem/cpu/baseline) so a wrong prediction wastes less. Not the hard-ready footprint weight.
- Mid-run: if all deps pass, the speculative suite is **promoted** to a hard anchor so the next layer may overlap its remaining work. If any dep fails, `AbortSignal` cancels the suite process early; `awaitCommitGate()` then discards (record `blocked`, keep output/log).
- If a dep fails before the dependent starts (no spare room to speculate) → `discardWithoutRun` blocked, no suite process.
- Serial mode: no speculation.

ETA simulation (`simulateParallelMakespanMs`) uses the same one-layer hard-anchor overlap + promotion rules so parallel-rate estimates match.

## Ordering

- **Manifest list / `report.md` slots / dispatch**: same topo + tie-break (`listManifestIds` / `topoSortSuites`). `--no-parallel` → FIFO = report list order. Parallel → ready set re-sorted by `suiteSchedulePriority` then bin-packed.

## Per-suite footprint

Effective demand = max(manifest `resources`, measured baseline if present else naming heuristic). CPU baselines `< 1%` are treated as sampling noise and ignored.

`run_command.mjs` samples the subprocess tree every 30s via `proc_sample.mjs` (RSS peak → `baselineMemMb`; avg CPU → `baselineCpuPct`). Baselines update on pass or non-watchdog failure.

When `run` includes `serial.mjs`, `suite_run.mjs` injects `FOUNT_TEST_BUDGET_CORES` / `FOUNT_TEST_BUDGET_MEM`. Silent passes emit `[serial] ok …` for idle watchdog liveness.

Selftests: `fount test testkit` (`selftest/resources_scheduler.test.mjs`, `selftest/proc_sample.test.mjs`).
