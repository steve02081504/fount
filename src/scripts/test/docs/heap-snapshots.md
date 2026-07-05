# Heap snapshots (OOM)

- **Do not retain settled child task Promises** (Deno [#35798](https://github.com/denoland/deno/issues/35798)): `dependency_scheduler.mjs` tracks in-flight work in a `Record<key, Promise>` and deletes each entry in `.finally()`; piping alone does not fix the leak.
- **Test nodes** (`node/worker.mjs`): write a snapshot when used heap ≥ 95% of `FOUNT_TEST_NODE_HEAP_MB` (default 1024); after exit `launch.mjs` moves `Heap.*.heapsnapshot` from CWD to `data/test/heapsnapshots/` and schedules analysis.
- **Orchestrator / live driver** (`env.mjs`): enabled when `FOUNT_TEST_NODE_WORKER` is unset; limit is `FOUNT_TEST_ORCHESTRATOR_HEAP_MB` or `v8.getHeapStatistics().heap_size_limit`; snapshots go to `data/test/heapsnapshots/` (prefix `orchestrator-`).
- **Auto analysis**: after a snapshot is written, `schedule_heap_snapshot_analysis.mjs` spawns a detached Deno child (12GB heap); report is `<path>.analysis.txt` (top-N self_size by type/name; not allocation stacks).
- **Manual**: `deno run --allow-read src/scripts/test/tools/analyze_heap_snapshot.mjs <path>`; `--needle` filters names.
- If the orchestrator OOMs without a snapshot, heap may have jumped from <95% to the limit within one poll interval; set `FOUNT_TEST_ORCHESTRATOR_HEAP_MB` lower to trigger earlier.
