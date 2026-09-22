---
description: Creating or modifying fount plugins (GetPrompt, TweakPrompt, ReplyHandler) and PluginAPI_t
globs: src/public/parts/plugins/**, src/decl/pluginAPI.ts
alwaysApply: false
---

# Plugin Architecture & Creation Guide

- **Location**: `src/public/parts/plugins/<name>/main.mjs` — default export implements `PluginAPI_t` (`@src/decl/pluginAPI.ts`).

## Key Interfaces

- **`GetPrompt`**: Return `single_part_prompt_t` to inject system instructions or additional logs.
- **`TweakPrompt`**: Modify the final `prompt_struct` before sending to AI.
- **`ReplyHandler`**: driven by the chat-shared pipeline `runReplyHandlers` (`shells/chat/src/reply/handlerPipeline.mjs`). See `ReplyHandler_t` (`@src/decl/pluginAPI.ts`):
  - Build with `defineReplyHandler({ tag, params?, body?, phase?, level?, name?, evaluate?, display?, handle })`, or hand-write the low-level object. `phase` is sugar (`before`/`action`/`after` = -100/0/+100) **added to** `level`; the pipeline groups by ascending level.
  - With `tag`/`pattern`, the pipeline consumes one call span **whole** in generation-text order (`call = { name, tag?, params, body, inner, raw, start, end, occurrence, value?, error? }`); container tags swallow nested ones, so tool A's arguments cannot trigger tool B. Without a pattern it is a **content** handler: `handle(reply, args, null)` acts on the whole `reply.content`.
  - `handle(reply, args, call)` returns `{ regen?, content?, stop? }`: `regen: true` suggests another generation (the model must see the result first); `content` replaces the whole `reply.content`; `stop: true` ends the round immediately. **No `content_for_handle` / `MaskHandledCall` / boolean return / `toolCallPatterns` / fixpoint.**
  - One handler per tag; pack several with `defineReplyHandlers([...])` into a single `ReplyHandler`. Derive the streaming preview with `GetReplyPreviewUpdater: defineReplyPreviews(<same handlers>)`.
  - `evaluate(call, args)` (optional) runs early during streaming and is cached by name+occurrence in `args.extension.evaluatedToolCalls`; `handle` reuses it via `call.value`, failures land in `call.error`.
  - `parallel` (optional) declares concurrency compatibility between handlers: `true` = compatible with every parallel-enabled handler, `string[]` = only with the listed handler names (mutual). Adjacent non-conflicting calls in the same level group run **concurrently** regardless of arguments (e.g. reading five files at once); a handler without `parallel` is a barrier (serialized). Parallel handlers must not rewrite `reply.content`; their tool logs are replayed in generation-text order.
  - Inline substitution is detected automatically: any handler declaring `evaluate` (it produces a value that goes into the message) has each call's rendered result head/tail-truncated and echoed back to the char in an `inline-rendered` tool log, so the char knows what its message became without the full (possibly huge) result bloating the prompt. Blocks whose result equals the original tag (no visible change) are omitted; if none change, no log is emitted at all. The human layer (`content_for_show`) keeps the full text — no extra flag needed.
  - `display(call, { stage, open, value?, error? }, args)` (optional) controls how the call span appears in the human show layer. Default: `String(value)` once evaluated, `[Error:]` on failure, and for a handler without `evaluate` a localized placeholder while streaming / collapse at final. **Never rewrite the whole `reply.content_for_show`** — the pipeline derives it purely from `reply.content`.
  - Tool results are logged via `args.AddLongTimeLog({ role:'tool', content, content_for_show, files })` with `content` (agent layer) and `content_for_show` (human layer) set separately; the pipeline appends each raw generation as a char log entry, so handlers only append results and must not replay the call.
- **Human-invisible logs**: entries added with `charVisibility` are still shown to code-shell users via their `content_for_show` (a friendly tool card), so give them a readable show layer rather than leaving raw tool syntax.

## Guidelines

- I18n: add global strings to `src/public/locales/zh-CN.json`; plugin-specific copy may use part-local `locales.json`.
- **Real-time tool output**: ReplyHandlers may stream execution output to the requesting shell via `args.generation_options.onToolOutput?.({ callId, phase: 'start'|'chunk'|'end', name, lang?, code?, stream?, data? })` (see `code-execution/handler.mjs`). Local executors stream directly; remote streams over the `callback` channel only when `args.generation_options.remoteToolCallbackPartpath` is also set (a host part implementing `interfaces.subfount.RemoteCallBack`). Absent hook = no streaming, zero effect.
- **Unified background tasks**: register long-running background work with `plugins/async-task/registry.mjs` (`registerTask` → the task is notified on settle unless awaited, then released) rather than rolling a private promise registry; expose `<list-async/>` / `<await-async>` through your `GetPrompt` + `ReplyHandler`, or rely on the `async-task` plugin's own.
- **Chat as the de-facto shared layer**: importing modules provided by the chat shell (e.g. `shells/chat/src/streaming/markdown.mjs`) is expected design — chat doubles as a shared layer for the prompt-building chain (chars/plugins may optionally consume what chat provides); no need to migrate such utilities into a separate shared module.

**Example**: `src/public/parts/plugins/file-operations/` — tag-based tool handling and logging.
