# fount Architecture & AI Agent Guide

## 1. Philosophy & Core Principles

- **Part-Based Modular Architecture**: Everything (UI, AI, Features) is a self-contained "part" loaded dynamically.
- **Evergreen Dependencies**: Deno/npm imports have no lock file (`deno.json` sets `"lock": false`). Imports are directly from URLs via Deno.
- **Single Process**: Application runtime is a monolithic process; use `async/await`. User-initiated OS launches (browser, editor, terminal) may detach a child only via `npm:open` or `@src/scripts/launch_external.mjs`; do not import `node:child_process` in part/shell/plugin code (CLI/build scripts are exempt).

## 2. System Overview

- **Server (`@src/server/`)**: Express-based. `parts_loader.mjs` is the heart, managing the lifecycle of all parts.
- **Parts**: Directory-based modules with a `main.mjs` entry point. Types: `shells`, `chars`, `worlds`, `personas`, `plugins`, `serviceSources`, etc.
- **APIs & Types**: Defined in `@src/decl/` (e.g., `CharAPI_t` in `charAPI.ts`). **Consult these files for required methods.**
- **Data Structures**:
  - `prompt_struct_t`: Central prompt building (@src/decl/prompt_struct.ts).
  - `chatMetadata_t`: Chat session state (@src/public/parts/shells/chat/src/chat/session/models.mjs).
- **Registries**: Parts declare `registries` in `fount.json` (entries `{ id, level, path }`, path is part-relative). Aggregated via `GET /api/registries/:name`; helpers at `@src/server/registries.mjs` (backend) and `@src/public/pages/scripts/registries.mjs` (frontend). Used for markdown extensions, emoji/sticker providers, home/achievements data, and part locales.

## 3. Development Guidelines

- **Create New Parts**: Mimic existing examples in `@src/public/parts/` or `@data/users/.../chars/`.
- **UI (Shells)**: Decoupled from backend. Use API endpoints in `src/server/web_server/endpoints.mjs`.
- **I18n**: Only modify `src/public/locales/zh-CN.json`; `update-locales.py` handles the rest.
- **Standards**: Run `eslint --fix --quiet` after changes(NO `npx`, just `eslint`). No logging unless error/warning.
- **Debugging**: For live backend logs, run `fount log` in a separate terminal (streams the main-process console; check it before guessing from a browser 404). For ad-hoc dumps, use `debugLog(name, data)` → `debug_logs/` (server `src/scripts/debug_log.mjs`, browser `src/public/pages/scripts/debug_log.mjs`).
- **Restart server**: `fount reboot` after code/config changes.
- **curl / API testing**: pass the API key on protected routes, e.g. `curl "http://localhost:8931/api/whoami?fount-apikey=$env:FOUNT_API_KEY"` (PowerShell `$env:FOUNT_API_KEY`, bash `$FOUNT_API_KEY`).

## 4. Specialized Guides (read on demand, not loaded by default)

Read a guide only when working on the matching task; most are auto-attached by the editor when you open files in that directory.

| When you are working on… | Read |
| --- | --- |
| P2P / federation / trust graph / Mailbox / Chat crypto / Entity files (EVFS) / trust boundaries | [src/scripts/p2p/AGENTS.md](src/scripts/p2p/AGENTS.md) |
| Frontend page logic (reusing shared scripts, i18n, theming, templates) | [src/public/pages/AGENTS.md](src/public/pages/AGENTS.md) |
| Creating or modifying a Shell (URL mapping, `Load`, endpoints) | [src/public/parts/shells/AGENTS.md](src/public/parts/shells/AGENTS.md) |
| Creating or modifying a Plugin (`GetPrompt` / `TweakPrompt` / `ReplyHandler`) | [src/public/parts/plugins/AGENTS.md](src/public/parts/plugins/AGENTS.md) |
| Chat Hub frontend (trust model, streaming, message-storage UI) | [src/public/parts/shells/chat/public/hub/AGENTS.md](src/public/parts/shells/chat/public/hub/AGENTS.md) |
| Chat cold archive (month bucketing, digest, federation backfill) | [src/public/parts/shells/chat/src/chat/archive/AGENTS.md](src/public/parts/shells/chat/src/chat/archive/AGENTS.md) |
| Social Shell frontend (follow/block, federated notifications) | [src/public/parts/shells/social/public/AGENTS.md](src/public/parts/shells/social/public/AGENTS.md) |
