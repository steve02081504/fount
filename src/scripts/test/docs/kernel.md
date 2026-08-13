# Test kernel & display

Detached singleton on `http://127.0.0.1:8903` (`kernel/server.mjs`). CLI `ensure`s it, then `display/` paints. Day-to-day: [AGENTS.md](../AGENTS.md).

## Singleton

A second kernel listen hits `EADDRINUSE` and exits 0; the CLI attaches to the winner.

On Windows the Node `listening` callback can fire before bind (`address()` is `null`). Treat that as `EADDRINUSE` — do not trust the callback alone.

## Watch

`fount test --watch` is a viewer WS (`watch: true`, refcounted). Idle does not keep-awake. The kernel always fs-watches the repo (excludes `.git` / `node_modules` / `debug_logs/` / `data/test/`).

CLI job queue is FIFO; FS-triggered queue is LIFO. Auto-exit only after **all viewers disconnect** and no jobs remain — an empty CLI job must still deliver `accepted` / `job-done` before the kernel goes away.

## Display

Display must not import `env.mjs` (orchestrator heap-snapshot path). Heap snapshots: [heap-snapshots.md](heap-snapshots.md). CLI `cli.mjs` imports `mark.mjs` first so `FOUNT_TEST` is set before i18n.

Bare `fount test` is always overview (reasons + remaining), even when several suites run. Explicit selectors: 1 true-run → stream, 2+ → multi. `accepted` is sent before any `suite-start`. Per-suite `continueReasons` and snapshot remaining (running leftover, not a replay of full durations) travel on `accepted` / queue / end events.

Overview/multi do not live-stream suite stdout (parallel runs would interleave). Failed and noisy tails travel on `suite-end.output` and print once at `job-done` so CI last-lines have the error. Stream mode already live-prints and skips the replay.

A default job with nothing imperfect or outdated is `accepted.empty` — print `nothingToContinue`, do not stay silent. Report files are per job/wave, not written when the kernel starts; an empty wave leaves the previous report on disk.

Bare `fount test` (overview) stays until the kernel sends `idle` (both run queues empty). Explicit selector jobs exit on `job-done`. `--watch` ignores both.
