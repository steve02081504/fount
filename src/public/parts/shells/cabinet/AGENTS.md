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
- **Directory listing**: `GET …/index?parent_id=` returns `folder_trail: [{ id, name }]` from cabinet root to the current folder; use it for named breadcrumbs so refreshes and deep links never display raw IDs. Remote `GET …/remote/…/index` uses the same query + response shape.
- **Recoverable delete**: `DELETE …/entries` with `recoverable:true` → `{ deleted, recovery_token }` (blobs kept). Restore via `POST …/entries/restore`; hard-delete via `POST …/entries/finalize-delete`. UI undo stack must finalize discarded tokens.
- **Shortcuts**: Ctrl/Cmd+C/X/V/A/D/Z/Y/N, F2 rename, Delete = go up. Clipboard is app-level (`sessionStorage` + `BroadcastChannel`), not OS clipboard.
- **Default cabinet**: `cabinet_id: default` seeded from `default/templates/cabinet/`.
- **Entity profile**: `#user:{entityHash}` (optional `/{cabinetId}`/`/{folderId}`) — remote read-only browse row and attribute panel creator/modifier stamps can open the shared profile popup (`/parts/shells:chat/shared/entityProfilePopup.mjs`); bio is rendered locally as markdown by the shared card. Stamps / remote row short codes use chat `formatEntityAtId` / `formatHashShort`, not bare `hash.slice`. Do not conflate cabinet entry `owner_entity_hash` (file ownership) with entity ownership `ownerEntityHash`.
- **UI**: do not attach explanatory `data-i18n` to invisible controls (drawer overlay, hidden input). Use `disabled`/`hidden`/`classList` for read-only/disabled states, not i18n copy; unavailable context menu items should simply be omitted.
- **Frontend layout**: `public/index.mjs` is bootstrap only; page state in `public/src/state.mjs` (`cabinetStore`); domain modules under `public/src/` (`navigation`, `remoteBrowse`, `entryGrid`, `entryActions`, `recoveryHistory`, `contextMenu`, `commands`, `properties`, `wiring`). `keyboard.mjs` stays pure shortcut matching.
- **Tests**: `fount test shells/cabinet --no-parallel`.
