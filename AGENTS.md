# fount Architecture & AI Agent Guide

## 1. Philosophy & Core Principles

- **Part-Based Modular Architecture**: Everything (UI, AI, Features) is a self-contained "part" loaded dynamically.
- **Evergreen Dependencies**: No lock files. Imports are directly from URLs via Deno.
- **Single Process**: Monolithic process; no child processes allowed. Use `async/await`. User-initiated OS launches (browser, editor, terminal) may detach a child only via `npm:open` or `@src/scripts/launch_external.mjs`; do not import `node:child_process` elsewhere for that purpose.

## 2. System Overview

- **Server (`@src/server/`)**: Express-based. `parts_loader.mjs` is the heart, managing the lifecycle of all parts.
- **Parts**: Directory-based modules with a `main.mjs` entry point. Types: `shells`, `chars`, `worlds`, `personas`, `plugins`, `serviceSources`, etc.
- **APIs & Types**: Defined in `@src/decl/` (e.g., `CharAPI_t` in `charAPI.ts`). **Consult these files for required methods.**
- **Data Structures**:
  - `prompt_struct_t`: Central prompt building (@src/decl/prompt_struct.ts).
  - `chatMetadata_t`: Chat session state (@src/public/parts/shells/chat/src/chat/session.mjs).

## 3. Development Guidelines

- **Create New Parts**: Mimic existing examples in `@src/public/parts/` or `@data/users/.../chars/`.
- **UI (Shells)**: Decoupled from backend. Use API endpoints in `src/server/web_server/endpoints.mjs`.
- **I18n**: Only modify `src/public/locales/zh-CN.json`; `update-locales.py` handles the rest.
- **Standards**: Run `eslint --fix --quiet` after changes(NO `npx`, just `eslint`). No logging unless error/warning.
- **Backend live logs (preferred for debugging)**: Run **`fount log`** in a **separate terminal** while the server is up. It connects to `ws://127.0.0.1:<port>/ws/logs` (`src/log_viewer/index.mjs`) and streams the main process `console` (part load errors, `Failed to load part …`, `ERR_MODULE_NOT_FOUND`, HTTP traces). Plain `fount` (no args) already starts the server in the background and attaches the log viewer in the current terminal; use `fount server` / background-only setups when you need the log in another window. Do not guess from browser 404 alone—check this stream first.
- **Debug file logs** (`debug_logs/`, gitignored): `debugLog(name, data)` — server: `src/scripts/debug_log.mjs`; browser: `src/public/pages/scripts/debug_log.mjs` (`POST /api/test/debug-log`, requires login).
- **Restart server**: Run `fount reboot` to restart the fount server after code or config changes.
- **curl / API testing**: Pass API key on protected routes, e.g. `curl "http://localhost:8931/api/whoami?fount-apikey=$env:FOUNT_API_KEY"` (PowerShell: `$env:FOUNT_API_KEY`; bash: `$FOUNT_API_KEY`).

## 4. Trust boundaries (P2P)

- **Untrusted ingress**: Trystero、群 WebSocket 联邦帧、`remoteIngest`、`social_timeline_put` / `social_rpc` — 校验与 `canonicalize*` 仅在此边界。
- **Trusted after disk**: `events.jsonl` 读出后仅做 `sanitizeFederatedEvent`（剥扩展键）；reducer / Hub / Social UI 不再重复 hex 规范化。
- **User-level P2P identity/profile**: `{userDict}/settings/federation.json`（公钥/relay/batterySaver）、`network.json`（trusted/explore peers + hints）、`blocklist.json`、`reputation.json`；entity 资料 `{userDict}/entities/{entityHash}/profile.json`；HTTP 见 `/api/p2p/federation`、`/api/p2p/network`、`/api/p2p/blocklist`、`/api/p2p/entities/*`、`/api/p2p/viewer`（`src/server/web_server/p2p_endpoints.mjs`）。不依赖 shell Load。
- **TrustGraph fanout**: Social timeline / chunk 探索经 `fanoutToTopNodes`；**定向业务包**（Mailbox、`deliver`）仅用 `sendToNode` / User Room，不走 fanout。群房间经 `registerFederationRoomProvider` 注入（Chat Load 注册），P2P 层不 import Chat。User room 密码 `sha256('fount-user-room:' + nodeHash)`，作为全局 Public Inbox。
- **Mailbox（P2P）**: 存转 `{userDict}/p2p/mailbox/store.jsonl`；`deliver` / `deliverOrStoreMailboxPut`（`scripts/p2p/deliver.mjs`、`mailbox/deliver_or_store.mjs`）；Part 用 `registerMailboxConsumer` 消费 envelope。HTTP `GET /api/p2p/mailbox/summary`。
- **Chat 消息加密**: 频道域密钥 `K_ch`（`channel_key_rotate` DAG + HPKE wraps）；wire scheme **`ckg`**。**CKG 解密 payload 不可脱离外层 DAG Ed25519 签名上下文单独传递或信任**（对称层仅保密性）。群文件主密钥 `fileMasterKey`（`peer_invite` / 联邦 pull 的 `fileKeyWraps`，与 `channelKeyWraps` 对称命名）。密码学原语见 `scripts/p2p/key_crypto.mjs`。入站校验 `channel_key_rotate` 与 `assertFederatedCkgContent`。
- **Chat 帖子存储**: 热区（checkpoint `hot_posts.latestByChannel` 每频道最新 N + pin ±N；群设置 `hotLatestMessageCount`）+ 冷归档（`archive/{channelId}/{YYYY-MM}.jsonl` 明文 `PostSnapshot`，月 digest 为 eventId 序滚动 SHA-256）+ DAG 仅折叠过程事件；默认不自动删可见历史，成员可在群设置按月删**本机**冷归档副本（不动 DAG）。联邦按月拉取：`digest` + `fed_chunk_*` 分块传输 + `monthDigests` 多 peer 信誉仲裁（`ARCHIVE_QUORUM_PEER_MIN` 满足可提前结束收集）；入群 checkpoint 同模式；远端 manifest 仅 union 月份 hint。
- **Mailbox 路由**: `federation.json` → `mailbox.maxHop` / `relayFanout*` / `wantFanout`（`batterySaver` 时 fanout 减半）。
- **Social 关注真相源**: 无 `following.json`；follow/unfollow 仅写入 operator 时间线 `events.jsonl` + 联邦 fanout + `network.json` explore hints。

## 5. Entity 文件（EVFS）

- **统一 URL**：`GET|PUT|HEAD /api/p2p/entities/{entityHash}/files/{*path}`。
- **两层存储**：密文块 `{userDict}/p2p/chunks/`（CAS）；逻辑 manifest `{userDict}/entities/{entityHash}/files/{path}.manifest.json`。
- **群文件**：`groupEntityHash` + 路径 `chat/{fileId}`；chunk miss 走群联邦或 TrustGraph `fed_chunk_get`。
- **核心模块**：`src/scripts/p2p/files/`、`src/scripts/p2p/entity/files/`（evfs、acl、url）。

## 6. Specialized Guides

- [Frontend Common Functions Guide](src/public/pages/AGENTS.md)
- [Shell Architecture Guide](src/public/parts/shells/AGENTS.md)
- [Plugin Architecture Guide](src/public/parts/plugins/AGENTS.md)
