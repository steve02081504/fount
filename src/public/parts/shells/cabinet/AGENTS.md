---
description: Cabinet shell — personal / shared file cabinets
globs: src/public/parts/shells/cabinet/**
alwaysApply: false
---

# Cabinet Shell

- **Personal**: index under `{userDict}/shells/cabinet/entities/{entityHash}/`; blobs via EVFS visibility encryption (`publish.mjs`). Index published on save (`publishCabinetIndex`).
- **Shared**: `cabinet_id` = write-pubkey hash; EVFS owner = `logicalEntityHash('fount:cabinet:shared:' + cabinetId)`. Op-log + read-key generations under `shells/cabinet/shared/{cabinetId}/`. Sync: `part_cabinet_operation_put` / P2PInvoke. Transfer key: `file-master-key-wrap` with `groupId=cabinetId`.
- **Chat binding**: DAG `cabinet_bind` / `cabinet_key_update` / `cabinet_unbind`. Bind/unbind and `role_access` need `ADMIN`/`MANAGE_ADMINS`; wrap-only rotation still needs `MANAGE_ROLES`. Hub files panel lists accessible cabinets.
- **Links**: `{ owner_entity_hash, cabinet_id, entry_id }`. Do not conflate entry `owner_entity_hash` (file ownership) with entity `ownerEntityHash`.
- **API**: snake_case. Password folders: `POST …/unlock` → `X-Cabinet-Unlock`. Listing: `GET …/index?parent_id=` returns `folder_trail` (same on remote).
- **Recoverable delete**: `DELETE …/entries` + `recoverable:true` → `recovery_token`; UI undo must finalize discarded tokens. History factories capture unlock at push time — do not re-resolve `currentUnlockToken()` in undo/redo.
- **Clipboard / shortcuts**: app-level (`sessionStorage` + `BroadcastChannel`), not OS. Keymap: `public/shared/keyboard`.
- **Entity profile**: `#user:{entityHash}` via chat `entityProfilePopup.mjs`.
- **UI**: Bootstrap `public/index.mjs`; state `cabinetStore`; named endpoints in `public/src/endpoints.mjs`; DOM under `public/src/`; Deno-pure under `public/shared/`. DaisyUI + shared `promptDialog` / `positionContextMenu`. Entry grid: `role="listbox"` + `aria-multiselectable`. SPA hashes: `` `${location.pathname}#…` ``. Omit unavailable context-menu items; no explanatory `data-i18n` on invisible controls.
- **Tests**: `fount test shells/cabinet`. Pure suites import `public/shared/` only — keep Social `visibilitySpec` behind dynamic import in `remote.mjs`.
