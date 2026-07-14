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
- **I18n**: only edit `src/public/locales/zh-CN.json`; `update-locales.py` syncs other langs (runs on `master` / GitHub Actions only; feature branches skip — PR CI will sync).
- **Lint**: `eslint --fix --quiet` (no `npx`). No logging unless error/warning.
- **Testing**: `fount test` — self-contained, no running server needed. Group syntax: `manifest` or `manifest:suite1,suite2`. **Windows / local verification: prefer `fount test --no-parallel`** — parallel Deno children contend on `node_modules` (`nodeModulesDir: auto`, `lock: false`) and can corrupt the tree or flake ([denoland/deno#35804](https://github.com/denoland/deno/issues/35804)). See [src/scripts/test/AGENTS.md](src/scripts/test/AGENTS.md).
- **Logs**: `fount log` — streams main-process console (check before guessing from browser 404s).
- **Server**: `fount server` (fg) / `fount background` (detached). Bare `fount` = `fount background; fount log`. `Test-FountRunning` before start/reboot, **not** before `fount test`.
- **Restart**: `fount reboot` for backend/code/config changes. Frontend edits take effect on browser refresh.
- **Debug dumps**: `debugLog(name, data)` → `debug_logs/`.
- **API test**: `curl "http://localhost:8931/api/whoami?fount-apikey=$env:FOUNT_API_KEY"` (PS: `$env:FOUNT_API_KEY`, bash: `$FOUNT_API_KEY`).
- **Subagent context handoff**: subagents do not inherit the parent chat's full reasoning or implicit context. Before delegating, provide task definition, target paths, constraints, verified findings, and expected output.
- **No planning IDs in code**: roadmap milestones (`M1`/`M7a`/`G4`/`D6` 等，见 [chat-social-dev-plan.md](docs/design/chat-social-dev-plan.md)) 只留在设计 md；勿写入源码、测试名、fixture 路径、注释、`llms.txt`。文件/角色名用领域语义（如 `gentian_shell_contract`、`poll_edit_feed`），不要用里程碑代号。审计时勿用裸 `[mg]\d+`（会误伤 `groupId:'g1'` / `memberId:'m1'` / `m4a`）；优先查文件名 `^[mgd]\d+[ab]?_`、`Deno.test`/`//` 里的 `M\d+[ab]?`、以及对 `m\d+_features` 一类拼缀。

## Specialized Guides

| Task | Guide |
| --- | --- |
| P2P / federation / trust graph / Mailbox / Chat crypto / EVFS | [src/server/p2p_server/AGENTS.md](src/server/p2p_server/AGENTS.md) |
| P2P 包源码 / sim / 包内测试 | [fount-p2p](https://github.com/steve02081504/fount-p2p)（npm `@steve02081504/fount-p2p`） |
| Frontend page logic (shared scripts, i18n, theming, templates) | [src/public/pages/AGENTS.md](src/public/pages/AGENTS.md) |
| Shell (URL mapping, `Load`, endpoints) | [src/public/parts/shells/AGENTS.md](src/public/parts/shells/AGENTS.md) |
| Chat session viewer / member_roles | [src/public/parts/shells/chat/src/chat/session/AGENTS.md](src/public/parts/shells/chat/src/chat/session/AGENTS.md) |
| Chat/Social roadmap / interaction topology baseline (reply generation belongs to char; persona = human I/O middleware; `ChatClient` object model = agent operation surface, bridges implement `bridgeOps` duck type) | [docs/design/chat-social-dev-plan.md](docs/design/chat-social-dev-plan.md) |
| Human / agent operational parity (North Star + gap matrix; actingEntity / delegated signing) | [docs/review/human-agent-operational-parity-review.md](docs/review/human-agent-operational-parity-review.md) |
| World distribution model (local/replicated/hosted, WorldChatHost, world_state) | [docs/design/world-distribution-spec.md](docs/design/world-distribution-spec.md) |
| Plugin (`GetPrompt` / `TweakPrompt` / `ReplyHandler`) | [src/public/parts/plugins/AGENTS.md](src/public/parts/plugins/AGENTS.md) |
| Chat Hub frontend | [src/public/parts/shells/chat/public/hub/AGENTS.md](src/public/parts/shells/chat/public/hub/AGENTS.md) |
| Chat cold archive | [src/public/parts/shells/chat/src/chat/archive/AGENTS.md](src/public/parts/shells/chat/src/chat/archive/AGENTS.md) |
| Social Shell frontend | [src/public/parts/shells/social/public/AGENTS.md](src/public/parts/shells/social/public/AGENTS.md) |
| Test framework | [src/scripts/test/AGENTS.md](src/scripts/test/AGENTS.md) |
