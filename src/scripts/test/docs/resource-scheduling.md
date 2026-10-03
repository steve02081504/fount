# Resource scheduling & runtime baselines

Suite parallelism is governed by `ResourceRunGate` (`runner/scheduler.mjs`):

- **No idle work** — if any suite is waiting and the machine is empty, admit at least one immediately. Budget never blocks starting work; it only limits packing more alongside running suites. Same invariant in `simulateParallelMakespanMs` (otherwise ETA→0 and the gate deadlocks).
- **`heavy: true`** — machine-exclusive escape hatch: the suite gets the whole machine and no other suite packs alongside. No manifest in the repo currently sets `heavy` (historically `p2p/sim`).
- **All other suites** — 2D bin packing on the shared global memory budget (below) and CPU budget (85% cap). Ready suites acquire in BFD order; waiters wake by fill score `min(memUtil, cpuUtil)`.
- **Module-check mutex** — at most one Deno process may be in the spawn→JS-ready window against the shared `node_modules` ([denoland/deno#35804](https://github.com/denoland/deno/issues/35804)). Parent `acquire`s before spawn; child `env.mjs` or `--preload module_check_ready.mjs` POSTs ready (so `deno test` files that do not import `env.mjs` still signal). Exit without ready is a framework error (`ModuleCheckMissedReadyError`), not a silent release. Spawn failure only abandons the ticket. After ready, wall-clock overlap is allowed. Playwright `node` is not gated. `launchNode` `{ ready, baseUrl }` is too late to use as the signal.
  - Hold without ready longer than the spawn→ready cap (`3m`, override `FOUNT_TEST_MODULE_CHECK_HOLD_MS`) → release the mutex so later Deno suites can acquire; missed-ready stays on the ticket until the suite exits (or a late ready arrives). Kicking a suite (viewer gone / preempted) releases its ticket **immediately**, without waiting for a possibly-hung child to exit.
  - HTTP `acquire` waiters are cancelled if the client disconnects (aborted fetch / killed `serial.mjs`); a ticket assigned to a dead response is abandoned immediately.

No CLI concurrency knob: suite packing and `serial.mjs` inner file parallelism both use the same shared global budget (below). `serial.mjs` still forces `DENO_JOBS=1` so one file cannot stack parallel `launchNode`s.

## Global resource budget

The gate, the scheduler, and the serial runner share one memory budget, refreshed every 5s: `(available physical/virtual memory + currently-tracked running-suite memory) × 0.7`. Windows reads remaining commit capacity (`MEMORYSTATUSEX.ullAvailPageFile`) through the native API, which includes configured paging capacity without adding physical memory twice. Other platforms use available physical memory plus free swap from `Deno.systemMemoryInfo`; failed probes fall back to `freemem()`. Arbitrary free disk space is not configured swap and is not counted. Adding tracked running-suite memory back keeps the budget from progressively starving as suites start. The CPU side stays the core-count cap (85%). Because a single gate serves every suite, concurrent jobs cannot double-book the machine.

Every budget refresh updates admission and wakes the kernel and unit waiters, even below the 10% display-notification threshold. The CLI queue rotates between jobs, preserving priority/FIFO within each job among tasks that fit: a temporarily oversized queue head does not prevent later independent jobs from using spare capacity. An empty machine still starts one oversized suite. Heavy exclusivity checks both suite slots and unit leases.

## Unit leases

A suite whose `run` uses `serial.mjs` reserves only a small orchestrator base in the gate — the orchestrator process itself is cheap. The memory and CPU its file workers actually consume come from a global per-file "unit lease": each worker calls `POST /unit/acquire` before spawning and `/unit/release` when done (client `hub/clients/unit_lease.mjs`, helper `withUnitLease`). The lease server is global, so leases requested by concurrent suites draw down the same budget and cannot be double-booked. Lease size uses the per-file peak (`baselineUnitMemMb`). Deadlock invariant: a unit is admitted even if it is oversize, provided no unit is currently running — one worker must always be allowed to make progress. Outstanding leases are reclaimed when the suite's gate slot is released (the suite-owning `ResourceRunGate` registers each granted lease under its suite), so a worker killed before `/unit/release` — or a leaked id mapping after a crash — cannot permanently shrink the budget; the reap is idempotent against a late release.

Unit progress also requires treating serial orchestrator slots as waiting infrastructure: if only serial suites hold slots and no unit is running, admit one oversized unit. Non-serial running suites still prevent this bypass. A heavy serial suite may acquire its own unit leases; foreign units wait until it releases exclusivity. Finishing a suite rejects its queued unit requests before reclaiming running leases, and all release functions are idempotent.

Unit lease waiters also rotate between suites, preserving request order inside each suite. A full suite cannot reserve every future worker slot with its backlog before a later focused suite gets a turn. New suites join the round tail; suites that do not fit current spare capacity are temporarily skipped. Running workers are never preempted, so latency still includes already-running workers and any exclusive suite.

## `dependsOn` optimistic overlap

`PlanRunCoordinator` (`runner/dependency_scheduler.mjs`):

- Hard-ready: all in-batch deps resolved **and passed** → normal `acquire`, sorted by footprint BFD (`suiteSchedulePriority`). Same-round hard-ready `tryAcquire` before any speculative fill.
- Speculative: deps still in-flight, **anchored only to hard-running deps** (never stacked on another speculative suite), and `tryAcquire` fits spare budget → start early.
- Speculative sort: proximity to hard-running work first, then cheaper suites (small mem/cpu/baseline).
- Mid-run: all deps pass → promote to hard anchor for the next layer; any dep fails → `AbortSignal` cancel + `awaitCommitGate()` discard (`blocked`).
- Dep fails before start (no spare to speculate) → `discardWithoutRun` blocked.

ETA simulation (`simulateParallelMakespanMs`) uses the same one-layer hard-anchor overlap + promotion rules, plus a serialized module-check timeline (`t_check`).

Full-run ETA prefers the measured suite wall baseline (`baselineDurationMs`) over the Σ-subtest + overhead estimate, because internally-parallel suites (e.g. a Playwright process running multiple spec files) would otherwise be double-counted. Subtest subsets still sum per-subtest timings.

Displayed "remaining"/ETA is not monotonic: it is recomputed from an ideal timeline rebuilt from real current state (queues + running + budget) each time a scheduling-affecting change happens, so the total can legitimately go up or down as state changes — e.g. re-packing, a late-admitted long suite landing on the critical path, or new insertions (`cli`/`fs`/`prep`). There is no monotonic clamp; every such change broadcasts a `schedule-update` carrying a per-consumer projection (`running` + `lastCompletionMs` + a `reason`), and consumers paint on a ~5% change vs last shown. `idle_all` does count as an insertion: it enqueues every suite and broadcasts `queue-append` (reason `idle_all`) for each, then participates in the broadcast/plan like any other queue growth; a new job preempts it via `queue-remove`.

## Ordering

- **Manifest list / `report.md` slots / dispatch**: same topo + tie-break (`listManifestIds` / `topoSortSuites`). Ready set re-sorted by `suiteSchedulePriority` then bin-packed. CLI queue: jobs take turns; priority and FIFO are local to each job. New jobs join the round tail, so focused invocations need not wait for an entire full run, and older jobs cannot be starved by continuous new arrivals.

## Per-suite footprint

Effective demand = max(manifest `resources`, measured baseline if present else naming heuristic). CPU baselines `< 1%` are treated as sampling noise and ignored.

`core/proc_sample.mjs` takes ONE shared process-table snapshot every 2s covering all running suites (no per-suite sampling). For each suite tree, CPU is consumed CPU time / wall time / core count, so short-lived children that exit between snapshots are still counted rather than missed; memory is the peak RSS of the suite tree (`baselineMemMb`). A serial suite's file workers additionally report a per-file peak (`baselineUnitMemMb`) used to size the unit leases above. Baselines update on pass or non-watchdog failure.

**Idle / duration / sleep watchdog** (`run_command.mjs`):

- No stdall for `IDLE_TIMEOUT_MS` (10m) → kill as failed.
- Wall runtime over 2× baseline (floor 30m, same as no-baseline default) → kill as failed. Short polluted baselines must not shrink the floor below 30m.
- Watchdog poll gap ≥ `5 × WATCH_INTERVAL_MS` (5×30s) → treat as **system sleep**: abort the suite process and **re-run** from `runSuite` (not recorded as failure). Sleep wins over idle/duration because frozen timers make those clocks meaningless.

**Keep-awake** (proactive, complements sleep retry): kernel holds while a suite is running (`kernel/keep_awake.mjs`). `fount test --watch` idle does not hold. Path wrapper still wraps one-shot CLI as a second belt. Details: [host-keep-awake.md](host-keep-awake.md). Opt out: `FOUNT_TEST_ALLOW_SLEEP=1`.

When `run` includes `serial.mjs`, its file workers draw their share from the global unit leases (above); the suite itself holds only the orchestrator base in the gate. Silent passes emit `[serial] ok …` for idle watchdog liveness.

Selftests: `fount test testkit` (`selftest/resources_scheduler.test.mjs`, `selftest/proc_sample.test.mjs`).
