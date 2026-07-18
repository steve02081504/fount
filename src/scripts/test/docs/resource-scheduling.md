# Resource scheduling & runtime baselines

Suite parallelism is governed by `ResourceRunGate` (`runner/scheduler.mjs`):

- **`heavy: true`** — machine-exclusive (today: `p2p/sim` only).
- **All other suites** — 2D bin packing on free memory (`freemem × 0.7`) and CPU budget (85% cap). Ready suites acquire in BFD order; waiters wake by fill score `min(memUtil, cpuUtil)`.
- **`--no-parallel`** — serial gate: one non-heavy suite at a time; also forces `FOUNT_TEST_BUDGET_CORES=1` so `serial.mjs` inner file parallelism collapses to 1.

No CLI concurrency knob: suite packing and `serial.mjs` inner file parallelism both use `computeGlobalBudget()`.

## Ordering

- **Manifest list / `report.md` slots / dispatch**: same topo + tie-break (`listManifestIds` / `topoSortSuites`). `--no-parallel` → FIFO = report list order. Parallel → ready set re-sorted by `suiteSchedulePriority` then bin-packed.

## Per-suite footprint

Effective demand = max of: manifest `resources: { memMb, cpuPct }`, naming heuristics (`core/resources.mjs`), EMA baselines in `data/test/state/main.json`.

`run_command.mjs` samples the subprocess tree every 30s via `proc_sample.mjs` (RSS peak → `baselineMemMb`; avg CPU → `baselineCpuPct`). Baselines update on pass or non-watchdog failure.

When `run` includes `serial.mjs`, `suite_run.mjs` injects `FOUNT_TEST_BUDGET_CORES` / `FOUNT_TEST_BUDGET_MEM`. Silent passes emit `[serial] ok …` for idle watchdog liveness.

Selftests: `fount test testkit` (`selftest/resources_scheduler.test.mjs`, `selftest/proc_sample.test.mjs`).
