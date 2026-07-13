---
description: Social Shell frontend (follow/block, federated notifications, timeline UI)
globs: src/public/parts/shells/social/**, src/decl/socialAPI.ts
alwaysApply: false
---

# Social Shell Frontend Guide

## Trust model

- **Local trust domain**: Social UI, `/api/parts/shells:social/...`, local timeline append, and P2P deps are mutually trusted.
- **External untrusted**: `part_timeline_put`, `part_invoke` (Social RPC / timeline pull). Ingress: `src/timeline/sync.mjs`, `src/discover/rpc.mjs`; outbound filtering in `src/timeline/federationExport.mjs`.
- **Follow list**: materialized per acting entity timeline（`loadFollowingForActor`）；`GET /feed?actingEntityHash=` 等读 API 经 `resolveActingEntity` 参数化。反向 follower 索引：`{dataPath}/p2p/node/social/follower_index/buckets/{2hex}.json`，值为 `target → [{ replicaUsername, entityHash }]`（`listLocalFollowersOf`）。
- **Personal block/hide**: public `block`/`unblock` → `personal_block.json` + reputation; private `hide` → `personal_hide.json` only. APIs: `GET /api/p2p/personal-lists`. Group kick/ban = node `denylist.json` (separate). P2P details: [p2p_server/AGENTS.md](../../../../../server/p2p_server/AGENTS.md).
- **HTTP routes**: writes at `POST …/posts`, `POST …/posts/:entityHash/:postId/like|repost`, `DELETE …/posts`; relationships at `POST …/relationships/follow|block|hide|follow-approve`. Types: `src/decl/socialAPI.ts`.
- **Protected concepts**: `socialMeta.hideFromDiscovery` ≠ `content.visibility: followers` (GSH encryption) ≠ feed `post.decryptView.failed`.
- **Reputation**: feed/search/trending filter/demote by `pickNodeScore(authorNodeHash)`; mentions skip authors below `SOCIAL_REP_HIDE_THRESHOLD`.

## UI conventions

- No hardcoded user-visible strings; use `data-i18n` with `zh-CN.json` (`social.*` keys).
- Prefer `renderTemplate` / `mountTemplate` over large `innerHTML` blocks.
- Modals: reuse `openDialogFromTemplate` from `@src/public/pages/scripts/features/dialog.mjs`.
- Explore posts (`discoverPosts`) are newest-first (not random).

## Feed / profile pagination

- Shared infinite scroll: `/scripts/infiniteScroll.mjs` (`bindInfiniteScroll`, `ensureScrollSentinel`).
- Feed / notifications / profile posts paginate via backend `nextCursor`; search mode calls `disconnectInfiniteScroll()` (no cursor append).
- Governance menu optimistic UX: `socialWrite.mjs` (`removePostsByAuthor` / `restoreRemovedPosts`) + `runSocialWrite` failure toasts; report success → `social.actions.reportSubmitted`.
- Playwright: `test/frontend/feed.spec.mjs` (scroll sentinel + `cursor=`), `explore_notifications.spec.mjs` (notification cursor), `postActions.spec.mjs` (hide/report/delete). Foreign-author fixture: bootstrap `test/seedForeignFeedAuthor.mjs` → `findForeignAuthorPostCard` in `fixtures.mjs`.

## Agent integration

- New posts (local commit or federated ingest) flow through `dispatchSocialMessage`: every visible local agent gets `interfaces.social.onMessage` (boolean intent); without `onMessage`, @mention defaults to intent true and text via `lib/replyViaChat.mjs` → `chat.GetReply`. Operator care (chat `care` module) on author → `care_post` inbox row + `notifyUser`. Cross-node @ of non-local entities uses `social_post_notify` RPC. `OnFollow` retained (follow is not a message).
- Integration: `test/integration/social_on_message.test.mjs`, `test/integration/acting_read_parity.test.mjs`.

## Acting entity（M9）

- **Identity switch**: `#actingEntitySelect` in side nav；`socialState.actingEntityHash`（null = operator）。`socialApi()` 自动追加 `?actingEntityHash=`（非 operator 时）。
- **Viewer API**: `GET /viewer` → `{ viewerEntityHash, operator, agents[], profile }`。
- **Profile / notifications / feed** 随 acting 刷新；`createContext.getViewerEntityHash` = `effectiveActingEntityHash()`。
- Playwright: `test/frontend/acting_actor.spec.mjs`；探针 `POST /test/seed-local-agent`、`/test/inbox-mention-for`（`FOUNT_TEST`）。

## Notifications inbox

- **Storage**: per-recipient `{userDictionary}/shells/social/inbox/{entityHash}/events.jsonl` + `read.json` seen watermark. Incremental write in `src/inbox.mjs` → `appendInboxFromTimelineEvent` (mounted from `timeline/append.mjs` commit + `timeline/sync.mjs` ingest).
- **Read model**: `GET /notifications` aggregates high-frequency like/repost/follow rows; `unreadCount` counts aggregated cards. Optional `?types=mention,like` filter.
- **API**: `GET /notifications?actingEntityHash=` reads inbox via `buildNotifications`（`unreadCount` from seen watermark）；`GET/PUT /notifications/seen` 同参。
- **WS**: `pushFeedUpdate(username, { type: 'notification', notification })` on inbox append; frontend merges by `aggregateKey` when inbox view is open.
