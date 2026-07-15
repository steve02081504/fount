---
description: Social Shell frontend (follow/block, federated notifications, timeline UI)
globs: src/public/parts/shells/social/**, src/decl/socialAPI.ts
alwaysApply: false
---

# Social Shell Frontend Guide

## Trust model

- **Local trust domain**: Social UI, `/api/parts/shells:social/...`, local timeline append, and P2P deps are mutually trusted.
- **External untrusted**: `part_timeline_put`, `part_invoke` (Social RPC / timeline pull). Ingress: `src/timeline/sync.mjs`, `src/discover/rpc.mjs`; outbound filtering in `src/timeline/federationExport.mjs`.
- **Follow list**: materialized per entity timeline (`loadFollowingForActor`); HTTP 恒以 operator 实体经 `SocialClient`（`src/api/`）操作。Agent 走 in-process `getSocialClient(username, agentEntityHash)`，不经 webapi 换身份。Reverse follower index: `{dataPath}/p2p/node/social/follower_index/buckets/{2hex}.json`。
- **Personal block/hide**: public `block`/`unblock` → `personal_block.json` + reputation; private `hide` → `personal_hide.json` only. APIs: `GET …/profile/personal-lists`（operator）与 chat `GET …/personal-lists`。Group kick/ban = node `denylist.json`（separate）。
- **HTTP routes**: 薄封装 → `getSocialClient(username)`；writes at `POST …/posts`（含 poll / contentWarning / sensitiveMedia / mediaRefs.alt）、`…/edit`、`…/poll-vote`、`…/notes`、`…/notes/:id/vote`、`…/like|dislike|repost`、`DELETE …/posts`；`GET|PUT /taste`、`GET|PUT /profile/muted-keywords`、`POST /signals/dwell`；relationships 同理。Types: `src/decl/socialAPI.ts`；总览 `public/llms.txt`。
- **Protected concepts**: `socialMeta.hideFromDiscovery` ≠ `content.visibility: followers`（GSH）≠ Mastodon unlisted/direct；`follow_approve` 签发 vault H，不是 locked-account 审批关注。Feed 解密失败见 `post.decryptView.failed`。`contentWarning` 折叠 media/poll/正文；`sensitiveMedia` 单独 blur 媒体遮罩。
- **Reputation**: feed/search/trending filter/demote by `pickNodeScore(authorNodeHash)`; mentions skip authors below `SOCIAL_REP_HIDE_THRESHOLD`.
- **Notifications**: `reply|mention|like|repost|follow|care_post|poll_closed|post_note`（`inbox.mjs`）。
- **Share URL**: 复制/分享走 `wrapProtocolHttpsUrl` → GitHub Pages protocol 中转到读者本机实例。
- **Trending**: `scope=local|nearby`；nearby 用 `part_query` `trending_hashtags`。
- **Dwell**: 前端 `dwellTracker.mjs` 本地 IntersectionObserver；仅本机排序弱信号，不联邦。

## UI conventions

- No hardcoded user-visible strings; use `data-i18n` with `zh-CN.json` (`social.*` keys).
- Prefer `renderTemplate` / `mountTemplate` over large `innerHTML` blocks.
- Modals: reuse `openDialogFromTemplate` from `@src/public/pages/scripts/features/dialog.mjs`.
- Explore posts (`discoverPosts`) are newest-first (not random).
- Post card engagement: like / **dislike**（互斥，reducer 侧清对立反应）；`reaction_index` 投影联邦 like/dislike 签名事件（受实体 `privacy.publishReactions` 控制）；`for_you` 用本地 `taste/*` 聚类权重（`interestBoost`，可负压分）。偏好 UI：`#tasteView` → `views/taste.mjs`（双开关：`publishPreferences` / `publishReactions`）。标签命名走时间线 `tag_name` 事件。

## Feed / profile pagination

- Shared infinite scroll: `/scripts/infiniteScroll.mjs` (`bindInfiniteScroll`, `ensureScrollSentinel`).
- Feed / notifications / profile posts paginate via backend `nextCursor`; search mode calls `disconnectInfiniteScroll()` (no cursor append).
- Governance menu optimistic UX: `socialWrite.mjs` (`removePostsByAuthor` / `restoreRemovedPosts`) + `runSocialWrite` failure toasts。
- Playwright: `test/frontend/feed.spec.mjs` (scroll sentinel + `cursor=`), `explore_notifications.spec.mjs` (notification cursor), `postActions.spec.mjs` (hide/delete)。Foreign-author fixture: bootstrap `test/seedForeignFeedAuthor.mjs` → `findForeignAuthorPostCard` in `fixtures.mjs`。

## Agent integration

- New posts (local commit or federated ingest) flow through `dispatchSocialMessage`: every visible local agent gets `interfaces.social.OnMessage` (boolean intent); without `OnMessage`, @mention defaults to intent true and text via `lib/replyViaChat.mjs` → `chat.GetReply`. Operator care (chat `care` module) on author → `care_post` inbox row + `notifyUser`. Cross-node @ of non-local entities uses `social_post_notify` RPC. `OnFollow` retained (follow is not a message).
- Integration: `test/integration/social_on_message.test.mjs`, `test/integration/entity_parity.test.mjs`（原 acting 平权，现为 operator HTTP vs agent SocialClient）。
- **测试陷阱**：`commitTimelineEvent` 对 `post` 恒触发 `dispatchSocialMessage` → `loadPart` 本机全部 agent。若仅 `mkdir` 占位 char 目录而无 `main.mjs`，集成测请改用 `appendTimelineEvent`（跳过 dispatch），或安装真实 fixture char。

## Identity

- 人类与 agent 同为自签实体；`ownerEntityHash` 为所属关系字段（人类亦可设）。公理与矩阵见 [human-agent-operational-parity-review.md](../../../../../../docs/review/human-agent-operational-parity-review.md)。
- Webapi 身份恒为 operator（`GET /viewer` → `viewerEntityHash` + `agents[]`）；**无**前端身份切换、**无** `actingEntityHash`。前端按 feed 项 `ownerEntityHash === viewer` 显示改/删。
- `createContext.getViewerEntityHash` = `viewerEntityHash()`（operator）。
- Agent 私有读/写仅经工具面 `getSocialClient(username, agentEntityHash)`。
- **收藏夹**：`shells/social/entities/{entityHash}/savedPosts.json`；HTTP `…/saved-posts*`（含 `/search`）固定 operator；agent CRUD/search 与人类同构（`client.saved.*`）。缺失文件时须返回**新**空结构（勿浅拷贝共享 `DEFAULT`）。
- **具名搜索**：`GET …/entities/search?q=` / `SocialClient.searchEntities` → chat `searchEntitiesNetwork`（`part_query` kind `entity_search`）。搜索页用户段：follow / pin 别名；Hub `#friends` 侧栏另有搜人 → 建 DM。

## Notifications inbox

- **Storage**: per-recipient `{userDictionary}/shells/social/inbox/{entityHash}/events.jsonl` + `read.json` seen watermark. Incremental write in `src/inbox.mjs` → `appendInboxFromTimelineEvent`（`timeline/append.mjs` commit + `timeline/sync.mjs` ingest）。
- **Read model**: `GET /notifications` aggregates high-frequency like/repost/follow rows; `unreadCount` counts aggregated cards. Optional `?types=` filter（含 `care_post` / `poll_closed`）。
- **API**: `GET /notifications` / `GET|PUT /notifications/seen` 固定 operator。
- **WS**: `pushFeedUpdate(username, { type: 'notification', notification })` on inbox append; frontend merges by `aggregateKey` when inbox view is open.
