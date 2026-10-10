---
description: Agent Studio shell — generation history store, sub-agent run inspection, benchmarks with LLM judge
globs: src/public/parts/shells/agent_studio/**, src/public/parts/plugins/sub-agent/**, src/public/parts/plugins/async-task/**, src/public/parts/plugins/context-compress/**
alwaysApply: false
---

# Agent Studio, Sub-agent, Context Compression

Record shape, dialogue replay, conversation merging, attachment blobs, prompt-cache estimate and frontend views: [docs/internals.md](docs/internals.md).

## Generation history (`src/generation_history.mjs`)

- Directly imported (never `loadPart`, no `interfaces`). Self-initializing; retention settings stay in `data/users/<u>/shells/agent_studio/settings.json`, while `index.json` + `records/<id>.json` live in the system temp dir `temp/fount/agent_studio/<u>/` (kept out of user data and workspace grep). Writes are serialized per user.
- `recordGeneration(username, record)` / `listGenerations(username, filter)` / `getGeneration` / `getRetention` / `setRetention` / `pruneGenerations` / `clearGenerations(username, filter)`; re-exports `buildChains` / `groupByConversation` from `public/shared/generationChain.mjs`. `clearGenerations` deletes matching index entries + record files (no filter = wipe all) and returns `{ removed }`.
- Record shape: `{ id, parentId?, charId, chatId?, conversationId?, source, input?, requests?, dialogue?, response?, … }`. `requests[]` is the per-round AI request snapshot (`systemPrompt`, `messages`, `snapshot` = serialized `BuildPrompt` output, `output`, `usage`); `input` is a legacy `chat_log` snapshot, never the full prompt. Full shape: [docs/internals.md](docs/internals.md#generation-records).
- **Active recording** (`src/request_record.mjs`, imported by the caller, never injected via `generation_options`): `beginPromptRequest(args, prompt_struct, { model, aiSource })` (async) before each `StructCall`, passing the AI source so the snapshot uses its `BuildPrompt`; `finishPromptRequest(handle, { error, output })` after, and `finishGeneration(args, { response, error, metadata })` at generation end. Callers: the char templates (ZL-31/ln, easychar, SillyTavern, Risu) and `plugins/sub-agent` runtime; benchmark records come from the char template the runner calls. A request the caller never records produces no history — never fall back to `input` as if it were the full prompt.
- **Identity**: `args.chat_id` (provided by the shell/runner) is the stable, channel-unique conversation key; `args.extension.generationId` is the record id (also the parent link for sub-agent runs via `extension.agentStudio.parentId`). `extension.agentStudio = { source?, parentId?, subAgent?, metadata? }` carries record metadata. Missing `chat_id` → `console.error` once per request and skip recording (generation continues).
- **Reconstruction** (`public/shared/dialogueReplay.mjs`): messages align by `id` across rounds; entries first visible in request *N+1* are outputs of round *N*.
- Two TTLs: `input` + `requests` (prompt) 2 days, whole record (incl. replayed `dialogue` / sub-agent `conversation`) 7 days; adjustable via `setRetention`. Stripping keeps `requestCount` and sets `requestsStripped`; the replayed dialogue survives until the record TTL.
- Conversation grouping: `conversationKey = conversationId || chatId || id`. `generationRoundSpan(record)` (`public/shared/generationChain.mjs`) is the single authority for a generation's round span — shared by `mergeDialogueEvents` and the frontend `buildRoundUnits`, so replay offsets never drift.
- Attachments are snapshotted before generation and stored as SHA-256-keyed blobs under the temp store; record JSON files are the reachability roots for sweeping. No prompt or attachment data belongs in shell settings.
- Emits `events.emit('GenerationRecorded', …)` after each write.
- `shells/chat` / `shells/code` / `plugins/sub-agent` no longer write records themselves — the active-recording API does (sub-agent via `collectGenerationRecord` + its injectable `recordGeneration` dep).

## Plugin set resolution (sub-agent, no inheritance)

- `resolvePluginList(explicit)` in `plugins/sub-agent/state.mjs`: an explicit `plugins=` list (or a batch-level default) **completely replaces** the default `['code-execution','file-operations','sub-agent','context-compress']`; it is never merged with the parent's plugins.
- `sub-agent` is always force-included; `fount_chat` is always excluded.
- The sub-agent generation loop builds its own `prompt_struct` and calls `aiSource.StructCall` + `runReplyHandlers` — it never calls `char.GetReply`, so the plugin set is exactly the resolved list.

## Round/time budgets

- Every `run-subagent` must supply `round-limit` and `time-limit` (or belong to a batch with defaults); otherwise it is rejected with a strict error. Counts propagate up the `parentRunId` chain: a child consumes its own budget **and** every ancestor's.

## Context compression

- `needsCompression(args, { threshold, prompt_struct })` / `compressContext({ args, aiSource, prompt_struct, result })` in `chat/src/chat/session/summarize.mjs`.
- A summary is a `chatLogEntry_t` with `type: 'summary'`, `role: 'system'`, `charVisibility: [char_id]`. It is pushed to `result.logContextBefore` (persisted by the context sidecar) and set as `prompt_struct.chat_log = [entry]` so the same generation converges.
- `summaryBoundary.mjs` (`applySummaryBoundary`) trims the merged chat log to the newest **visible** summary entry; raw entries are never deleted.
- Triggers: the char regen loop at 72.9% of `ai_source.context_size` (ZL-31 / easynew easychar / SillyTavern / Risu templates) and the `<compress-context/>` tool (`plugins/context-compress`).
- **Usage hint placement** (`plugins/context-compress`): `GetPrompt` only emits the stable tool instruction; the volatile "current context usage" line is written by the plugin's **`TweakPrompt`** (which receives the assembled `prompt_struct` and counts it via `structPromptToSingle`, so it reflects the real prompt, not just `args.chat_log`). The entry has a fixed id (`context-compress:usage`), is updated in place each round, and is marked `position: 'end'` so `mergeStructPromptChatLog` appends it to the tail of the merged log — keeping the prompt-cache prefix stable and letting Agent Studio's dialogue replay treat it as an update instead of a new system message every round.

## Sub-agent async notifications

- `run({ async: true })` returns `{ backgroundId }`; sub-agent keeps its own in-memory run registry and registers the background promise with `plugins/async-task` (task id = `backgroundId`, kind `subagent`).
- Completion delivery is owned by `plugins/async-task/registry.mjs`: channel-scoped (keyed `${username}|${charId}`, nested runs by `parentRunId`). It appends a char-visible notice via `appendAndWake` (the parent channel's `AppendChatLogEntry`, then `RequestCharReply` when the shell can wake; absent = append-only, and the shell's pending-trigger queue decides when to generate) and falls back to a pending queue injected via `GetPrompt` on the parent's next generation.
- `getSubAgentPrompt` and `getAsyncTaskPrompt` drain the same unified queue (first caller wins); an async task awaited via `<await-async>` is marked consumed, so it is not notified twice.
- Nested runs notify their own parent run, never the root channel.

## Unified async tasks (`plugins/async-task`)

- `registry.mjs` is a pure in-memory registry (no `src/server/**` import): `registerTask({ id?, kind, label, owner, run })` → `{ id, done }`; `listTasks` / `awaitTasks({ mode: 'all'|'any', timeoutMs })`; channel registry + pending-notification queue.
- **Lifecycle**: task settles → if not consumed by `<await-async>` it is notified → removed from the registry. Finished tasks are never retained.
- Producers register their background promise: sub-agent async runs (id = `backgroundId`) and code-execution `<run-js async="true">` / `<run-<shell> async="true">`. `setAsyncToolingEnabled` is flipped by the plugin's `Load`; code-execution rejects `async` when the plugin is absent.
- Tools: `<list-async/>` (list in-flight tasks, optional `kind=`), `<await-async ids="a,b" mode="all|any" time-limit="5m"/>`.
- `resolvePluginList` force-includes `async-task`; the code shell loads it as a base plugin.

## Sub-agent observability (live + history)

- `runtime.mjs` pushes a `subagent-run` user event (`sendEventToUser`, injectable as `deps.notifyRun`) at start / each round / finish and on each appended entry, stream preview, and tool-output chunk. The code shell subscribes via `onServerEvent('subagent-run', …)` and filters by `chat_name === 'code-<sessionId>'`. Payload shape is in `public/llms.txt`.
- Run's `conversation` is display history, while `promptConversation` supplies `childArgs.chat_log`: handler logs written into the `prompt_struct.chat_log` generation timeline go to display history only, or they would be doubled in the next prompt. Live `AppendChatLogEntry` writes both; `injectRoundEntries` picks up new user entries at the next model round. The child conversation is append-only (no `RequestCharReply`), so a sub-agent can never spawn a top-level generation. `POST /subagent/:runId/messages` is user-scoped and rejects after the active run's in-memory context disappears; do not extend run lifetime just to support sending.
- `recordRunGeneration` persists the run's own `conversation` (file buffers stripped, per-entry capped) plus `conversationId: 'subagent:<runId>'`; `generation_history` keeps `conversation` for the whole-record TTL and strips only `input` at `promptMs`.
- Parent linkage: `parentId = run.parentGenerationId`, read from `args.extension.generationId` (chat `triggerReply` and code `request.mjs` now set it before generation). `sub-agent` tool logs carry `extension.subAgent` so a shell can render a run chip.
- `GET /subagents?chatId=` and `GET /subagent/:runId` (live registry → fallback record) back the code shell's buttons and the `#conversation/subagent%3A<runId>` deep link.

## Benchmarks

- `src/benchmark.mjs` is pure (`computeStats` / `parseJudgeResponse` / `buildJudgePrompt`) so it tests without a server.
- Definitions carry no char field; char / config / model are chosen at run time. Runner builds a `chatReplyRequest` with `BUILTIN_WORLD` / `BUILTIN_PERSONA` and calls `char.GetReply`, recording with `source: 'shells/agent_studio/benchmark'`.
- Judge: `check` runs deterministic `exact`/`contains`/`regex` or reverses the output before the LLM judge; failures short-circuit the judge. Cases with `criteria`, or `expected` without `check`, call the configured judge AI source directly (`Call`, no tools). Import/export exchanges complete benchmark definition JSON; `examples/LLM-mixed-scoring-demo.json` exercises all three modes.
- Prompt cache UI is a **character-based estimate** (`public/shared/promptCache.mjs`, comparing consecutive request snapshots), not provider-billed cached tokens. `recordGeneration` precomputes `cacheRate` into the index summary so list badges survive `requests` stripping. Algorithm: [docs/internals.md](docs/internals.md#prompt-cache-estimate).

## Endpoints

`/api/parts/shells:agent_studio/` — `/chars`, `/char/:id/overview`, `/subagents?charId=|chatId=`, `/subagent/:runId` (GET status; POST `/:runId/messages`), `/generations` (GET list / DELETE clear, filter `charId` etc., no filter wipes all), `/generation/:id`, `/attachment/:hash?name=&download=` (retained-reference-guarded blob, byte ranges supported), `/conversations`, `/conversation/:key`, `/chains`, `/retention`, `/benchmarks` CRUD, `/benchmarks/:id/run`, `/runs`. Sub-agent views derive from generation records grouped by `subAgent.runId` / `batchId`; live state is imported from `plugins/sub-agent/state.mjs`.

## CLI (`fount run` / `fount runas`)

- `shells/agent_studio/main.mjs` exposes `interfaces.invokes.ArgumentsHandler` → `src/cli.mjs` `runStudioCli`; `fount run agent_studio <subcommand>` uses the last-active user, `fount runas <user> agent_studio <subcommand>` is explicit. No new path-CLI command.
- Subcommands: `conversations` / `conversation <key>` / `generation <id>` / `dump <key>` / `cache-report <key> [--threshold 0.729]`; `--json` (or `dump --format json`) prints full JSON to stdout, `--out <path>` writes a file relative to the CLI cwd. `cache-report` always prints JSON to stdout: per-request `{ index, rate, compressed }` (rate vs the previous request, `compressed` = the round contains a `summary` message) plus `minNonCompressedRate` / `below` for auto-check scripts (`src/cache_report.mjs`, pure).
- The `ArgumentsHandler` wraps CLI text as `{ type: 'output', content }`; `src/server/index.mjs` `runpart` writes its content to `process.stdout` (otherwise falls back to the VirtualConsole `outputs`), so a dump stays valid JSON. The shared CLI helper still returns text to `IPCInvokeHandler`. Errors propagate through IPC as a non-zero exit.

## Frontend views

- `public/index.mjs` boots the shell: `applyTheme` → `initTranslations('agent_studio')` → preload shared data (`src/data.mjs`) → enter the hash view. A ready gate (`src/gate.mjs`, id `agent-studio`) is exposed for Playwright.
- Four main views (`dashboard` / `generations` / `benchmarks` / `settings`) plus the `#conversation/<key>` detail view (also `#conversation/subagent%3A<runId>`). Its replay slider, transcript and cache-rate chart are **per round** — `buildRoundUnits` must keep the same span formula as `mergeDialogueEvents`. Details: [docs/internals.md](docs/internals.md#frontend-views).
- `src/views/*.mjs` own rendering; loaders are safe to re-run (language change re-invokes the active view). No view imports `navigation.mjs` (avoids a cycle) — dispatch a `navigationEvents` request instead.
- Nav chrome (sidebar + mobile dock) shares `.nav-btn[data-view]`, bound once by `wireNavigation`.
- UI rules: Iconify mask icons only (no emoji), theme tokens only, no hardcoded radius / border / color, animate `transform` / `opacity` / colors only.
- Locale scan: prompt / model / generation text (generation previews, sub-agent transcripts, benchmark responses & judge text, generation dialog prompt/response) is marked `prompt-content`; entity / config names (char name & description, benchmark name & description, case id, run id) stay `user-content`.
