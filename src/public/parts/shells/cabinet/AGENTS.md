---
description: Cabinet shell — personal / shared file cabinets
globs: src/public/parts/shells/cabinet/**
alwaysApply: false
---

# Cabinet Shell

- **Personal**: index under `{userDict}/shells/cabinet/entities/{entityHash}/`; blobs via EVFS visibility encryption (`publish.mjs`). Index published on save (`publishCabinetIndex`).
- **Shared**: `cabinet_id` = write-pubkey hash; EVFS owner = `logicalEntityHash('fount:cabinet:shared:' + cabinetId)`. Operation log + read-key generations under `shells/cabinet/shared/{cabinetId}/`. Sync: `part_cabinet_operation_put` / P2PInvoke. Transfer key uses `file-master-key-wrap` with `groupId=cabinetId`.
- **Chat binding**: DAG `cabinet_bind` / `cabinet_key_update` / `cabinet_unbind`. Bind/unbind and `role_access` changes require `ADMIN`/`MANAGE_ADMINS`; wrap-only rotation still needs `MANAGE_ROLES`. Hub files panel lists accessible cabinets.
- **Links**: `{ owner_entity_hash, cabinet_id, entry_id }`. Do not conflate entry `owner_entity_hash` (file ownership) with entity `ownerEntityHash`.
- **API**: snake_case. Password folders: `POST …/unlock` → `X-Cabinet-Unlock`. Listing: `GET …/index?parent_id=` returns `folder_trail` for breadcrumbs (same shape on remote).
- **Recoverable delete**: `DELETE …/entries` + `recoverable:true` → `recovery_token`; restore / finalize-delete endpoints. UI undo must finalize discarded tokens. History factories capture unlock at push time — do not re-resolve `currentUnlockToken()` in undo/redo.
- **Clipboard / shortcuts**: app-level (`sessionStorage` + `BroadcastChannel`), not OS. Keymap lives in `public/shared/keyboard`.
- **Entity profile**: `#user:{entityHash}` — shared popup via `/parts/shells:chat/shared/entityProfilePopup.mjs`; stamps use `formatEntityAtId` / `formatHashShort`.
- **UI**: no explanatory `data-i18n` on invisible controls; omit unavailable context-menu items. Layout: `public/index.mjs` bootstrap; state `cabinetStore`; DOM wiring under `public/src/`; Deno-pure helpers under `public/shared/` (`keyboard`, `commandHistory`).
- **Tests**: `fount test shells/cabinet --no-parallel`. Pure suites import `public/shared/` only — not `public/src/`. Keep Social `visibilitySpec` behind dynamic import in `remote.mjs` fetch paths so pure suites do not statically pull Social.
