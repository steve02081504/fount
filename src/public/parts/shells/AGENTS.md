---
description: Creating or modifying Shell parts (URL mapping, Load, endpoints, registries)
globs: src/public/parts/shells/**, src/decl/shellAPI.ts
alwaysApply: false
---

# Shell Architecture & Creation Guide

## URL & Filesystem Mapping

- `/parts/<partpath>/<filepath_within_public>` → `src/public/parts/<partpath>/public/<filepath_within_public>`
  - `/parts/shells:chat/hub/messages.css` → `.../shells/chat/public/hub/messages.css`
  - `/parts/shells:chat` → `.../public/index.html` (default)

## Standard Structure

- `main.mjs`: Backend entry. Default export must include `Load({ router })`.
- `public/`: Frontend assets. `public/llms.txt`: AI-readable API docs.
- `src/endpoints.mjs`: Routes via `router.get/post/ws`. Path: `/api/parts/shells\:<name>/...`.
- **HTTP API**: Success = 2xx JSON (no `success` wrapper); failures = `throw httpError(code, message, { json?, skip_report? })` from `@src/scripts/http_error.mjs`.
- **`fount.json` → `registries`**: `[{ id, level, path }]` for `markdown_extensions`, `emoji`, `sticker`, `locales`, `home_*`, `achievements`.
- **`home_function_buttons.info`**: locale **object** with `title` (e.g. `achievements.home_function_buttons.main`), not a page-level string. Home reads `geti18n(info).title`.
- **`home_function_buttons.level`** (ascending): `1` components/service sources/chat · `2` social · `3` bots · `4` cabinet · `5` integration · `90` settings · `99` access · `100+` misc. Same level → load-order unstable.
- **Iconify `button` HTML**: verify the URL returns SVG (404 body `"Not found"` is injected as icon text).

## Implementation

1. Backend: `main.mjs` + `src/endpoints.mjs` + `authenticate` from `@src/server/auth/index.mjs`.
2. Frontend: `public/index.html` — `/preload.mjs`, `/base.css`, `/base.mjs`.
3. Shared scripts: `@src/public/pages/scripts/`.
4. **GetReply identity**: when building `chatReplyRequest` yourself, `User*` must be the local operator; message authors go only in `ReplyTo*` / `chat_log[].uid`. Details: [chat/session/AGENTS.md](chat/src/chat/session/AGENTS.md) Speaker identity.
5. Add `public/llms.txt`.

**Example**: `shells/shellassist/`. **Chat**: [entity / ChatClient](chat/public/AGENTS.md), [Hub](chat/public/hub/AGENTS.md). **Social**: [social/public/AGENTS.md](social/public/AGENTS.md).

## Relative imports

- `shells/<bot>/src/*.mjs` → `src/scripts` / `src/server` / sibling `shells/chat`: **5** `../`.
- `shells/<bot>/src/default_interface/*.mjs`: **6** `../` to `src/*`, and **`../../../chat/...`** (not `../../chat`) to chat. Copy-pasting bot.mjs paths into `default_interface/` resolves wrong and breaks char Load.
