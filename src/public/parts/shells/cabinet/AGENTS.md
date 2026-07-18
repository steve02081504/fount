---
description: Cabinet shell — personal / shared file cabinets
globs: src/public/parts/shells/cabinet/**
alwaysApply: false
---

# Cabinet Shell

- **Personal**: index under `{userDict}/shells/cabinet/entities/{entityHash}/`; blobs via EVFS visibility encryption (`publish.mjs`). Index published on save (`publishCabinetIndex`).
- **Shared**: `cabinet_id` = write-pubkey hash; EVFS owner = `logicalEntityHash('fount:cabinet:shared:' + cabinetId)`. Op-log + read-key generations under `shells/cabinet/shared/{cabinetId}/`. Sync: `part_cabinet_op_put` / P2PInvoke. Transfer key uses `file-master-key-wrap` with `groupId=cabinetId`.
- **Chat binding**: DAG `cabinet_bind` / `cabinet_key_update` / `cabinet_unbind`. Bind/unbind and `role_access` changes require `ADMIN`/`MANAGE_ADMINS`; wrap-only rotation still needs `MANAGE_ROLES`. Hub files panel lists accessible cabinets.
- **Links**: `{ owner_entity_hash, cabinet_id, entry_id }`. Do not conflate entry `owner_entity_hash` (file ownership) with entity `ownerEntityHash`.
- **API**: snake_case. Password folders: `POST …/unlock` → `X-Cabinet-Unlock`. Listing: `GET …/index?parent_id=` returns `folder_trail` for breadcrumbs (same shape on remote).
- **Recoverable delete**: `DELETE …/entries` + `recoverable:true` → `recovery_token`; restore / finalize-delete endpoints. UI undo must finalize discarded tokens.
- **Shortcuts**: Ctrl/Cmd+C/X/V/A/D/Z/Y/N, F2, Delete=up. Clipboard is app-level (`sessionStorage` + `BroadcastChannel`), not OS.
- **Entity profile**: `#user:{entityHash}` — shared popup via `/parts/shells:chat/shared/entityProfilePopup.mjs`; stamps use `formatEntityAtId` / `formatHashShort`.
- **UI**: no explanatory `data-i18n` on invisible controls; omit unavailable context-menu items. Layout: `public/index.mjs` bootstrap; state `cabinetStore`; domain modules under `public/src/`.
- **Tests**: `fount test shells/cabinet --no-parallel`.
