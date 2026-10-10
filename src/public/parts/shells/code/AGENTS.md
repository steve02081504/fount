---
description: code shell (AI coding sessions) — backend contracts, frontend conventions, tool-output streaming. Pull when editing shells/code/**; deep UI walkthrough lives in docs/ui-details.md.
globs: src/public/parts/shells/code/**
alwaysApply: false
---

# code Shell (AI coding sessions)

Layout: left workspace explorer + shared conversation/file tab strip + message flow + single-card composer. Prefs live in `localStorage` (`code.shell.<user>.*`); the opened tab list and per-tab composer drafts live in backend shell data (`code.tabs`, `GET/PUT /tabs`, synced across pages via `BroadcastChannel` `fount-code-tabs`); sessions live on the target workspace (`.fount/code/sessions/<id>.json`), and the backend is the writer during generation.

| Topic | Doc |
| --- | --- |
| UI walkthrough (layout, tabs, pickers, bubbles, tool cards, power actions) | [docs/ui-details.md](docs/ui-details.md) |
| Run model, persistence, wakes, hooks, retention, shutdown/resume, CLI, usage/statistics | [docs/runtime-details.md](docs/runtime-details.md) |
| Editor extensions (`.fount/editor.json`) | [docs/editor-extensions.md](docs/editor-extensions.md) |
| Session runtime design | [code-shell-session-runtime.md](../../../../../docs/design/code-shell-session-runtime.md) |

`public/llms.txt` carries only the shell intro and API; UI / layout / shortcut detail belongs here or in `docs/ui-details.md`.

## Frontend conventions & traps

- **Composer is `createMarkdownRichInput`**: a `contenteditable` has no `.value` / `.selectionStart` — always go through the returned `richInput`. Placeholder via `richInput.setPlaceholderI18n(key)`, never by writing the span or attribute. `setRawText` / `setRangeText` do not dispatch `input`. The composer `input` handler acts **only on untrusted events** (`if (event.isTrusted || richInput.composing) return`), or every keystroke runs twice. Ghost text goes through `richInput.setSuffixHint`.
- **Message layers**: bubbles render `content_for_show ?? content`; copy / export use the show layer; edit uses `content_for_edit ?? content`. Never collapse the layers into one `content` — the agent prompt reads `content` only.
- **Reply Markdown**: `public/src/replyMarkdown.mjs` repairs an orphan bare fence after a tool result for display only; never mutate stored content. Keep both stream and final/reload assertions in `test/frontend/stream_render.spec.mjs` when changing reply rendering.
- **Streaming**: `boot` calls `warmupMarkdownPipeline()`; the streaming bubble uses the trusted tier so reasoning `<details>` show; `updateEmptyMode` treats "generating this session" as non-empty; the generating bubble is `user-content`. Live tool cards (`tool-output` `start`/`chunk`) are removed on `end`, not at `done`.
- **Run cards**: sub-agent (`subagents.mjs`, `extension.subAgent`) and async-task (`asynctasks.mjs`, `extension.asyncTask`) cards share `runCards.mjs` (`createRunCard` / `createRunCardFeed`); live state comes from `onServerEvent` filtered by `code-<sessionId>`.
- **Persisted extensions**: `src/entry_extension.mjs` `pickEntryExtension` is the whitelist of entry extensions persisted to the session — a new render field **must** be added there or WS `done` strips it. Plugin state goes under the generic `pluginData` namespace.
- **Tool output safety is the producing tool's job**: the shell renders tool / system text with the trusted Markdown tier and adds no sanitizer ([plugins/AGENTS.md](../../plugins/AGENTS.md)). Do not add a shell-side sanitizer.
- **Per-session runtime**: the run belongs to the session, input belongs to the tab, DOM only paints the active tab (`store.runtimes`, `getActiveRuntime()`); a background tab generating never blocks the composer. `submission.mjs` `submitMessage` is the single send entry — snapshot the target before the first `await`. Details: [runtime-details.md](docs/runtime-details.md#frontend-run-model).
- **Workspace switch readiness**: only `selectWorkspace` renders the workspace pill label, after the draft rebind tail finishes; callers key on that label.
- **Run identity**: every WS frame after `run-start` carries `runId` + `sessionId`; drop frames that don't match (`isCurrentRunFrame`). `ws.close()` only detaches; generation still lands on disk. Recovery never pretends to be idle.
- **a11y**: a decorative initial must be CSS-generated (`content: attr(data-initial)`) — `aria-hidden` text still counts as visible for `label-content-name-mismatch`. Labels mixing user data get `user-content="aria-label"`.
- **Locale check**: message bubbles / session title are `user-content`; tool / system bubbles and structured prompt cards are `prompt-content`. Menu items pass `i18nKey`; Playwright selects chrome via `[data-i18n="…"]`. Register `onLanguageChange` inside `boot` after `initTranslations('code')`.
- **Theming**: daisyUI full-spelled vars only; Markdown Shiki selectors depend on the `color-scheme` **attribute** — write only the attribute, never `style.colorScheme`.
- **Icons**: Iconify `<img class="text-icon">`; `icons.mjs` `fileIcon` serves `material-file-icons` as percent-encoded data URLs so `svgInliner` deliberately skips them.

## Backend (src/)

- `request.mjs` builds `chatReplyRequest_t` by hand: inline `codeWorld`, `plugins: {}` (each char declares its own set), `chat_id` = `code-<sessionId>`, `extension.generationId` per round. `triggerCodeReply` tries world `GetCharReply` then char `GetReply` — `await` each explicitly. Generation history is recorded by the char template, not the shell.
- Targets resolve through `plugins/file-operations/src/target.mjs` `createTargetExecutor` (machine 0 = local, > 0 = subfount).
- Workspace hooks (`.agents/fount/code.json` `hooks.agentStart|agentFinish|agentsIdle`), wake runs, retention, power actions and shutdown/resume: [runtime-details.md](docs/runtime-details.md#backend).
- **`fs.watch` listeners hold directory handles**: close/navigate away before deleting a workspace.
- **XML tool diagnosis**: a streaming preview placeholder only proves display recognized the tag. Check final raw char content and `logContextBefore` for tool entries.
- **Integration tests must settle the workspace before deleting it**: late persistence after `activeCodeRuns` drops the run recreates `.fount/code/sessions` and trips the temp-leak check (exit 3). Reuse `wake_append.test.mjs` `removeWorkspaceSettled`.

## CLI

- `fount run <partpath> …` uses the **last-active user**; `fount runas <user> <partpath> …` is explicit (`src/server/index.mjs`).
- `fount run code` opens the page for the detected Git root; `--cli` / `--print` / `--output-format` select terminal execution. Options: `fount run code --help`. `ArgumentsHandler` may return `{ type: 'run-js', … }` dispatched by `src/scripts/part_invoke_result.mjs` — no code-shell branching in generic dispatch. Details: [runtime-details.md](docs/runtime-details.md#cli).
