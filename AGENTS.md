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
- **Service sources**: types under `serviceSources/{AI,search,translate,SpeechRecognition}/` + generators under `serviceGenerators/...`. `SpeechRecognitionSource_t.Recognize({ audio | feed, onResult })` — stream-first feed, buffer convenience.

## Dev Guidelines

- **New parts**: mimic `@src/public/parts/` or `@data/users/.../chars/`.
- **I18n**: edit `src/public/locales/zh-CN.json` day-to-day; `update-locales.py` syncs other langs (`master` / GitHub Actions; feature branches skip — PR CI syncs). **Write locale JSON only via Python** — JS `JSON.stringify` reorders numeric keys like `404`. Switch leaves / params / tree layout: [i18n-notes.md](src/public/pages/docs/i18n-notes.md). Bulk key moves: [locale-edits.md](src/public/locales/docs/locale-edits.md).
- **Emoji packs**: UI and ordering live in core `features/emoji/` + `components/emojiPicker.mjs`; chat/social only supply providers. Spec: [emoji-pack-spec](docs/design/emoji-pack-spec.md).
- **Lint**: `eslint --fix --quiet` (no `npx`). Product runtime: no logging unless error/warning. CI/workflow/test-driver progress & diagnostic output is fine. `jsdoc/require-jsdoc` covers re-exports — write a real one-liner; do not leave empty `/** */` stubs.
- **IDs / case**: compare hex / `entityHash` / `eventId` keys as-is — no `.toLowerCase()` or convenience `normalizeHex64` on local data; body search uses `RegExp(..., 'i')`, do not pre-lower the haystack. `normalizeHex64` only for verify domains, deterministic protocol IDs, and untrusted inbound auth. When JSDoc is already `string`, do not wrap with `String(x || '')`. Inverted-index posting-key exception: [search/AGENTS.md](src/scripts/search/AGENTS.md).
- **Testing**: `fount test` — self-contained, no running server; path CLI runs `deno upgrade canary` first (matches CI). Default: imperfect (incl. fresh noisy) → outdated until green or a wave fails (exit 1); never full-repo unless `--all`. Selectors: `manifest` / `manifest:suite` / `manifest:suite:subtest`. Live display: `fount test --watch`. See [src/scripts/test/AGENTS.md](src/scripts/test/AGENTS.md).
- **Logs**: `fount log` — main-process console via `localhost` (not `127.0.0.1`). Check before guessing from browser 404s. Selector one-shot: `fount log error:5` / `error+warn:10` / `:20` / `5` (`src/log_viewer/selector.mjs`). VT logo on log viewer / fg server TTY: [imgs/icon_anime/AGENTS.md](imgs/icon_anime/AGENTS.md). Standalone: `fount logo` / `fount logo watch`.
- **Listen bind**: `config.listen: null` — OS-specific dual/`::` bind in `src/scripts/net_listen.mjs` ([denoland/deno#36168](https://github.com/denoland/deno/issues/36168)).
- **Server**: `fount server` (fg) / `fount background` (detached). Bare `fount` = `fount background; fount log`. `Test-FountRunning` before start/reboot, **not** before `fount test`.
- **Restart**: `fount reboot` for backend/code/config. Frontend edits → browser refresh. No per-module reload — `reloadPart` restarts the process; don't try `?v=` busting. Upstream: [part-hot-reload](docs/issues/part-hot-reload.md).
- **Debug dumps**: `debugLog(name, data)` → `debug_logs/`.
- **API test**: `curl "http://localhost:8931/api/whoami?fount-apikey=$env:FOUNT_API_KEY"` (PS: `$env:FOUNT_API_KEY`, bash: `$FOUNT_API_KEY`).
- **Subagent handoff**: subagents do not inherit parent reasoning — pass task, paths, constraints, findings, expected output.
- **No planning IDs in code**: milestone codes (`M1`/`G4`/…) only in design/review docs — never source, tests, fixtures, comments, or `llms.txt`.
- **path CLI**: [path/AGENTS.md](path/AGENTS.md).

## Specialized Guides

| Task | Guide |
| --- | --- |
| path CLI | [path/AGENTS.md](path/AGENTS.md) |
| Logo TUI / icon_anime | [imgs/icon_anime/AGENTS.md](imgs/icon_anime/AGENTS.md) |
| P2P / federation / Mailbox / EVFS | [src/server/p2p_server/AGENTS.md](src/server/p2p_server/AGENTS.md) |
| P2P package / sim tests | [fount-p2p](https://github.com/steve02081504/fount-p2p) (`@steve02081504/fount-p2p`) |
| Frontend shared scripts | [src/public/pages/AGENTS.md](src/public/pages/AGENTS.md) |
| Shell (URL, `Load`, endpoints) | [src/public/parts/shells/AGENTS.md](src/public/parts/shells/AGENTS.md) |
| Chat entity / ChatClient | [src/public/parts/shells/chat/public/AGENTS.md](src/public/parts/shells/chat/public/AGENTS.md) |
| Chat Hub frontend | [src/public/parts/shells/chat/public/hub/AGENTS.md](src/public/parts/shells/chat/public/hub/AGENTS.md) |
| Chat session / viewer | [src/public/parts/shells/chat/src/chat/session/AGENTS.md](src/public/parts/shells/chat/src/chat/session/AGENTS.md) |
| Chat cold archive | [src/public/parts/shells/chat/src/chat/archive/AGENTS.md](src/public/parts/shells/chat/src/chat/archive/AGENTS.md) |
| Social frontend | [src/public/parts/shells/social/public/AGENTS.md](src/public/parts/shells/social/public/AGENTS.md) |
| Cabinet | [src/public/parts/shells/cabinet/AGENTS.md](src/public/parts/shells/cabinet/AGENTS.md) |
| Plugin API | [src/public/parts/plugins/AGENTS.md](src/public/parts/plugins/AGENTS.md) |
| Test framework | [src/scripts/test/AGENTS.md](src/scripts/test/AGENTS.md) |
| Static checks (HTML / i18n / AGENTS English / JSDoc) | [src/scripts/checks/AGENTS.md](src/scripts/checks/AGENTS.md) |
| Local search index | [src/scripts/search/AGENTS.md](src/scripts/search/AGENTS.md) |
| Docs writing (design / review) | [docs/AGENTS.md](docs/AGENTS.md) |

Baselines / reviews (read when needed, not day-to-day): [chat-social-dev-plan](docs/design/chat-social-dev-plan.md) · [world-distribution-spec](docs/design/world-distribution-spec.md) · [human-agent-operational-parity](docs/review/human-agent-operational-parity-review.md) · [chat-social-cabinet-tech-stack](docs/review/chat-social-cabinet-tech-stack.md). Issue trackers: [part-hot-reload](docs/issues/part-hot-reload.md).
