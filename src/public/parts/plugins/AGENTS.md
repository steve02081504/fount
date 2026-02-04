# AI Agent Guide: Plugin Architecture & Creation

**Objective**: This document provides AI agents with the essential points for creating and maintaining fount **Plugins** (parts that extend chat behavior via prompts and reply handling).

**Instruction**: Before implementing or modifying a plugin, **you must read this guide** and the root [fount Architecture & AI Agent Prompting Guide](../../../AGENTS.md). For API types, consult `@src/decl/pluginAPI.ts` and `PluginAPI_t`.

**See also**: [Root AGENTS.md](../../../../AGENTS.md); [Chat decl (chatReplyRequest_t, chatLogEntry_t)](../shells/chat/decl/chatLog.ts).

---

## 1. Plugin Structure

- Plugins live under `src/public/parts/plugins/<plugin-name>/` or per-user under `data/users/<user>/plugins/<plugin-name>/`.
- **Required**: `main.mjs` at the plugin root exporting a default object implementing `PluginAPI_t` (see `@src/decl/pluginAPI.ts`).
- Optional: `info.json`, `fount.json`, and other modules (e.g. `prompt.mjs`, `handler.mjs`, `api.mjs`). Follow existing plugins (e.g. `moltbook`) for layout.

---

## 2. ReplyHandler: Log Both Tool Invocations and Results

When your plugin’s **ReplyHandler** processes AI replies that trigger tools (e.g. function calls, XML tags like `<moltbook_*>`, or MCP-style blocks):

- **You must add to the long-term log both:**
  1. **The AI’s message that contains the tool invocation** (the “tool call” or request content), so the conversation history stays complete.
  2. **The result of each tool execution** (e.g. `role: 'tool'`, with the call result content).

- **Do not add only the tool results.** If you only push tool results and omit the assistant’s tool-call message, the next prompt loses the context of what the model “said” (the request), which hurts continuity and debugging.

**Correct pattern** (conceptually):

1. Build a log entry for the **assistant’s tool-call content** (e.g. `name: reply.name`, `role: 'char'`, `content: <tool call block(s)>`).
2. Call `args.AddLongTimeLog(thatEntry)` once (or merge all call blocks into one entry).
3. For each tool execution, call `args.AddLongTimeLog({ role: 'tool', name: ..., content: result, ... })`.

Reference implementations:

- **MCP Template** (tool call + result): `@src/public/parts/ImportHandlers/MCP/Template/main.mjs` — `ReplyHandler` builds `tool_calling_log` from `call.fullMatch`, calls `AddLongTimeLog(tool_calling_log)` before adding each tool result.
- **moltbook** (tag-based): `@src/public/parts/plugins/moltbook/handler.mjs` — adds the matched tag(s) as char content first, then each API result as tool entries.

---

## 3. Other Plugin Interfaces (Brief)

- **GetPrompt**: Return `single_part_prompt_t` (e.g. `{ text: [], additional_chat_log: [], extension: {} }`) to add system/context for the AI. Use `additional_chat_log` to inject entries that should appear in the prompt but not necessarily in the main chat log.
- **TweakPrompt**: Adjust `prompt_struct` / `my_prompt` (e.g. reorder or filter sections). Use when you need to modify existing prompt content.
- **ReplyHandler**: Process `reply` (the current `chatLogEntry_t`). Use `args.AddLongTimeLog(entry)` to append entries that become part of the long-term context (and next prompt). Return `true` if you consumed the reply and the system should re-generate; `false` otherwise.
- **GetJSCodePrompt**: Optional. Return a string (JavaScript code) to be added to the prompt, helping the AI understand the code execution context.
- **GetJSCodeContext**: Optional. Return an object `Record<string, any>` containing variables or functions to be exposed to the AI's code execution environment.
- **GetReplyPreviewUpdater**: Optional. Return an updater (e.g. from `defineToolUseBlocks` in `@src/public/parts/shells/chat/src/stream.mjs`) so the UI can hide or format tool blocks during streaming.
- **config.GetData / SetData**: Store per-user or global plugin config; use from ReplyHandler or GetPrompt as needed (e.g. API keys per char).

---

## 4. Conventions

- **Single process**: No child processes or workers; use async/await and non-blocking logic only.
- **Logging**: Do not log unless it’s an error or warning.
- **i18n**: User-facing strings should use the project’s locale system; add keys to `src/locales/zh-CN.json` and let the locale pipeline propagate.
- **Linting**: Run `eslint --fix --quiet` after code changes.

When in doubt, mimic an existing plugin (e.g. `moltbook`) and keep the ReplyHandler rule in mind: **always add both the AI’s tool-triggering message and the tool results to the log.**
