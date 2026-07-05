# Resource scheduling & runtime baselines

## Overview

Suite parallelism is governed by `ResourceRunGate` (`runner/scheduler.mjs`):

- **`heavy: true`** — machine-exclusive (today: `p2p/sim` only). No other suite runs while active.
- **All other suites** — 2D bin packing on **free memory** (`freemem × 0.7`) and **CPU budget** (85% cap, `CPU_BUDGET_PCT` in `baseline.mjs`).
- Ready suites acquire slots in **BFD order** (`suiteSchedulePriority` in `resources.mjs`). Waiters wake by **fill score** `min(memUtil, cpuUtil)`.
- **`--no-parallel`** — serial gate (`serial: true`): one non-heavy suite at a time, streamed stdout/stderr. Default runs buffer per-suite output and print summaries.

No CLI concurrency knob: suite packing and `serial.mjs` inner file parallelism both use `computeGlobalBudget()` (CPU thread count + `freemem × 0.7`).

## Per-suite footprint

Effective demand = max of three sources (`resolveSuiteResources`):

1. manifest `resources: { "memMb": M, "cpuPct": P }`
2. naming heuristics in `core/resources.mjs` (`inferDefaultResources`)
3. EMA baselines in `data/test/state/main.json` (`baselineMemMb`, `baselineCpuPct`)

Both dimensions are **scheduling budgets** (0–100 for `cpuPct` = expected share of machine CPU). Defaults are hand-tuned; baselines learn from runs.

## Runtime sampling

`run_command.mjs` samples the suite subprocess tree every 30s via `proc_sample.mjs`:

- **Memory** — `pidusage` aggregate RSS peak → `peakMemMb` → EMA `baselineMemMb` (N=4).
- **CPU** — `pidusage` aggregate CPU ÷ core count, capped 0–100 → `avgCpuPct` → EMA `baselineCpuPct` (N=8).

Process tree enumeration: Unix `node-os-utils process.list`; Windows PowerShell `Get-CimInstance Win32_Process` (`byPid` is unavailable on Win32).

Baselines update on pass or non-watchdog failure (`shouldRecordTimingBaseline`).

## `serial.mjs` budget

When `run` includes `serial.mjs`, `suite_run.mjs` injects `FOUNT_TEST_BUDGET_CORES` / `FOUNT_TEST_BUDGET_MEM` from the global budget. Not tied to `heavy`.

## Diagnostics

Compare `pidusage` vs `node-os-utils process.byPid` on a live tree:

```bash
deno run --allow-all -c ./deno.json ./src/scripts/test/tools/probe_pid_sampling.mjs
```

Selftests: `fount test testkit` (`selftest/resources_scheduler.test.mjs`, `selftest/proc_sample.test.mjs`).
