# Heap snapshots (OOM)

- Do not retain settled child task Promises (Deno [#35798](https://github.com/denoland/deno/issues/35798)): track in-flight work in a `Record` and delete in `.finally()`.
- Mechanism: `v8.setHeapSnapshotNearHeapLimit(N)` / `--heapsnapshot-near-heap-limit=N`. `FOUNT_TEST_HEAP_SNAPSHOT_COUNT` (default 2); `0` disables.
- Test nodes (`node/launch.mjs` + `env.mjs`): `--max-old-space-size` on worker spawn; `v8.setHeapSnapshotNearHeapLimit` in worker; after exit `collectHeapSnapshots` moves files to `data/test/heapsnapshots/`.
- Orchestrator: enabled when `FOUNT_TEST_NODE_WORKER` is unset; optional `FOUNT_TEST_ORCHESTRATOR_HEAP_MB` → `--max-old-space-size` on suite children.
- Auto analysis: `schedule_heap_snapshot_analysis.mjs` → `<path>.analysis.txt`. Manual: `deno run --allow-read src/scripts/test/tools/analyze_heap_snapshot.mjs <path>`.
