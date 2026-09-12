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
- **`ReplyHandler`**: driven by the chat-shared pipeline `runReplyHandlers` (`shells/chat/src/reply/handlerPipeline.mjs`). Contract:
  - Parse `const content = reply.content_for_handle ?? reply.content` (a per-generation working copy derived from the raw `content`). **Never rewrite `reply.content`** — the raw generation and reasoning must be preserved.
  - After handling a call segment, call `args.MaskHandledCall?.(match[0])` to neutralize it in `content_for_handle`, so tool A's arguments cannot trigger tool B's call. The masked replacement must not match the same regex again.
  - Return `true` to **suggest** another generation (the model must see the result first); `false` to stop (this generation is the final result). Inline-substitution handlers return `false` on success.
  - The pipeline re-runs the handler chain until `content_for_handle` stops changing (fixpoint); container tools (e.g. `<run-*>`) should precede inner tools. The pipeline auto-appends each raw generation as a char log entry — handlers only append tool **results** (`role:'tool'`) and must not replay the call.
  - Tool result entries set `content` (agent layer: guarded/raw result) and `content_for_show` (human layer: executed code + untruncated output) separately. Inline-substitution handlers only rewrite `content_for_show`; `content` keeps the raw tags.
- **Human-invisible logs**: entries added with `charVisibility` are still shown to code-shell users via their `content_for_show` (a friendly tool card), so give them a readable show layer rather than leaving raw tool syntax.

## Guidelines

- I18n: add global strings to `src/public/locales/zh-CN.json`; plugin-specific copy may use part-local `locales.json`.
- **Chat as the de-facto shared layer**: importing modules provided by the chat shell (e.g. `shells/chat/src/streaming/markdown.mjs`) is expected design — chat doubles as a shared layer for the prompt-building chain (chars/plugins may optionally consume what chat provides); no need to migrate such utilities into a separate shared module.

**Example**: `src/public/parts/plugins/file-operations/` — tag-based tool handling and logging.
