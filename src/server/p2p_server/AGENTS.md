---
description: fount 侧 P2P 集成 — npm @steve02081504/fount-p2p、server 胶水、shell 边界
globs: src/server/p2p_server/**, src/server/web_server/p2p*.mjs, src/decl/p2pAPI.ts
alwaysApply: false
---

# P2P 集成指南（fount monorepo）

P2P 核心在 npm 包 [**@steve02081504/fount-p2p**](https://www.npmjs.com/package/@steve02081504/fount-p2p)（源码 [fount-p2p](https://github.com/steve02081504/fount-p2p)）。包内 pure/integration/live/sim 测试在包仓库运行（`npm test` / `npm run test:sim`）。

## Import 约定

- **Deno / shell / server**：`npm:@steve02081504/fount-p2p/...`（`deno.json` 映射 `@^0.0.0`）
- **浏览器 public**：`https://esm.sh/@steve02081504/fount-p2p/...`
- **归档 tunables JSON**：`npm:@steve02081504/fount-p2p/dag/tunables.json` → 映射到 `shells/chat/src/chat/lib/archive.tunables.json`（与包内 `dag/tunables.json` 同步）

## fount 侧职责

| 区域 | 路径 |
| --- | --- |
| Node 启动 / entity store 胶水 | `src/server/p2p_server/` |
| HTTP `/api/p2p/*` | `src/server/web_server/p2p_endpoints.mjs`, `p2p_file_endpoints.mjs` |
| Chat 联邦 / DAG / 加密 | `shells/chat/src/chat/` |
| Social 时间线联邦 | `shells/social/src/federation/`, `timeline/` |
| S3 / 多副本群文件后端 | `shells/chat/src/chat/lib/remoteStoragePlugins.mjs` |
| 前端 entityHash / mentions | `shells/chat/public/shared/` |

## Trust boundaries

- **不可信入站**：discovery、link envelope、WS 联邦帧、`remoteIngest`、`part_timeline_put`/`part_invoke` — 仅在 `wire/ingress`、`schemas/*`、shell 入站 gate 校验。
- **磁盘读后可信**：`events.jsonl` 只跑 `stripDagEventLocalExtensions`；reducer/UI 不重做 hex canonicalize。
- **节点数据**：`{dataPath}/p2p/node/`（`node.json`、`denylist.json`、`reputation.json` 等）；operator 密钥 `{userDict}/settings/operator.json`。
- **Mailbox**：`{dataPath}/p2p/node/mailbox/store.jsonl`；定向包走 `sendToNode`，探索 fanout 走 TrustGraph。
- **Denylist vs personal lists**：节点级 `denylist.json` vs 每实体 `personal_block.json` / `personal_hide.json`。

## Chat 壳层补充

- 权限预设：`shells/chat/src/permissions/chat.mjs`（`npm:.../permissions`）
- 冷归档：`shells/chat/src/chat/archive/AGENTS.md`
- Hub 前端：`shells/chat/public/hub/AGENTS.md`

类型：`src/decl/p2pAPI.ts`。
