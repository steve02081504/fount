# Upstream blockers affecting tests

Day-to-day: [AGENTS.md](../AGENTS.md). Do not work around these in fount or in the test — wait for the upstream fix, then bump and re-verify.

## Concurrent `node_modules` corruption (`denoland/deno#35804`)

Parallel `deno test` / `deno run` children against `"nodeModulesDir": "auto"` + `"lock": false` can leave Windows `node_modules/.deno` incomplete ([denoland/deno#35804](https://github.com/denoland/deno/issues/35804)). Symptoms: `Cannot find module` / `NotFound: 系统找不到指定的路径` for already-declared npm deps (`etag`, `safer-buffer`, `@opentelemetry/core`, …).

Module-check mutex only serializes spawn→JS-ready ([resource-scheduling.md](resource-scheduling.md)); it does not fix post-ready races. Do not force `--no-parallel` as a product default. After a Deno fix: drop any leftover Windows `--no-parallel` guidance that exists solely for this class of flake.

## `AbortSignal.timeout` uncaught `TimeoutError` after the consumer finished

`AbortSignal.timeout(ms)` still fires an uncaught `TimeoutError` after `fetch` (or other abortable work) has already completed ([denoland/deno#36588](https://github.com/denoland/deno/issues/36588)). Long suites (`testkit:kernel`, some chat integration files) then fail with Deno’s “dangling promise / timeout handler” uncaught-error wrapper. Do not rewrite call sites to `AbortController` + `clearTimeout` while this is open — wait for Deno, then re-run `fount test testkit:kernel`.
