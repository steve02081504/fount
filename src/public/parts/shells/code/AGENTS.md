# code Shell (AI coding sessions)

opencode-style web layout: sessions sidebar / message flow / composer. Selections and lifetime state live in `localStorage` prefs (`code.shell.<user>.*`); sessions live on the target workspace (`.fount/code/sessions/<id>.json`, written only by the frontend).

## Frontend conventions (public/index.mjs)

- **Composer is `createMarkdownRichInput`** (textarea-compatible API). A `contenteditable` element has no `.value` / `.selectionStart` — always read/write via the returned `richInput` (`richInput.value`, `richInput.selectionStart`, `richInput.setRangeText`). Reading `elements.composerInput.value` silently yields `undefined`.
- **Shell mode (`！`/`!`)**: entered from an empty composer via the `input` handler; the `！` stays in the input as the mode hint. Exits when the user deletes everything; programmatic `richInput.value = ''` re-triggers an `input` event — guard with `suppressComposerInput` or the handler will immediately leave shell mode. On send, strip the leading `！` (`value.replace(/^[!！]/, '')`).
- `/` commands panel / `@` file autocomplete consume `state.commands` (merged builtin/global/workspace lists from `GET /profiles`) and `GET /files/search`.
- Session flush (single writer = frontend): `markSessionDirty` → flush on `window.blur` / `visibilitychange` / `beforeunload` and immediately when marked while not generating; WS `send` carries the whole session, `done` returns entries + `chat_scoped_char_memory` which replaces local state.
- Register the `onLanguageChange` rerender **inside `boot` after `initTranslations('code')`** — `onLanguageChange` fires its callback on registration; module-top-level registration warns `[i18n:missing]` before the bundle loads.

## Backend (src/)

- `request.mjs` builds `chatReplyRequest_t` by hand: world = inline `codeWorld` (injects selected profile + workspace AGENTS.md), plugins = `code-execution` + `file-operations`, request-level `ai_source` / `workdir: {machine, path}`.
- Targets resolve through `plugins/file-operations/src/target.mjs` (`createTargetExecutor`): machine 0 = local (`node:fs` + exec), machine > 0 = subfount executors. `listMachines(username)` backs `GET /machines` and the AI-facing `<list-machines></list-machines>` tag handled in `file-operations/handler.mjs`; it tolerates users without a subfount manager by returning localhost only.
- Sessions are validated with `/^[A-Za-z0-9_-]{1,64}$/` before touching the fs; deletion goes through a remote-fs script because the executor has no delete primitive.
- Shell data gotcha (repo-wide): `saveShellData(username, shell, name)` persists the **in-memory cache entry**, not a passed value — mutate the object returned by `loadShellData` first, or call `assignShellData` to swap the value.
