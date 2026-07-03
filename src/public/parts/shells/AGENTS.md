# Shell Architecture & Creation Guide

## 1. URL & Filesystem Mapping

- **URL Pattern**: `/parts/<partpath>/<filepath_within_public>`
  - Example: `/parts/shells:chat/hub/messages.css` -> `src/public/parts/shells/chat/public/hub/messages.css`
  - Default: `/parts/shells:chat` -> `.../public/index.html`

## 2. Standard Structure

- `main.mjs`: Backend entry. Default export must include `Load({ router })` to register routes.
- `public/`: Frontend assets (HTML, JS, CSS).
  - `llms.txt`: AI-readable API documentation.
- `src/`: Backend logic.
  - `endpoints.mjs`: Define routes using `router.get/post/ws`. Path format: `/api/parts/shells\\:<name>/...`.
  - **HTTP API**: Success = 2xx JSON body without a `success` wrapper; expected failures = `throw httpError(code, message, { json?, skip_report? })` from `@src/scripts/http_error.mjs` (global `errorHandler` uses `err.http_code` / `err.json`). Avoid route-level try/catch that only maps errors to 500.
- **`fount.json` → `registries`**: Declare part-relative entries `{ id, level, path }` for `markdown_extensions`, `emoji`, `sticker`, `locales`, `home_*`, `achievements`, etc. Consumed via `GET /api/registries/:name` and `@src/public/pages/scripts/api/registries.mjs` (frontend) / `@src/server/registries.mjs` (backend). Legacy `home_registry.json` files remain valid as registry `path` targets until fully split.

## 3. Implementation Checklist

1. **Backend**: Implement `main.mjs` and `src/endpoints.mjs`. Use `authenticate` middleware from `@src/server/auth.mjs`.
2. **Frontend**: Create `public/index.html`. Include `/preload.mjs`, `/base.css`, and `/base.mjs`.
3. **Logic**: Use shared scripts from `@src/public/pages/scripts/` (theming, i18n, terminal, etc.).
4. **Docs**: Add `public/llms.txt` for AI discovery.

**Example**: See `src/public/parts/shells/shellassist/` for a complete reference.
**Chat Hub** (federation UI): [chat/public/hub/AGENTS.md](chat/public/hub/AGENTS.md) — local trust domain vs external ingress. Node-level kick/ban uses `denylist.json` (`scripts/p2p/denylist.mjs`); Social personal block/hide is separate (`personal_block.mjs` / `personal_hide.mjs`).

**See also**: [Root AGENTS.md](../../../../AGENTS.md)
