# fount Architecture & AI Agent Guide

## 1. Philosophy & Core Principles

- **Part-Based Modular Architecture**: Everything (UI, AI, Features) is a self-contained "part" loaded dynamically.
- **Evergreen Dependencies**: No lock files. Imports are directly from URLs via Deno.
- **Single Process**: Monolithic process; no child processes allowed. Use `async/await`.

## 2. System Overview

- **Server (`@src/server/`)**: Express-based. `parts_loader.mjs` is the heart, managing the lifecycle of all parts.
- **Parts**: Directory-based modules with a `main.mjs` entry point. Types: `shells`, `chars`, `worlds`, `personas`, `plugins`, `serviceSources`, etc.
- **APIs & Types**: Defined in `@src/decl/` (e.g., `CharAPI_t` in `charAPI.ts`). **Consult these files for required methods.**
- **Data Structures**:
  - `prompt_struct_t`: Central prompt building (@src/decl/prompt_struct.ts).
  - `chatMetadata_t`: Chat session state (@src/public/parts/shells/chat/src/chat.mjs).

## 3. Development Guidelines

- **Create New Parts**: Mimic existing examples in `@src/public/parts/` or `@data/users/.../chars/`.
- **UI (Shells)**: Decoupled from backend. Use API endpoints in `src/server/web_server/endpoints.mjs`.
- **I18n**: Only modify `src/public/locales/zh-CN.json`; `update-locales.py` handles the rest.
- **Standards**: Run `eslint --fix --quiet` after changes(NO `npx`, just `eslint`). No logging unless error/warning.
- **Debug file logs** (`debug_logs/`, gitignored): `debugLog(name, data)` — server: `src/scripts/debug_log.mjs`; browser: `src/public/pages/scripts/debug_log.mjs` (`POST /api/test/debug-log`, requires login).
- **Restart server**: Run `fount reboot` to restart the fount server after code or config changes.
- **curl / API testing**: Pass API key on protected routes, e.g. `curl "http://localhost:8931/api/whoami?fount-apikey=$env:FOUNT_API_KEY"` (PowerShell: `$env:FOUNT_API_KEY`; bash: `$FOUNT_API_KEY`).

## 4. Specialized Guides

- [Frontend Common Functions Guide](src/public/pages/AGENTS.md)
- [Shell Architecture Guide](src/public/parts/shells/AGENTS.md)
- [Plugin Architecture Guide](src/public/parts/plugins/AGENTS.md)
