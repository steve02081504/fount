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
- **Recoverable delete**: `DELETE …/entries` + `recoverable:true` → `recovery_token`; restore / finalize-delete endpoints. UI undo must finalize discarded tokens. History factories capture unlock at push time — do not re-resolve `currentUnlockToken()` in undo/redo.
- **Clipboard / shortcuts**: app-level (`sessionStorage` + `BroadcastChannel`), not OS. Keymap: `public/shared/keyboard`.
- **Entity profile**: `#user:{entityHash}` — `/parts/shells:chat/shared/entityProfilePopup.mjs`; stamps via `formatEntityAtId` / `formatHashShort`.
- **UI**: Bootstrap `public/index.mjs` (`applyTheme` + `initTranslations`); state `cabinetStore`; frontend HTTP named endpoints in `public/src/endpoints.mjs`; DOM under `public/src/`; Deno-pure helpers under `public/shared/` (`keyboard`, `commandHistory`). Prefer DaisyUI + shared `promptDialog` / `positionContextMenu`. Entry grid: `role="listbox"` + `aria-multiselectable`, cards `role="option"` + `aria-selected`. Context menu: `#contextMenu` = `ul.menu[role=menu]`. SPA hashes: `` `${location.pathname}#…` `` (not bare `href="#…"`). No explanatory `data-i18n` on invisible controls; omit unavailable context-menu items. Custom CSS only for thumb/safe-area/remote chrome.
- **Tests**: `fount test shells/cabinet --no-parallel` (frontend subtests: `shortcuts`, `daisyui`). Pure suites import `public/shared/` only — not `public/src/`. Keep Social `visibilitySpec` behind dynamic import in `remote.mjs` fetch paths so pure suites do not statically pull Social.
