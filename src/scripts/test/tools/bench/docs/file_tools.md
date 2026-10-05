# Agent file tool benchmark

This local microbenchmark measures the file-operations reply handlers and their edit helpers against a deterministic temporary workspace. It covers `glob`, dense `grep` (including the configured result limit), files-only `grep`, `view-file`, `replace-file`, full replacement edits and `override-file` create / overwrite at 10,000 and 50,000 lines. The two edit helper measurements isolate `renderLineDiff` and `buildFileEditSummary` for the same large replacements.

From the repository root, run:

```powershell
deno run --allow-scripts --allow-all -c ./deno.json ./src/scripts/test/tools/bench/file_tools.mjs
```

Choose the measured sample count with `--iterations=N` (default 9; must be a positive integer). Each case first records and validates one `coldMs` call, then runs two warmups and the requested number of measured warm calls. Cold means the case's first invocation after process startup, not a process or OS cold start. Fixture reset runs before timing; correctness checks, including reading back edited files, run after timing. Replace timings therefore cover the handler work and tool result generation, excluding fixture reset and verification reads. Correctness checks validate search totals and truncation, written file contents, and edit summary counts. JSON includes Node and Deno versions, iterations, warmup count, timings, and output size. `outputBytes` counts the UTF-8 bytes of the agent-facing tool result, not tokens or API billing. Output goes to stdout by default; use `--output=PATH` to write JSON to a file.

```powershell
deno run --allow-scripts --allow-all -c ./deno.json ./src/scripts/test/tools/bench/file_tools.mjs --iterations=9 --output=./file-tools-baseline.json
```

The workspace is created under the OS temporary directory and removed in `finally`. Timings are intended for before/after comparisons on the same machine and runtime; they are not CI thresholds. The correctness assertions compare the agent-facing result text, which is produced from the `zh-CN` tool copy, so a copy change to those messages updates this script too.

## Reusable conclusions

A large-edit replacement reuses the edit summary's diff instead of computing it twice, marks overlapping context intervals once, and renders only retained preview strings while counting omitted lines. Forced overwrite skips similarity calculation, whose result cannot reject a forced write, while ordinary overwrite still checks similarity and empty content.

When a task only needs matching filenames, the existing `<grep mode="files" include="*.txt">DENSE_MATCH</grep>` returns about 46% fewer result bytes than matching lines on this fixture (3,996 vs 7,464). The modes return different information — use the filename mode for locating files and line mode for inspecting matches. These byte counts do not establish token or monetary savings.

Full-file writes send the entire new content: the 50,000-line fixture uses 738,966 input bytes even though its result preview is only 1,222 bytes. Prefer local replacement when changing a small part of an existing file; choose full overwrite when the task requires it. These are byte measurements, not token estimates.

The companion [runtime benchmark](runtime_tools.md) covers in-process JavaScript, shell startup, separate versus batched commands, larger shell output, and synchronous/asynchronous sub-agent completion with deterministic mock AI.
