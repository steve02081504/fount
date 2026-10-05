# Runtime tool benchmark

Run from the repository root with Deno:

```powershell
deno run --allow-scripts --allow-all -c ./deno.json ./src/scripts/test/tools/bench/runtime_tools.mjs
```

`--iterations=N` chooses the measured sample count (default 9; must be a positive integer) and `--output=PATH` writes the JSON result to a file instead of stdout. Each case runs one cold call, two warmups and then the requested measured calls. "Cold" means the first invocation of that case in the running benchmark process, not a fresh process or OS cold start. Correctness checks run after the timed interval. The output carries warm median and p95 latency, cold latency and UTF-8 result bytes.

Cases cover real `run-js`, short Windows shell startup, three equivalent commands as three independent shell calls versus one batched call, and 16,000 characters of shell output. The output fixture stays below the output guard's 20,000-character persistence threshold, so the benchmark creates no guard spill file. Sub-agent cases use the real `runSubAgent` loop with an injected deterministic fake AI source and no-op persistence/notification dependencies; they cover one and three model rounds in synchronous and asynchronous completion modes. Sub-agent JSON also reports fake model call count and serialized prompt/output bytes.

The fake AI keeps sub-agent measurements local and repeatable, so those numbers measure the generation loop and injected dependencies only; they do not represent model latency, provider tokenization, token billing or API cost. Prompt byte counts are UTF-8 bytes of the serialized prompt object passed to the fake `StructCall`, not provider token counts. Shell and JS timings include the real tool handler and output processing. The script resets the sub-agent and async-task in-memory registries after each run. Timings are for same-machine comparisons, not CI thresholds.

## Reusable conclusions

Batching the same short commands into one shell call is far faster than separate calls, which points to shell process startup as the dominant cost; `run-js` avoids that startup entirely when a task only needs JavaScript. Sub-agent loop times are mock-only bookkeeping overhead, so they cannot quantify how much time or cost fewer model rounds would save.
