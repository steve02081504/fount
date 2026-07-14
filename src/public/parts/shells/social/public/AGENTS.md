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
- **HTTP routes**: 薄封装 → `getSocialClient(username)`；writes at `POST …/posts`（含 poll / contentWarning）、`…/edit`、`…/poll-vote`、`…/like|repost`、`DELETE …/posts`（`{ postId, entityHash? }`；可删自有帖或 `ownerEntityHash` 为自己的 agent 帖）；relationships / governance 同理。Types: `src/decl/socialAPI.ts`；总览 `public/llms.txt`。
- **Owner 删 agent 帖**：operator 自签 `post_delete` 落入 **agent 时间线**（`commitTimelineEvent(..., { signerEntityHash: operator })`）。联邦入站在 `write_auth.mjs` 读 agent profile.`ownerEntityHash` 后折叠 **owner 时间线**密钥链复核 sender。
- **Protected concepts**: `socialMeta.hideFromDiscovery` ≠ `content.visibility: followers`（GSH）≠ Mastodon unlisted/direct；`follow_approve` 签发 vault H，不是 locked-account 审批关注。Feed 解密失败见 `post.decryptView.failed`。
- **Reputation**: feed/search/trending filter/demote by `pickNodeScore(authorNodeHash)`; mentions skip authors below `SOCIAL_REP_HIDE_THRESHOLD`.
- **Notifications**: `reply|mention|like|repost|follow|care_post|poll_closed`（`inbox.mjs`）。

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

- New posts (local commit or federated ingest) flow through `dispatchSocialMessage`: every visible local agent gets `interfaces.social.OnMessage` (boolean intent); without `OnMessage`, @mention defaults to intent true and text via `lib/replyViaChat.mjs` → `chat.GetReply`. Operator care (chat `care` module) on author → `care_post` inbox row + `notifyUser`. Cross-node @ of non-local entities uses `social_post_notify` RPC. `OnFollow` retained (follow is not a message).
- Integration: `test/integration/social_on_message.test.mjs`, `test/integration/entity_parity.test.mjs`（原 acting 平权，现为 operator HTTP vs agent SocialClient）。
- **测试陷阱**：`commitTimelineEvent` 对 `post` 恒触发 `dispatchSocialMessage` → `loadPart` 本机全部 agent。若仅 `mkdir` 占位 char 目录而无 `main.mjs`，集成测请改用 `appendTimelineEvent`（跳过 dispatch），或安装真实 fixture char。

## Identity

- 人类与 agent 同为自签实体；agent 仅多 `ownerEntityHash`。公理与矩阵见 [human-agent-operational-parity-review.md](../../../../../../docs/review/human-agent-operational-parity-review.md)。
- Webapi 身份恒为 operator（`GET /viewer` → `viewerEntityHash` + `agents[]`）；**无**前端身份切换、**无** `actingEntityHash`。前端对 `agents` 内 entityHash 的帖显示删除（不显示编辑）。
- `createContext.getViewerEntityHash` = `viewerEntityHash()`（operator）。
- Agent 私有读/写仅经工具面 `getSocialClient(username, agentEntityHash)`。
- **收藏夹**：`shells/social/entities/{entityHash}/savedPosts.json`；HTTP `…/saved-posts*`（含 `/search`）固定 operator；agent CRUD/search 与人类同构（`client.saved.*`）。缺失文件时须返回**新**空结构（勿浅拷贝共享 `DEFAULT`）。

## Notifications inbox

- **Storage**: per-recipient `{userDictionary}/shells/social/inbox/{entityHash}/events.jsonl` + `read.json` seen watermark. Incremental write in `src/inbox.mjs` → `appendInboxFromTimelineEvent`（`timeline/append.mjs` commit + `timeline/sync.mjs` ingest）。
- **Read model**: `GET /notifications` aggregates high-frequency like/repost/follow rows; `unreadCount` counts aggregated cards. Optional `?types=` filter（含 `care_post` / `poll_closed`）。
- **API**: `GET /notifications` / `GET|PUT /notifications/seen` 固定 operator。
- **WS**: `pushFeedUpdate(username, { type: 'notification', notification })` on inbox append; frontend merges by `aggregateKey` when inbox view is open.
