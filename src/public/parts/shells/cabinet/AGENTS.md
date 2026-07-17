---
description: Cabinet shell — personal / shared file cabinets
globs: src/public/parts/shells/cabinet/**
alwaysApply: false
---

# Cabinet Shell

- **Personal cabinets**: local index under `{userDict}/shells/cabinet/entities/{entityHash}/`; blobs via EVFS with visibility encryption (`publish.mjs`). Index published to EVFS on save (`publishCabinetIndex`).
- **Shared cabinets**: `cabinet_id` = write-pubkey hash; EVFS owner = `logicalEntityHash('fount:cabinet:shared:' + cabinetId)` (128 hex). Encrypted signed op-log + read-key generations under `{userDict}/shells/cabinet/shared/{cabinetId}/`. Blob logical path = `blobs/{entryId}` under that owner. Sync via `part_cabinet_op_put` / P2PInvoke pull. Transfer key uses `file-master-key-wrap` shape with `groupId=cabinetId` (cabinet transfer owner).
- **Chat binding**: group DAG `cabinet_bind` / `cabinet_key_update` / `cabinet_unbind` wraps read/write keys to roles; Hub files panel lists accessible cabinets.
- **Links**: id triples `{ owner_entity_hash, cabinet_id, entry_id }`; local-entity inbound refcount keeps orphaned targets until unlink GC.
- **API body / stored fields**: snake_case. Password folders: `POST …/unlock` → `X-Cabinet-Unlock` header.
- **Directory listing**: `GET …/index?parent_id=` returns `folder_trail: [{ id, name }]` from cabinet root to the current folder; use it for named breadcrumbs so refreshes and deep links never display raw IDs.
- **Recoverable delete**: `DELETE …/entries` with `recoverable:true` → `{ deleted, recovery_token }` (blobs kept). Restore via `POST …/entries/restore`; hard-delete via `POST …/entries/finalize-delete`. UI undo stack must finalize discarded tokens.
- **Shortcuts**: Ctrl/Cmd+C/X/V/A/D/Z/Y/N, F2 rename, Delete = go up. Clipboard is app-level (`sessionStorage` + `BroadcastChannel`), not OS clipboard.
- **Default cabinet**: `cabinet_id: default` seeded from `default/templates/cabinet/`.
- **Entity profile**: `#user:{entityHash}` 远端浏览条与属性面板创建/修改者戳记可打开共享人物卡（`/parts/shells:chat/shared/entityProfilePopup.mjs`）；bio 由共享卡本机 markdown 安全渲染。戳记 / 远端条短码用 chat `formatEntityAtId` / `formatHashShort`，勿裸 `hash.slice`。勿与柜条目的 `owner_entity_hash`（文件归属）混淆实体所属 `ownerEntityHash`。
- **Tests**: `fount test shells/cabinet --no-parallel`.
