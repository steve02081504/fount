---
description: Creating or modifying fount plugins (GetPrompt, TweakPrompt, ReplyHandler) and PluginAPI_t
globs: src/public/parts/plugins/**, src/decl/pluginAPI.ts
alwaysApply: false
---

# Plugin Architecture & Creation Guide

## 1. Plugin Structure

- **Location**: `src/public/parts/plugins/<name>/`
- **Entry Point**: `main.mjs` must export a default object implementing `PluginAPI_t` (@src/decl/pluginAPI.ts).

## 2. Key Interfaces

- **`GetPrompt`**: Return `single_part_prompt_t` to inject system instructions or additional logs.
- **`TweakPrompt`**: Modify the final `prompt_struct` before it is sent to the AI.
- **`ReplyHandler`**: Processes the AI's response.
  - **CRITICAL**: If the AI calls a tool, you **must** log both the assistant's tool-call message AND the tool results using `args.AddLongTimeLog(entry)`.
  - Return `true` to trigger a re-generation, `false` otherwise.

## 3. Guidelines

- **Logic**: Use `async/await`. Single process only (no child processes).
- **I18n**: Add global UI strings to `src/public/locales/zh-CN.json`; plugin-specific copy may use a part-local `locales.json`.
- **Logging**: No console logs unless it's an error or warning.
- **Standards**: Run `eslint --fix --quiet` after changes.

**Example**: See `src/public/parts/plugins/moltbook/` for a reference on tag-based tool handling and logging.
**See also**: [Root AGENTS.md](../../../../AGENTS.md)
