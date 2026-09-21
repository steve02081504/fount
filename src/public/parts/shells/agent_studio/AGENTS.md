---
description: Agent Studio shell — generation history store, sub-agent run inspection, benchmarks with LLM judge
globs: src/public/parts/shells/agent_studio/**, src/public/parts/plugins/sub-agent/**, src/public/parts/plugins/context-compress/**
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

- `run({ async: true })` returns `{ backgroundId }`; the plugin keeps an in-memory run registry.
- Delivery is channel-scoped: the notification goes back to the channel that spawned the run (from the plugin's own channel registry, keyed `${username}|${char_id}`). It prefers a timer-style proactive trigger (parent channel `Update()` → `char.GetReply` → `AddChatLogEntry`) and falls back to a pending queue injected via `GetPrompt` on the parent's next generation.
- Nested runs notify their own parent run, never the root channel.

## Benchmarks

- `src/benchmark.mjs` is pure (`computeStats` / `parseJudgeResponse` / `buildJudgePrompt`) so it tests without a server.
- Definitions carry no char field; char / config / model are chosen at run time. Runner builds a `chatReplyRequest` with `BUILTIN_WORLD` / `BUILTIN_PERSONA` and calls `char.GetReply`, recording with `source: 'shells/agent_studio/benchmark'`.
- Judge: when a case has `criteria` or `expected`, the configured judge AI source is called directly (`Call`, no tools) and its `{score, reason}` is parsed; v1 has no version comparison.

## Endpoints

`/api/parts/shells:agent_studio/` — `/chars`, `/char/:id/overview`, `/subagents?charId=`, `/generations`, `/generation/:id`, `/chains`, `/retention`, `/benchmarks` CRUD, `/benchmarks/:id/run`, `/runs`. Sub-agent views derive from generation records grouped by `subAgent.runId` / `batchId`; live state is imported from `plugins/sub-agent/state.mjs`.
