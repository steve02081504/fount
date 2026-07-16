---
description: Cabinet shell — P2P personal/group file cabinets
globs: src/public/parts/shells/cabinet/**
alwaysApply: false
---

# Cabinet Shell

- **Personal cabinets**: local index under `{userDict}/shells/cabinet/entities/{entityHash}/`; blobs via EVFS `shells/cabinet/{cabinet_id}/blobs|previews/…` with visibility encryption (`publish.mjs`).
- **Group cabinets**: `group:{groupId}` — business surface owns group files; DAG/chunk/file-master-key stay in chat; Hub files button → `#group:{groupId}`.
- **API body / stored fields**: snake_case (`mime_type`, `parent_id`, `evfs_path`, `delete_with_file`). fount-p2p `ceMode` only at EVFS call boundary.
- **Password folders**: `POST …/unlock` → `X-Cabinet-Unlock` header token (never query string).
- **Default cabinet**: `cabinet_id: default` seeded from `default/templates/cabinet/` (`overwrite: false`).
- **Sync**: `PUT …/sync-binding` + `POST …/sync` — pull then push, last writer wins.
- **Tests**: `fount test shells/cabinet --no-parallel`.
