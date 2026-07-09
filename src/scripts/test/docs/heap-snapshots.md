# Heap snapshots (OOM)

- **Do not retain settled child task Promises** (Deno [#35798](https://github.com/denoland/deno/issues/35798)): `dependency_scheduler.mjs` tracks in-flight work in a `Record<key, Promise>` and deletes each entry in `.finally()`; piping alone does not fix the leak.
- **Mechanism**: `v8.setHeapSnapshotNearHeapLimit(N)` / `--heapsnapshot-near-heap-limit=N` — V8 writes `Heap.*.{pid}.*.heapsnapshot` when approaching `--max-old-space-size` (or process default heap limit). `FOUNT_TEST_HEAP_SNAPSHOT_COUNT` (default 2) controls N; `0` disables.
- **Test nodes** (`node/launch.mjs` + `env.mjs`): `--max-old-space-size` on worker spawn; `v8.setHeapSnapshotNearHeapLimit` in worker (Deno rejects the CLI flag via `--v8-flags`); after exit `collectHeapSnapshots` moves files to `data/test/heapsnapshots/` and schedules analysis.
- **Orchestrator / live driver** (`env.mjs`): enabled when `FOUNT_TEST_NODE_WORKER` is unset; snapshots relocated to `data/test/heapsnapshots/` (prefix `orchestrator-`).
- **Orchestrator heap cap**: optional `FOUNT_TEST_ORCHESTRATOR_HEAP_MB` → `--max-old-space-size` on suite `deno run` children (`suite_run.mjs`).
- **Auto analysis**: after a snapshot is written, `schedule_heap_snapshot_analysis.mjs` spawns a detached Deno child (12GB heap); report is `<path>.analysis.txt` (top-N self_size by type/name; not allocation stacks).
- **Manual**: `deno run --allow-read src/scripts/test/tools/analyze_heap_snapshot.mjs <path>`; `--needle` filters names.
