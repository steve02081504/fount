# Test kernel & display

Detached singleton on `http://127.0.0.1:8903` (`kernel/server.mjs`). CLI `ensure`s it, then `display/` paints. Day-to-day: [AGENTS.md](../AGENTS.md).

## Singleton

A second kernel listen hits `EADDRINUSE` and exits 0; the CLI attaches to the winner.

`fount test --kernel shutdown` POSTs `/shutdown` (abort running suites, drain, exit). Already down is success. Health must identify the test kernel (`kernel` field on `GET /health`); a generic `/health` on that port is not ours and is not SIGTERM'd. If our process ignores `/shutdown` (old build, wedged loop), the CLI SIGTERMs the listener on that port after 2s. `--kernel reboot` is shutdown then `ensure`. Neither enqueues a job.

On Windows the Node `listening` callback can fire before bind (`address()` is `null`). Treat that as `EADDRINUSE` — do not trust the callback alone.

## Watch

`fount test --watch` is a viewer WS (`watch: true`, refcounted). Idle does not keep-awake. The kernel always fs-watches the repo (excludes `.git` / `node_modules` / `debug_logs/` / `data/test/`).

With a `--watch` viewer connected, the kernel auto-runs all suites once after **2 hours** with the run queue empty (measured from the moment the queue last drained, not from any file change — a 2-hour run never triggers an immediate `--all` on finish). The auto-run just enqueues every suite straight into the run queue (no `expandJobWave` / git selection); the idle clock restarts once that run drains. Tunable for tests via `idleAllMs` (`DEFAULT_IDLE_ALL_MS = ms('2h')`).

Any new job submitted via `submitJob` **preempts** idle_all: it clears all not-yet-started `idle_all` FS queue items and aborts any running `idle_all` suite (reason `new_job`), then resets the idle clock so it does not immediately re-fire. A `fount test` typed mid-idle-all therefore takes over the machine without waiting out the whole auto-run.

After a suite finishes, if its manifest `expected` (or any subtest `expected`) drifts from the state baseline beyond the continuous scale-dependent tolerance (`expectedDriftToleranceMs` ≈ `37·scale^0.656` ms — ~2s at 500ms, ~3min at 4min, ~6min at 30min; relative to the larger, after grid rounding; a missing manifest value with a baseline counts as drift), the kernel rewrites the manifest in place and broadcasts `expected-drift`. Same-manifest concurrent writes are serialized; the in-memory `expectedMs` is synced without a full catalog reload. `--update-estimates` remains the full, unconditional rewrite; the drift check is the incremental safety net. Disable with `autoUpdateExpected: false`.

CLI job queue is LIFO among equal `priority` (later enqueued items first; imperfect stays `priority` 0). FS-triggered queue is LIFO. Auto-exit only after **all viewers disconnect** and no jobs remain — an empty CLI job must still deliver `accepted` / `job-done` before the kernel goes away.

## Debug single-step + residue check

`--debug` runs a job's suites one at a time (each suite = one step; the kernel admits at most one running suite while any debug job is active). After each step, and for a whole non-debug run on Windows outside GitHub Actions, the kernel verifies no `%LOCALAPPDATA%\ms-playwright` or `%LOCALAPPDATA%\Temp\fount[-_]*` residue remains (`core/cleanup_check.mjs`). A leak broadcasts `cleanup-leak` (display prints the paths), sets the job exit code `3`, and in debug stops the rest of the job.

## Display

Display must not import `env.mjs` (orchestrator heap-snapshot path). Heap snapshots: [heap-snapshots.md](heap-snapshots.md). CLI `cli.mjs` imports `mark.mjs` first so `FOUNT_TEST` is set before i18n.

Bare `fount test` is always overview (reasons + remaining), even when several suites run. Explicit selectors: 1 true-run → stream, 2+ → multi; 0 true-runs still stream (not a global viewer). `accepted` is sent before any `suite-start`. Per-suite `continueReasons` and snapshot remaining (already-running leftover + queued wait + this wave, not a replay of full durations) travel on `accepted` / queue / end events.

Job viewers (including overview) only receive that job's suite/log events. A second `fount test` must not print another invocation's pass/running status. Hello-before-accepted connections receive nothing. `--watch` still sees the whole kernel. While this job's items are waiting, the kernel sends `job-wait` with `aheadCount` (other jobs' running+queued items + FS queue) — display prints queue depth, not foreign suite names. The last item of a job finishes (`job-done`) before `job-wait`, so a completed job is not advertised as still queued.

Overview/multi do not live-stream suite stdout (parallel runs would interleave). Failed and noisy tails travel on `suite-end.output` and print once at `job-done` so CI last-lines have the error. Stream mode already live-prints and skips the replay.

A default job with nothing imperfect or outdated is `accepted.empty` — print `nothingToContinue`, do not stay silent. Report files are per job/wave, not written when the kernel starts; an empty wave leaves the previous report on disk.

Bare `fount test` (overview) stays until the kernel sends `idle` (both run queues empty). Explicit selector jobs exit on `job-done`. `--watch` ignores both.
