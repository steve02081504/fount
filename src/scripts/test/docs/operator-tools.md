# Test Operator Tools

Deep detail for `fount test` operator diagnostics. The day-to-day guide is [../AGENTS.md](../AGENTS.md); watchdogs / sleep retry / baselines live in [host-keep-awake.md](host-keep-awake.md) and [resource-scheduling.md](resource-scheduling.md).

## Performance bench (`tools/bench/`)

Five standalone scripts break down `fount test` / launcher wall time:

- `kernel_startup.mjs` — spawn→healthy with an in-kernel phase split (init/link, graph eval, catalog load, bind)
- `kernel_link.mjs` — Deno init+link vs graph eval vs kernel logic, plus `deno cache` cost
- `test_cycle.mjs` — per-suite child spawn/read/rm overhead via the real `buildSuiteInvocation`/`runCommand`
- `viewer_cycle.mjs` — WS connect→hello→accepted→close round trips
- `cli_startup.mjs` — launcher floor (`fount nop`) and `fount eval "1"` echo vs `deno eval` / `pwsh` / `powershell.exe` interpreter startup; the `fount eval` row is measured only when a server answers `data/config.json`'s port (`/api/ping`), otherwise it is skipped with a note. Use it when changing the path prelude, the runner, or `cmd_eval`.

The kernel records env-gated phases to `FOUNT_TEST_BENCH_PHASES_FILE` (`onPhase` callback through `startTestKernel`/`TestKernel.start`); tools spawn on `TEST_PORT_BASE+20000` and shut down each iteration. Run from the repo root:

```
deno run --allow-scripts --allow-all -c ./deno.json ./src/scripts/test/tools/bench/<tool>.mjs [iterations]
```

Hot spots are Deno-runtime-bound: cold `deno cache` + graph eval dominate kernel startup; per-suite `deno test --no-check` child spawn ≈120ms. Performance-critical structure: port liveness probes live in shared `src/scripts/listener.mjs` (`listenerPid`/`isPortListening`/`parseNetstatListenPid`); kernel shutdown + `kernelHealthy` check the port first (netstat/lsof) instead of waiting the 1.5s health-check timeout on a closed Windows port (`ensure.mjs`); manifest discovery walks directories with bounded concurrency (`findManifestFilesParallel`, `manifest.mjs`).

## Isolation runs

Manual `run.mjs` / `deno test` isolation runs must be alone: a live kernel (watch mode or an in-flight job) running the same suite in parallel competes for ports/CPU and produces phantom flaky failures (e.g. Playwright 120s timeouts on dropdown interactions with the menu visibly open, `error-context.md` timestamps that predate your run). Before trusting an isolation run: `fount test --kernel shutdown` first; if `data/test/playwright/<scope>/` shows artifact dirs for tests you did not run (fresh timestamps, other test names), a parallel job is still writing — wait it out or find the process. Note `--kernel shutdown` does not kill an already-running job's playwright child; it finishes writing to the same `outputDir`.

## Temp-dir leak check

`fount[-_]*` Temp entries are leak-checked at job end: every kernel job records a Temp baseline at submit and `#checkCleanupLeak` reports only entries **created during the job** that still exist when it finishes (exit 3) — this is what keeps concurrent jobs (incl. selftest-spawned kernels) from flagging each other's live dirs. So keep scratch dirs under the `fount[-_]` prefix (that is what makes them leak-checked), and **always clean them up in a `finally`** — there is no prefix-based escape hatch. Long-lived fount data dirs (`fount_node_*`, `fount_test_*`) register via `FOUNT_TEST_DATA_DIRS_OUT` for `serial.mjs` to reap; `launchNode`'s failure path reaps its own mkdtemp dataDir + test relay. Hand-built kernel jobs (selftest `enqueueDummyJob`) must carry `cleanupBaseline: findCleanupLeaks()` — they bypass `submitJob`.

## Temp origin marker

`core/temp_origin.mjs` writes `origin.txt` (creator description + ISO timestamp, best-effort) into every `fount[-_]*` scratch dir at creation (system Temp or `data/test`) — `suite_run.mjs` (suite dirs), `launch.mjs` (node dataDirs), `boot.mjs` (shared/caller dataDirs), `deno_panic.mjs`, `phases.mjs` (playwright jsonReportDir), and `routes_http.test.mjs` (scenarios). **When investigating leftover Temp dirs, first read `<dir>/origin.txt` to see who created it** — do not reverse-engineer the source. If the file is absent, the dir predates the marker or the creator never marked it; then check `git log` / call sites.
