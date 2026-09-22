---
description: Agent Studio shell — generation history store, sub-agent run inspection, benchmarks with LLM judge
globs: src/public/parts/shells/agent_studio/**, src/public/parts/plugins/sub-agent/**, src/public/parts/plugins/async-task/**, src/public/parts/plugins/context-compress/**
alwaysApply: false
---

# Agent Studio, Sub-agent, Context Compression

## Generation history (`src/generation_history.mjs`)

- Directly imported (never `loadPart`, no `interfaces`). Self-initializing; `data/users/<u>/shells/agent_studio/{settings.json,index.json,records/<id>.json}`. Writes are serialized per user.
- `recordGeneration(username, record)` / `listGenerations(username, filter)` / `getGeneration` / `getRetention` / `setRetention` / `pruneGenerations`; re-exports `buildChains` / `groupByConversation` from `public/shared/generationChain.mjs`.
- Record shape: `{ id, parentId?, charId, charname?, subAgent?, chatId?, conversationId?, source, startedAt, finishedAt?, input?, response?, model?, metadata?, error? }`. `input` is a request `chat_log` snapshot, not the assembled prompt.
- Two TTLs: `input` (prompt) 2 days, whole record (conversation) 7 days; adjustable via `setRetention`.
- Emits `events.emit('GenerationRecorded', …)` after each write.
- `shells/chat` writes every generation via `executeGeneration` (try/catch, never blocks the reply); `plugins/sub-agent` writes each run.

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
- Completion delivery is owned by `plugins/async-task/registry.mjs`: channel-scoped (keyed `${username}|${charId}`, nested runs by `parentRunId`). It prefers a timer-style proactive trigger (parent channel `Update()` → `char.GetReply` → `AddChatLogEntry`) and falls back to a pending queue injected via `GetPrompt` on the parent's next generation.
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

`/api/parts/shells:agent_studio/` — `/chars`, `/char/:id/overview`, `/subagents?charId=|chatId=`, `/subagent/:runId`, `/generations`, `/generation/:id`, `/chains`, `/retention`, `/benchmarks` CRUD, `/benchmarks/:id/run`, `/runs`. Sub-agent views derive from generation records grouped by `subAgent.runId` / `batchId`; live state is imported from `plugins/sub-agent/state.mjs`.

## Frontend views

- `public/index.mjs` boots the shell: `applyTheme` → `initTranslations('agent_studio')` → preload shared data (`src/data.mjs`) → enter the hash view. A ready gate (`src/gate.mjs`, id `agent-studio`) is exposed for Playwright.
- Four main views, each `<section id="<view>View" class="view">` in `public/index.html`: `dashboard` (char list + overview), `generations` (records + chains, char filter), `benchmarks` (defs + runner + results), `settings` (retention). Plus the non-nav deep-link view `subagent` (`#subagent/<runId>` → `views/subagent.mjs`), entered only via `applyIncomingNavigation`. `src/viewChrome.mjs` toggles visibility/highlight; `src/navigation.mjs` maps view → loader, syncs `location.hash`, and wraps switches in a View Transition.
- `src/views/*.mjs` own rendering; loaders are safe to re-run (language change re-invokes the active view). Templates live in `public/src/templates/`; `public/src/lib/` holds `format` / `emptyState` / `generationDialog` / `activate` helpers. No view imports `navigation.mjs` (avoids a cycle).
- Nav chrome (sidebar + mobile dock) shares `.nav-btn[data-view]`, bound once by `wireNavigation`.
- UI rules: Iconify mask icons only (no emoji), theme tokens only, no hardcoded radius / border / color, animate `transform` / `opacity` / colors only.
