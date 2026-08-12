---
description: Shell part conventions — URL mapping, Load, endpoints, registries, llms.txt, relative imports. Pull when scaffolding a new shell or changing shell-wide patterns; skip routine edits inside chat/social/cabinet (own AGENTS.md).
globs: src/public/parts/shells/*/main.mjs, src/public/parts/shells/*/fount.json, src/public/parts/shells/*/public/llms.txt, src/public/parts/shells/*/public/index.html, src/public/parts/shells/*/src/endpoints.mjs, src/decl/shellAPI.ts
alwaysApply: false
---

# Shell Architecture & Creation Guide

## URL & Filesystem Mapping

- `/parts/<partpath>/<filepath_within_public>` → `src/public/parts/<partpath>/public/<filepath_within_public>`
  - `/parts/shells:chat/hub/messages.css` → `.../shells/chat/public/hub/messages.css`
  - `/parts/shells:chat` → `.../public/index.html` (default)
- Path helpers (SSOT): browser `/scripts/lib/partPaths.mjs` · Deno `src/scripts/part_paths.mjs`（再导出）— `partpathToUrlPrefix` / `partpathToUrlPartKey` / `urlPartKeyToPartpath` / `parsePartsUrlPath` / `partPublicRelToBrowserPath`。勿再手写 `replace(/:/g,'/')` 或 `replaceAll('/',':')`。

## Standard Structure

- `main.mjs`: Backend entry. Default export must include `Load({ router })`.
- `public/`: Frontend assets. `public/llms.txt`: AI-readable docs — **Chinese only**; keep part intro, operational conclusions/guidelines, and every HTTP/WS API with usage. No research notes, design-doc § refs, wire-protocol dumps, or in-process client APIs (those belong in `AGENTS.md` / `decl/`).
- `src/endpoints.mjs`: **Backend** Express routes via `router.get/post/ws`. Path: `/api/parts/shells:<name>/...`.
- **Frontend HTTP**: `public/src/endpoints.mjs` or `public/src/endpoints/*.mjs` — **named exports only**. No path-string clients (`socialApi('/…')`, `api(method, path)`, UI-facing `groupFetch(path)`). UI / shared / providers must not `fetch` shell REST; use endpoints. Global `/api/whoami`, `/api/getdetails…`, EVFS → `@src/public/pages/scripts/endpoints/`. HTML templates → shell `templates.mjs` (`templatesFor` / `dialogsFor`), never `fetch(…html)` or bare `usingTemplates`.
- **HTTP API**: Success = 2xx JSON (no `success` wrapper); failures = `throw httpError(code, message, { json?, skip_report? })` from `@src/scripts/http_error.mjs`.
- **`fount.json` → `registries`**: `[{ id, level, path }]` for `markdown_extensions`, `emoji`, `locales`, `home_*`, `achievements`.
- **`home_function_buttons.info`**: locale **object** with `title` (e.g. `achievements.home_function_buttons.main`), not a page-level string. Home reads `geti18n(info).title`.
- **`home_function_buttons.level`**: ascending sort; same level → load-order unstable.
- **Iconify `button` HTML**: verify the URL returns SVG (404 body `"Not found"` is injected as icon text).

## Implementation

1. Backend: `main.mjs` + `src/endpoints.mjs` + `authenticate` from `@src/server/auth/index.mjs`.
2. Frontend: `public/index.html` — `/preload.mjs`, `/base.css`, `/base.mjs`.
3. Shared scripts: `@src/public/pages/scripts/`.
4. **GetReply identity**: when building `chatReplyRequest` yourself, `User*` must be the local operator; message authors go only in `ReplyTo*` / `chat_log[].uid`. Details: [chat/session/AGENTS.md](chat/src/chat/session/AGENTS.md) Speaker identity. Platform bots use virtual bridge sessions — never `newGroup` for Discord/Telegram/WeChat chats.
5. Add `public/llms.txt`.

**Example**: `shells/shellassist/`. **Chat**: [entity / ChatClient](chat/public/AGENTS.md), [Hub](chat/public/hub/AGENTS.md). **Social**: [social/public/AGENTS.md](social/public/AGENTS.md).

## Relative imports

Bot shells: from `src/*.mjs` use **5** `../` to reach `src/scripts` / `src/server` / sibling `shells/chat`. From `src/default_interface/*.mjs` use **6** `../` to `src/*`, and **`../../../chat/...`** (not `../../chat`) to chat.

Cross-shell `public/shared` renames: bot integration triggers watch `chat/public/shared/**`; `module_graph_probe` + `shellLoadProbe.missingNamed` fail on stale named imports.
