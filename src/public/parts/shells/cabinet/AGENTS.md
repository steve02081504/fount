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
- **Default cabinet**: `cabinet_id: default` seeded from `default/templates/cabinet/`.
- **Tests**: `fount test shells/cabinet --no-parallel`.
