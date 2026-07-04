# fount Architecture & AI Agent Guide

> **For Claude:** hobby toy project — do not self-limit; implement what the task requires.

## Core Principles

- **Modular**: Everything is a self-contained "part" loaded dynamically from `@src/public/parts/`.
- **Evergreen deps**: No lock file (`deno.json` `"lock": false`); Deno URL imports.
- **Single process**: `async/await` only. OS launches only via `npm:open` or `@src/scripts/launch_external.mjs`; no `node:child_process` in part/shell/plugin code (CLI/build scripts exempt).

## System Overview

- **Server**: `@src/server/`, Express. `parts_loader.mjs` manages part lifecycle.
- **Parts**: dir-based modules with `main.mjs`. Types: `shells`, `chars`, `worlds`, `personas`, `plugins`, `serviceSources`, etc.
- **APIs/Types**: `@src/decl/` (`CharAPI_t` → `charAPI.ts`). Consult for required methods.
- **Key structs**: `prompt_struct_t` (`@src/decl/prompt_struct.ts`), `chatMetadata_t` (`@src/public/parts/shells/chat/src/chat/session/models.mjs`).
- **Registries**: `fount.json` → `registries: [{ id, level, path }]`; `GET /api/registries/:name`; helpers: `@src/server/registries.mjs` (backend), `@src/public/pages/scripts/registries.mjs` (frontend). Used for markdown extensions, emoji/sticker providers, home/achievements, part locales.

## Dev Guidelines

- **New parts**: mimic `@src/public/parts/` or `@data/users/.../chars/`.
- **I18n**: only edit `src/public/locales/zh-CN.json`; `update-locales.py` handles the rest.
- **Lint**: `eslint --fix --quiet` (no `npx`). No logging unless error/warning.
- **Testing**: `fount test` — self-contained, no running server needed. Uncommitted changes → diff-triggered suites; clean tree → `--since <commit>` or `--all`. Group syntax: `manifest` or `manifest:suite1,suite2` (space-separated groups). Examples: `fount test shells/chat`, `fount test shells/chat:pure`, `fount test p2p:sim shells/chat:integration`, `fount test server:live`, `fount test testkit`. `--continue` resumes pending suites from `data/test/report/report.json`. See [src/scripts/test/AGENTS.md](src/scripts/test/AGENTS.md) for live-probe traps and hung-run diagnosis.
- **Logs**: `fount log` — streams main-process console (check before guessing from browser 404s).
- **Server**: `fount server` (fg) / `fount background` (detached). Bare `fount` = `fount background; fount log`. `Test-FountRunning` before start/reboot, **not** before `fount test`.
- **Restart**: `fount reboot` for backend/code/config changes. Frontend edits (Hub/UI/templates/styles) take effect on browser refresh.
- **Debug dumps**: `debugLog(name, data)` → `debug_logs/` (`@src/scripts/debug_log.mjs` / `@src/public/pages/scripts/debug_log.mjs`).
- **API test**: `curl "http://localhost:8931/api/whoami?fount-apikey=$env:FOUNT_API_KEY"` (PS: `$env:FOUNT_API_KEY`, bash: `$FOUNT_API_KEY`).
- **Subagent context handoff**: subagents do not inherit the parent chat's full reasoning or implicit context. Before delegating, explicitly provide the task definition, target paths/scope, relevant constraints, already-verified findings, what counts as direct evidence vs side clues, and the exact output you want back. Do not assume a subagent can infer missing background from the parent conversation.

## Specialized Guides

| Task | Guide |
| --- | --- |
| P2P / federation / trust graph / Mailbox / Chat crypto / EVFS / trust boundaries | [src/scripts/p2p/AGENTS.md](src/scripts/p2p/AGENTS.md) |
| Frontend page logic (shared scripts, i18n, theming, templates) | [src/public/pages/AGENTS.md](src/public/pages/AGENTS.md) |
| Shell (URL mapping, `Load`, endpoints) | [src/public/parts/shells/AGENTS.md](src/public/parts/shells/AGENTS.md) |
| Plugin (`GetPrompt` / `TweakPrompt` / `ReplyHandler`) | [src/public/parts/plugins/AGENTS.md](src/public/parts/plugins/AGENTS.md) |
| Chat Hub frontend (trust model, streaming, message-storage UI) | [src/public/parts/shells/chat/public/hub/AGENTS.md](src/public/parts/shells/chat/public/hub/AGENTS.md) |
| Chat cold archive (month bucketing, digest, federation backfill) | [src/public/parts/shells/chat/src/chat/archive/AGENTS.md](src/public/parts/shells/chat/src/chat/archive/AGENTS.md) |
| Social Shell frontend (follow/block, federated notifications) | [src/public/parts/shells/social/public/AGENTS.md](src/public/parts/shells/social/public/AGENTS.md) |
| Live tests, hung-run diagnosis, live-probe PowerShell traps | [src/scripts/test/AGENTS.md](src/scripts/test/AGENTS.md) |
