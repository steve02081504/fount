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
- **Registries**: `fount.json` → `registries: [{ id, level, path }]`; `GET /api/registries/:name`; helpers: `@src/server/registries.mjs` (backend), `@src/public/pages/scripts/registries.mjs` (frontend).

## Dev Guidelines

- **New parts**: mimic `@src/public/parts/` or `@data/users/.../chars/`.
- **I18n**: only edit `src/public/locales/zh-CN.json`; `update-locales.py` syncs other langs (runs on `master` / GitHub Actions only; feature branches skip — PR CI will sync). Tree mirrors UI: shell copy under the shell id (`chat.profile`, `chat.entityProfile`, `social.composer.visibility`, …); shared UI/logic under `util.*` (`util.common`, `util.code_block`, …); top-level also has `tips` / `404` / `directoryListing` / `fountConsole`. Backend content locale: `localesForUser` / `primaryLocaleForUser` (`@src/scripts/locale.mjs`); fall back to `en-UK` when the user has no preference. Frontend: `primaryLocale()` (`@src/public/pages/scripts/i18n`). Bulk edits: `.esh/commands/update_locale_data.py` — **move keys with `get(old)` → `set(new, value)` → `set(old, None)` so each locale keeps its existing copy**; never delete then refill from zh-CN (fake/`emoji` and other non-Google targets collapse to Chinese). When updating call sites, only rewrite quoted i18n key strings — do not blind-replace `profile.xxx` object fields or module paths.
- **Lint**: `eslint --fix --quiet` (no `npx`). No logging unless error/warning.
- **Testing**: `fount test` — self-contained, no running server needed. Default loops imperfect (incl. fresh noisy) → outdated until green or a wave fails (exit 1); never full-repo unless `--all`. Group syntax: `manifest` / `manifest:suite` / `manifest:suite:subtest`. **Windows / local verification: prefer `fount test --no-parallel`** ([denoland/deno#35804](https://github.com/denoland/deno/issues/35804)). See [src/scripts/test/AGENTS.md](src/scripts/test/AGENTS.md).
- **Logs**: `fount log` — streams main-process console via `localhost` (not `127.0.0.1`). Check before guessing from browser 404s.
- **Listen bind**: `config.listen: null` — Windows Deno needs explicit dual bind `0.0.0.0` + `::` (`ipv6Only: true`); Linux/macOS use a single `::` socket (`ipv6Only: false`, IPv4 via mapped addresses). Do not also bind `0.0.0.0` on non-Windows — that hits `EADDRINUSE`. See `src/scripts/net_listen.mjs` ([denoland/deno#36168](https://github.com/denoland/deno/issues/36168)).
- **Server**: `fount server` (fg) / `fount background` (detached). Bare `fount` = `fount background; fount log`. `Test-FountRunning` before start/reboot, **not** before `fount test`.
- **Restart**: `fount reboot` for backend/code/config changes. Frontend edits take effect on browser refresh.
- **Debug dumps**: `debugLog(name, data)` → `debug_logs/`.
- **API test**: `curl "http://localhost:8931/api/whoami?fount-apikey=$env:FOUNT_API_KEY"` (PS: `$env:FOUNT_API_KEY`, bash: `$FOUNT_API_KEY`).
- **Subagent context handoff**: subagents do not inherit the parent chat's full reasoning. Before delegating, provide task definition, target paths, constraints, verified findings, and expected output.
- **No planning IDs in code**: milestone codes (`M1`/`G4`/…) belong only in design/review docs — never in source, test names, fixtures, comments, or `llms.txt`. Name by domain semantics (`poll_edit_feed`, not `m7a_features`).

## Specialized Guides

| Task | Guide |
| --- | --- |
| P2P / federation / Mailbox / EVFS | [src/server/p2p_server/AGENTS.md](src/server/p2p_server/AGENTS.md) |
| P2P package / sim tests | [fount-p2p](https://github.com/steve02081504/fount-p2p) (`@steve02081504/fount-p2p`) |
| Frontend shared scripts | [src/public/pages/AGENTS.md](src/public/pages/AGENTS.md) |
| Shell (URL, `Load`, endpoints) | [src/public/parts/shells/AGENTS.md](src/public/parts/shells/AGENTS.md) |
| Chat entity / ChatClient | [src/public/parts/shells/chat/public/AGENTS.md](src/public/parts/shells/chat/public/AGENTS.md) |
| Chat Hub frontend | [src/public/parts/shells/chat/public/hub/AGENTS.md](src/public/parts/shells/chat/public/hub/AGENTS.md) |
| Chat session / viewer / WorldChatHost | [src/public/parts/shells/chat/src/chat/session/AGENTS.md](src/public/parts/shells/chat/src/chat/session/AGENTS.md) |
| Chat cold archive | [src/public/parts/shells/chat/src/chat/archive/AGENTS.md](src/public/parts/shells/chat/src/chat/archive/AGENTS.md) |
| Social frontend | [src/public/parts/shells/social/public/AGENTS.md](src/public/parts/shells/social/public/AGENTS.md) |
| Cabinet | [src/public/parts/shells/cabinet/AGENTS.md](src/public/parts/shells/cabinet/AGENTS.md) |
| Plugin API | [src/public/parts/plugins/AGENTS.md](src/public/parts/plugins/AGENTS.md) |
| Test framework | [src/scripts/test/AGENTS.md](src/scripts/test/AGENTS.md) |
| Local search index | [src/scripts/search/AGENTS.md](src/scripts/search/AGENTS.md) |
| Docs writing (design / review) | [docs/AGENTS.md](docs/AGENTS.md) |

Baselines / reviews (read when needed, not day-to-day): [chat-social-dev-plan](docs/design/chat-social-dev-plan.md) · [world-distribution-spec](docs/design/world-distribution-spec.md) · [human-agent-operational-parity](docs/review/human-agent-operational-parity-review.md) · [chat-social-cabinet-tech-stack](docs/review/chat-social-cabinet-tech-stack.md).
