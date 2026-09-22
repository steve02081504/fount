---
description: Agent Studio shell — generation history store, sub-agent run inspection, benchmarks with LLM judge
globs: src/public/parts/shells/agent_studio/**, src/public/parts/plugins/sub-agent/**, src/public/parts/plugins/async-task/**, src/public/parts/plugins/context-compress/**
alwaysApply: false
---

# Agent Studio, Sub-agent, Context Compression

## Generation history (`src/generation_history.mjs`)

- Directly imported (never `loadPart`, no `interfaces`). Self-initializing; `data/users/<u>/shells/agent_studio/{settings.json,index.json,records/<id>.json}`. Writes are serialized per user.
- `recordGeneration(username, record)` / `listGenerations(username, filter)` / `getGeneration` / `getRetention` / `setRetention` / `pruneGenerations`; re-exports `buildChains` / `groupByConversation` from `public/shared/generationChain.mjs`.
- Record shape: `{ id, parentId?, charId, charname?, subAgent?, chatId?, conversationId?, source, startedAt, finishedAt?, input?, requests?, requestCount?, response?, conversation?, model?, metadata?, error? }`. `input` is a legacy request `chat_log` snapshot (not the assembled prompt). `requests` is the per-round AI request snapshot: `{ index, startedAt, finishedAt, model, systemPrompt, messages }` (`systemPrompt` = merged system prompt, `messages` = visible chat log after `mergeStructPromptChatLog`).
- Per-round capture: `chat/src/prompt_struct/snapshot.mjs` `createPromptRequestRecorder()`; setters wire `generation_options.onPromptRequest` in `triggerReply` (chat), the char templates (easychar / SillyTavern / Risu), `plugins/sub-agent` runtime, `shells/code` request and the benchmark runner. A generation with no captured rounds reports "not captured" — never fall back to `input` as if it were the full prompt.
- Two TTLs: `input` + `requests` (prompt) 2 days, whole record (conversation) 7 days; adjustable via `setRetention`. Stripping keeps `requestCount` and sets `requestsStripped`.
- Conversation grouping: `conversationKey = conversationId || chatId || id`; `summarizeConversations` (both in `public/shared/generationChain.mjs`) powers `listConversations` / `getConversation`.
- Emits `events.emit('GenerationRecorded', …)` after each write.
- `shells/chat` / `shells/code` write every generation (try/catch, never blocks the reply); `plugins/sub-agent` writes each run.

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

## Sub-agent async notifications

- `run({ async: true })` returns `{ backgroundId }`; sub-agent keeps its own in-memory run registry and registers the background promise with `plugins/async-task` (task id = `backgroundId`, kind `subagent`).
- Completion delivery is owned by `plugins/async-task/registry.mjs`: channel-scoped (keyed `${username}|${charId}`, nested runs by `parentRunId`). It appends a char-visible notice via the parent channel's `AddChatLogEntry` (the shell's pending-trigger queue decides when to generate) and falls back to a pending queue injected via `GetPrompt` on the parent's next generation.
- `getSubAgentPrompt` and `getAsyncTaskPrompt` drain the same unified queue (first caller wins); an async task awaited via `<await-async>` is marked consumed, so it is not notified twice.
- Nested runs notify their own parent run, never the root channel.

## Unified async tasks (`plugins/async-task`)

- `registry.mjs` is a pure in-memory registry (no `src/server/**` import): `registerTask({ id?, kind, label, owner, run })` → `{ id, done }`; `listTasks` / `awaitTasks({ mode: 'all'|'any', timeoutMs })`; channel registry + pending-notification queue.
- **Lifecycle**: task settles → if not consumed by `<await-async>` it is notified → removed from the registry. Finished tasks are never retained.
- Producers register their background promise: sub-agent async runs (id = `backgroundId`) and code-execution `<run-js async="true">` / `<run-<shell> async="true">`. `setAsyncToolingEnabled` is flipped by the plugin's `Load`; code-execution rejects `async` when the plugin is absent.
- Tools: `<list-async/>` (list in-flight tasks, optional `kind=`), `<await-async ids="a,b" mode="all|any" time-limit="5m"/>`.
- `resolvePluginList` force-includes `async-task`; the code shell loads it as a base plugin.

## Sub-agent observability (live + history)

- `runtime.mjs` pushes a `subagent-run` user event (`sendEventToUser`, injectable as `deps.notifyRun`) at start / each round / finish; the code shell subscribes via `onServerEvent('subagent-run', …)` and filters by `chat_name === 'code-<sessionId>'`. Payload shape is in `public/llms.txt`.
- `recordRunGeneration` persists the run's own `conversation` (file buffers stripped, per-entry capped) plus `conversationId: 'subagent:<runId>'`; `generation_history` keeps `conversation` for the whole-record TTL and strips only `input` at `promptMs`.
- Parent linkage: `parentId = run.parentGenerationId`, read from `args.extension.generationId` (chat `triggerReply` and code `request.mjs` now set it before generation). `sub-agent` tool logs carry `extension.subAgent` so a shell can render a run chip.
- `GET /subagents?chatId=` and `GET /subagent/:runId` (live registry → fallback record) back the code shell's buttons and the `#subagent/<runId>` deep link.

## Benchmarks

- `src/benchmark.mjs` is pure (`computeStats` / `parseJudgeResponse` / `buildJudgePrompt`) so it tests without a server.
- Definitions carry no char field; char / config / model are chosen at run time. Runner builds a `chatReplyRequest` with `BUILTIN_WORLD` / `BUILTIN_PERSONA` and calls `char.GetReply`, recording with `source: 'shells/agent_studio/benchmark'`.
- Judge: when a case has `criteria` or `expected`, the configured judge AI source is called directly (`Call`, no tools) and its `{score, reason}` is parsed; v1 has no version comparison.

## Endpoints

`/api/parts/shells:agent_studio/` — `/chars`, `/char/:id/overview`, `/subagents?charId=|chatId=`, `/subagent/:runId`, `/generations`, `/generation/:id`, `/conversations`, `/conversation/:key`, `/chains`, `/retention`, `/benchmarks` CRUD, `/benchmarks/:id/run`, `/runs`. Sub-agent views derive from generation records grouped by `subAgent.runId` / `batchId`; live state is imported from `plugins/sub-agent/state.mjs`.

## CLI (`fount run` / `fount runas`)

- `shells/agent_studio/main.mjs` exposes `interfaces.invokes.ArgumentsHandler` → `src/cli.mjs` `runStudioCli`; `fount run agent_studio <subcommand>` uses the last-active user, `fount runas <user> agent_studio <subcommand>` is explicit. No new path-CLI command.
- Subcommands: `conversations` / `conversation <key>` / `generation <id>` / `dump <key>`; `--json` (or `dump --format json`) prints full JSON to stdout, `--out <path>` writes a file relative to the CLI cwd.
- The handler **returns a string**; `src/server/index.mjs` `runpart` writes a string result to `process.stdout` (otherwise falls back to the VirtualConsole `outputs`), so a dump stays valid JSON. Errors propagate through IPC as a non-zero exit.

## Frontend views

- `public/index.mjs` boots the shell: `applyTheme` → `initTranslations('agent_studio')` → preload shared data (`src/data.mjs`) → enter the hash view. A ready gate (`src/gate.mjs`, id `agent-studio`) is exposed for Playwright.
- Four main views, each `<section id="<view>View" class="view">` in `public/index.html`: `dashboard` (char list + overview), `generations` (conversations + chains, char filter), `benchmarks` (defs + runner + results), `settings` (retention). The generations records tab lists **conversations** (`conversation_item` + `lib/conversationItem.mjs`) and opens `views/conversation.mjs`; per-round prompt requests render there (`requests` / `requestsStripped` / `requestCount`). Two non-nav deep-link views entered only via `applyIncomingNavigation`: `subagent` (`#subagent/<runId>`) and `conversation` (`#conversation/<key>`). `src/viewChrome.mjs` toggles visibility/highlight; `src/navigation.mjs` maps view → loader, syncs `location.hash`, and wraps switches in a View Transition.
- `src/views/*.mjs` own rendering; loaders are safe to re-run (language change re-invokes the active view). Templates live in `public/src/templates/`; `public/src/lib/` holds `format` / `emptyState` / `generationDialog` / `activate` / `generationItem` / `charOptions` / `stateBadge` / `navigationEvents` helpers. No view imports `navigation.mjs` (avoids a cycle); the subagent back button dispatches a `navigationEvents` request that `installNavigationEvents` (called in boot) turns into `switchView`.
- Nav chrome (sidebar + mobile dock) shares `.nav-btn[data-view]`, bound once by `wireNavigation`.
- UI rules: Iconify mask icons only (no emoji), theme tokens only, no hardcoded radius / border / color, animate `transform` / `opacity` / colors only.
- Locale scan: prompt / model / generation text (generation previews, sub-agent transcripts, benchmark responses & judge text, generation dialog prompt/response) is marked `prompt-content`; entity / config names (char name & description, benchmark name & description, case id, run id) stay `user-content`.
