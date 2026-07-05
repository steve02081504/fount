---
description: Social Shell frontend (follow/block, federated notifications, timeline UI)
globs: src/public/parts/shells/social/**, src/decl/socialAPI.ts
alwaysApply: false
---

# Social Shell Frontend Guide

## Trust model

- **Local trust domain**: Social UI, `/api/parts/shells:social/...`, local timeline append, and P2P deps are mutually trusted.
- **External untrusted**: `part_timeline_put`, `part_invoke` (Social RPC / timeline pull). Ingress: `src/timeline/sync.mjs` (`ingestRemoteTimelineEvent`), `src/discover/rpc.mjs` (`handleSocialRpc`); outbound filtering in `src/timeline/federationExport.mjs`.
- **Follow list**: no sidecar JSON; `following` materialized from operator timeline (implicit self-follow); reverse lookups via `{dataPath}/p2p/node/social/follower_index/buckets/{hexPrefix}.json` (LRU hot cache).
- **Personal block/hide** (Chat + Social shared): public `block`/`unblock` timeline events → `personal_block.json` + reputation propagation; private `hide` → `personal_hide.json` only. List APIs: `GET /api/p2p/personal-lists`, `GET …/profile/personal-lists` → `{ entries: [{ scope, value, kind: 'block'|'hide' }] }`. Group kick/ban = node `denylist.json` (separate).
- **HTTP routes**: writes at `POST …/posts`, `POST …/posts/:entityHash/:postId/like|repost`, `DELETE …/posts`; relationships at `POST …/relationships/follow|block|hide|follow-approve`. Profile namespace read-only (+ `POST …/profile/meta` for `hideFromDiscovery`/`exploreBlurb`). Types: `src/decl/socialAPI.ts`.
- **Protected concepts**: `socialMeta.hideFromDiscovery` ≠ `content.visibility: followers` (GSH encryption) ≠ feed `post.decryptView.failed`.
- **Reputation**: feed/search/trending filter/demote by `pickNodeScore(authorNodeHash)`; mentions skip authors below `SOCIAL_REP_HIDE_THRESHOLD`.

## UI conventions

- No hardcoded user-visible strings; use `data-i18n` with `zh-CN.json` (`social.*` keys).
- Prefer `renderTemplate` / `mountTemplate` over large `innerHTML` blocks.
- Modals: reuse `openDialogFromTemplate` from `@src/public/pages/scripts/features/dialog.mjs`.

## Federated Social

- Remote notifications go **only** through `part_invoke` (e.g. `social_on_mention`), never `char_rpc`.
