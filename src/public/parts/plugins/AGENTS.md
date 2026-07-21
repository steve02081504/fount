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
- **`ReplyHandler`**: Processes AI response. **CRITICAL**: on tool call, log both the assistant's tool-call message AND tool results via `args.AddLongTimeLog(entry)`. Return `true` to trigger re-generation.

## Guidelines

- I18n: add global strings to `src/public/locales/zh-CN.json`; plugin-specific copy may use part-local `locales.json`.
- `eslint --fix --quiet` after changes. No console logs unless error/warning.

**Example**: `src/public/parts/plugins/moltbook/` — tag-based tool handling and logging.
