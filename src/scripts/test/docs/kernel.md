# Test kernel & display

Detached singleton on `http://127.0.0.1:8903` (`kernel/server.mjs`). CLI `ensure`s it, then `display/` paints. Day-to-day: [AGENTS.md](../AGENTS.md).

## Singleton

A second kernel listen hits `EADDRINUSE` and exits 0; the CLI attaches to the winner.

On Windows the Node `listening` callback can fire before bind (`address()` is `null`). Treat that as `EADDRINUSE` — do not trust the callback alone.

## Watch

`fount test --watch` is a viewer WS (`watch: true`, refcounted). Idle does not keep-awake. The kernel always fs-watches the repo (excludes `.git` / `node_modules` / `debug_logs/` / `data/test/`).

CLI job queue is FIFO; FS-triggered queue is LIFO.

## Display

Display must not import `env.mjs` (orchestrator heap-snapshot path). Heap snapshots: [heap-snapshots.md](heap-snapshots.md).
