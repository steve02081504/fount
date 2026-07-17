---
description: Creating or modifying Shell parts (URL mapping, Load, endpoints, registries)
globs: src/public/parts/shells/**, src/decl/shellAPI.ts
alwaysApply: false
---

# Shell Architecture & Creation Guide

## URL & Filesystem Mapping

- **Pattern**: `/parts/<partpath>/<filepath_within_public>` → `src/public/parts/<partpath>/public/<filepath_within_public>`
  - `/parts/shells:chat/hub/messages.css` → `.../shells/chat/public/hub/messages.css`
  - `/parts/shells:chat` → `.../public/index.html` (default)

## Standard Structure

- `main.mjs`: Backend entry. Default export must include `Load({ router })` to register routes.
- `public/`: Frontend assets. `public/llms.txt`: AI-readable API docs.
- `src/endpoints.mjs`: Routes via `router.get/post/ws`. Path format: `/api/parts/shells\:<name>/...`.
- **HTTP API**: Success = 2xx JSON body (no `success` wrapper); expected failures = `throw httpError(code, message, { json?, skip_report? })` from `@src/scripts/http_error.mjs`. Avoid route-level try/catch that only maps to 500.
- **`fount.json` → `registries`**: `[{ id, level, path }]` (part-relative) for `markdown_extensions`, `emoji`, `sticker`, `locales`, `home_*`, `achievements`. Consumed via `GET /api/registries/:name`.
- **`home_function_buttons.info`**: must point to a locale **object** with `title` (e.g. `achievements.home_function_buttons.main`), not a page-level string key like `social.title`. Home UI reads `geti18n(info).title`.
- **`home_function_buttons.level`** (top-level sidebar order, ascending): `1` components / service sources / chat · `2` social · `3` bots · `4` cabinet · `5` integration · `90` settings · `99` access · `100+` misc / in-dev. Same `level` → load-order unstable; give distinct levels when order matters.
- **Iconify `button` HTML**: verify the URL returns SVG (404 body `"Not found"` is injected as the icon span text). Prefer known names such as `mdi/file-cabinet.svg`.

## Implementation

1. Backend: `main.mjs` + `src/endpoints.mjs`. Use `authenticate` middleware from `@src/server/auth/index.mjs`.
2. Frontend: `public/index.html` — include `/preload.mjs`, `/base.css`, `/base.mjs`.
3. Use shared scripts from `@src/public/pages/scripts/`.
4. Add `public/llms.txt` for AI discovery.

**Example**: `src/public/parts/shells/shellassist/`.
**Chat**: [entity model / ChatClient](chat/public/AGENTS.md), [Hub UI](chat/public/hub/AGENTS.md).
**Social**: [social/public/AGENTS.md](social/public/AGENTS.md).
