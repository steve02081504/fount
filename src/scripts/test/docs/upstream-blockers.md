# Upstream blockers affecting tests

Day-to-day: [AGENTS.md](../AGENTS.md). Do not work around these in fount or in the test — wait for the upstream fix, then bump and re-verify.

## Concurrent `node_modules` corruption (`denoland/deno#35804`)

Parallel `deno test` / `deno run` children against `"nodeModulesDir": "auto"` + `"lock": false` can leave Windows `node_modules/.deno` incomplete ([denoland/deno#35804](https://github.com/denoland/deno/issues/35804)). Symptoms: `Cannot find module` / `NotFound: The system cannot find the path specified` for already-declared npm deps (`etag`, `safer-buffer`, `@opentelemetry/core`, …).

Module-check mutex only serializes spawn→JS-ready ([resource-scheduling.md](resource-scheduling.md)); it does not fix post-ready races. Do not force `--no-parallel` as a product default. After a Deno fix: drop any leftover Windows `--no-parallel` guidance that exists solely for this class of flake.

## Optional native for another OS fails `deno install` (`denoland/deno#36597`)

`deno install` on Linux still resolves every `optionalDependencies` N-API tarball (including `@node-datachannel/android-arm64`). If that package is newer than default `minimumDependencyAge`, install aborts even though npm would skip it (`os`/`cpu` mismatch) and the host only needs `linux-x64-gnu` ([denoland/deno#36597](https://github.com/denoland/deno/issues/36597)). Do not set `--min-dep-age=0` or exclude `@node-datachannel/*` in `deno.json`. After a Deno fix: Linux CI `deno install --prod --allow-scripts` should succeed while a foreign-OS optional native is still inside the 24h window.

## `AbortSignal.timeout` uncaught `TimeoutError` after the consumer finished

`AbortSignal.timeout(ms)` still fires an uncaught `TimeoutError` after `fetch` (or other abortable work) has already completed ([denoland/deno#36588](https://github.com/denoland/deno/issues/36588)). Long suites (`testkit:kernel`, some chat integration files) then fail with Deno’s “dangling promise / timeout handler” uncaught-error wrapper. Do not rewrite call sites to `AbortController` + `clearTimeout` while this is open — wait for Deno, then re-run `fount test testkit:kernel`.

The module-check preload (`hub/clients/module_check.mjs`) uses `AbortSignal.timeout` for the ready POST, so it can strike **any** `serial.mjs` child under concurrency/load — `shells/chat:pure` has since been caught, blaming a different fast module (`http_content_headers` / `inbox_recipients` / `sfw_overlay`) on each flaky run while all its tests pass. Re-run the suite after the Deno fix; do not rewrite the preload call site in the meantime.
