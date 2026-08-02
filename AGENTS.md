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
- **I18n**: only edit `src/public/locales/zh-CN.json`; `update-locales.py` syncs other langs (`master` / GitHub Actions; feature branches skip — PR CI syncs). Tree: shell copy under shell id (`chat.profile`, …); shared under `util.*`; top-level `tips` / `404` / `directoryListing` / `fountConsole`. Backend: `localesForUser` / `primaryLocaleForUser` (`@src/scripts/locale.mjs`, fall back `en-UK`). Frontend: `primaryLocale()` (`@src/public/pages/scripts/i18n`). Locale map slices: frontend and backend each export `matchLocale` / `getBestLocale` / `pickLocalizedSlice` from `i18n/locale_match.mjs` (strict prefix). Bulk key moves: [locale-edits.md](src/public/locales/locale-edits.md). **Write locale JSON only via Python** (`update_locale_data.py` / `update-locales.py` / `reshape_i18n_keys.py`) — JS `JSON.stringify` reorders numeric keys like `404`.
- **Emoji packs**: UI and ordering live in core `features/emoji/` + `components/emojiPicker.mjs`; chat/social only supply providers. Spec: [emoji-pack-spec](docs/design/emoji-pack-spec.md).
- **Lint**: `eslint --fix --quiet` (no `npx`). Product runtime: no logging unless error/warning. CI/workflow/test-driver progress & diagnostic output is fine. `jsdoc/require-jsdoc` covers re-exports — write a real one-liner; do not leave empty `/** */` stubs.
- **Testing**: `fount test` — self-contained, no running server. Default: imperfect (incl. fresh noisy) → outdated until green or a wave fails (exit 1); never full-repo unless `--all`. Selectors: `manifest` / `manifest:suite` / `manifest:suite:subtest`. **Windows / local: prefer `fount test --no-parallel`** ([denoland/deno#35804](https://github.com/denoland/deno/issues/35804)). See [src/scripts/test/AGENTS.md](src/scripts/test/AGENTS.md).
- **Logs**: `fount log` — main-process console via `localhost` (not `127.0.0.1`). Check before guessing from browser 404s. Interactive VT: icon_anime `intro` on start, `farewell` on `on_shutdown`; viewer owns `exitSignal`, wires `icon.signal` into it; non-TTY skips logo (player-gated). Standalone TUI: `fount logo` / `fount logo watch`.
- **Listen bind**: `config.listen: null` — OS-specific dual/`::` bind in `src/scripts/net_listen.mjs` ([denoland/deno#36168](https://github.com/denoland/deno/issues/36168)).
- **Server**: `fount server` (fg) / `fount background` (detached). Bare `fount` = `fount background; fount log`. `Test-FountRunning` before start/reboot, **not** before `fount test`.
- **Restart**: `fount reboot` for backend/code/config. Frontend edits → browser refresh.
- **Debug dumps**: `debugLog(name, data)` → `debug_logs/`.
- **API test**: `curl "http://localhost:8931/api/whoami?fount-apikey=$env:FOUNT_API_KEY"` (PS: `$env:FOUNT_API_KEY`, bash: `$FOUNT_API_KEY`).
- **Subagent handoff**: subagents do not inherit parent reasoning — pass task, paths, constraints, findings, expected output.
- **No planning IDs in code**: milestone codes (`M1`/`G4`/…) only in design/review docs — never source, tests, fixtures, comments, or `llms.txt`. Name by domain semantics.
- **path CLI**: thin entries `path/fount.{ps1,sh}` dispatch to `path/src/cmd/<name>.*` via file routing (`. $FountCmdRoute` at script scope / `fount_cmd_*`); no early-passthrough branch in entries. Each cmd loads its own deps (`fount_require` / `$FountRequireMany`); `path/src/**/*.ps1` exports use `function script:` (esh-style explicit scope — plain dot-source in `$FountRequire`). Full install/runtime via `fount_bootstrap_full` / `Invoke-FountBootstrapFull`, server via `fount_bootstrap_server` / `Invoke-FountBootstrapServer`, `remove` uses runtime modules only. Same logic as isomorphic `foo.{ps1,sh}`; platform-only under `path/src/win/` or `unix/`. Shared sh helpers: `fount_in_container`, `run_server_with_updates`, `fount_trap_terminal_teardown`, `fount_sed_escape`. `remove` scans `**/*.uninstall.<lv>.*` under `path/src`, runs highest lv first; lv `0` deletes the install tree.
- **path CI** (`test_running.yaml` job `path-cmd-smoke`): CI-only — `.github/path-ci/install-hooks.sh` swaps `src/server/index.mjs` / `src/log_viewer/index.mjs` with stubs; `run-smoke.{sh,ps1}` exercises `server` / `background` / `log` / `reboot` / `init` (install); `restore-hooks.sh` on exit. Same workflow also runs remote init → `remove` (`test-fount`).

## Specialized Guides

| Task | Guide |
| --- | --- |
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

Baselines / reviews (read when needed, not day-to-day): [chat-social-dev-plan](docs/design/chat-social-dev-plan.md) · [world-distribution-spec](docs/design/world-distribution-spec.md) · [human-agent-operational-parity](docs/review/human-agent-operational-parity-review.md) · [chat-social-cabinet-tech-stack](docs/review/chat-social-cabinet-tech-stack.md).
