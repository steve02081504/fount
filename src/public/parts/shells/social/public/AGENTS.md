---
description: Social Shell frontend (follow/block, federated notifications, timeline UI)
globs: src/public/parts/shells/social/**, src/decl/socialAPI.ts
alwaysApply: false
---

# Social Shell Frontend Guide

## Trust model

- **Local trust domain**: Social UI, `/api/parts/shells:social/...`, local timeline append, and P2P deps are mutually trusted.
- **External untrusted**: `part_timeline_put`, `part_invoke` (Social RPC / timeline pull). Ingress: `src/timeline/sync.mjs`, `src/discover/rpc.mjs`; outbound filtering in `src/timeline/federationExport.mjs`.
- **Follow list**: materialized from operator timeline (implicit self-follow); reverse lookups via follower index buckets under `{dataPath}/p2p/node/social/follower_index/`.
- **Personal block/hide**: public `block`/`unblock` → `personal_block.json` + reputation; private `hide` → `personal_hide.json` only. APIs: `GET /api/p2p/personal-lists`. Group kick/ban = node `denylist.json` (separate). P2P details: [p2p/AGENTS.md](../../../../../scripts/p2p/AGENTS.md).
- **HTTP routes**: writes at `POST …/posts`, `POST …/posts/:entityHash/:postId/like|repost`, `DELETE …/posts`; relationships at `POST …/relationships/follow|block|hide|follow-approve`. Types: `src/decl/socialAPI.ts`.
- **Protected concepts**: `socialMeta.hideFromDiscovery` ≠ `content.visibility: followers` (GSH encryption) ≠ feed `post.decryptView.failed`.
- **Reputation**: feed/search/trending filter/demote by `pickNodeScore(authorNodeHash)`; mentions skip authors below `SOCIAL_REP_HIDE_THRESHOLD`.

## UI conventions

- No hardcoded user-visible strings; use `data-i18n` with `zh-CN.json` (`social.*` keys).
- Prefer `renderTemplate` / `mountTemplate` over large `innerHTML` blocks.
- Modals: reuse `openDialogFromTemplate` from `@src/public/pages/scripts/features/dialog.mjs`.

## Feed / profile pagination (C2.4)

- Shared infinite scroll: `public/src/lib/infiniteScroll.mjs` (`bindInfiniteScroll`, `ensureScrollSentinel`, `#feedScrollSentinel` / `#notificationsScrollSentinel` / profile panel sentinel).
- Feed / notifications / profile posts paginate via backend `nextCursor`; search mode calls `disconnectInfiniteScroll()` (no cursor append).
- Governance menu optimistic UX: `socialWrite.mjs` (`removePostsByAuthor` / `restoreRemovedPosts`) + `runSocialWrite` failure toasts; report success → `social.actions.reportSubmitted`.
- Playwright: `test/frontend/feed.spec.mjs` (scroll sentinel + `cursor=`), `explore_notifications.spec.mjs` (notification cursor), `postActions.spec.mjs` (hide/report/delete). Foreign-author fixture: bootstrap `test/seedForeignFeedAuthor.mjs` → `findForeignAuthorPostCard` in `fixtures.mjs`.

## Agent integration

- @-mentioning a local agent: `dispatch.mjs` prefers `interfaces.social.OnMention`; falls back to `interfaces.chat.GetReply` when missing (`lib/chatMentionFallback.mjs` builds a minimal request, using chat's `BUILTIN_*` for the built-in world/persona). `publishEntityReply` calls `ensureEntitySocialReady` so agent timelines have `social_meta` before auto-reply.
- `OnFollow` / `OnFollowerUpdate` still require an explicit `interfaces.social`.
- Integration: `test/integration/mention_getreply_fallback.test.mjs`.

## Notifications inbox (M5)

- **Storage**: per-recipient `{dataPath}/p2p/node/social/inbox/{entityHash}/events.jsonl` + `read.json` seen watermark. Incremental write in `src/inbox.mjs` → `appendInboxFromTimelineEvent` (mounted from `timeline/append.mjs` commit + `timeline/sync.mjs` ingest).
- **API**: `GET /notifications` reads inbox via `buildNotifications` (`unreadCount` from seen watermark); `GET/PUT /notifications/seen`.
- **WS**: `pushFeedUpdate(username, { type: 'notification', notification })` on inbox append; `POST /posts` pushes `{ type: 'post', … }`. Frontend badge uses `unreadCount` + WS increment in `public/src/init.mjs`.
