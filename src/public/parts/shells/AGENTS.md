# Shell Architecture & Creation Guide

## 1. URL & Filesystem Mapping

- **URL Pattern**: `/parts/<partpath>/<filepath_within_public>`
  - Example: `/parts/shells:chat/chat.css` -> `src/public/parts/shells/chat/public/chat.css`
  - Default: `/parts/shells:chat` -> `.../public/index.html`

## 2. Standard Structure

- `main.mjs`: Backend entry. Must export `Load({ router })` to register routes.
- `public/`: Frontend assets (HTML, JS, CSS).
  - `llms.txt`: AI-readable API documentation.
- `src/`: Backend logic.
  - `endpoints.mjs`: Define routes using `router.get/post/ws`. Path format: `/api/parts/shells\\:<name>/...`.
  - **HTTP API**: Success = 2xx JSON body without a `success` wrapper; expected failures = `throw httpError(code, message, { json?, skip_report? })` from `@src/scripts/http_error.mjs` (global `errorHandler` uses `err.code` / `err.json`). Avoid route-level try/catch that only maps errors to 500.
- `home_registry.json`: Registers the shell on the Home page.

## 3. Implementation Checklist

1. **Backend**: Implement `main.mjs` and `src/endpoints.mjs`. Use `authenticate` middleware from `@src/server/auth.mjs`.
2. **Frontend**: Create `public/index.html`. Include `/preload.mjs`, `/base.css`, and `/base.mjs`.
3. **Logic**: Use shared scripts from `@src/public/pages/scripts/` (theming, i18n, terminal, etc.).
4. **Docs**: Add `public/llms.txt` for AI discovery.

**Example**: See `src/public/parts/shells/shellassist/` for a complete reference.
**See also**: [Root AGENTS.md](../../../../AGENTS.md)
