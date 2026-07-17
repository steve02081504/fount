---
description: Social Shell frontend (follow/block, federated notifications, timeline UI)
globs: src/public/parts/shells/social/**, src/decl/socialAPI.ts
alwaysApply: false
---

# Social Shell Frontend Guide

## Trust model

- **Local trust domain**: Social UI, `/api/parts/shells:social/...`, local timeline append, and P2P deps are mutually trusted.
- **External untrusted**: `part_timeline_put`, `part_invoke` (Social RPC / timeline pull). Ingress: `src/timeline/sync.mjs`, `src/discover/rpc.mjs`; outbound filtering in `src/timeline/federationExport.mjs`.
- **Follow list**: materialized per entity timeline (`loadFollowingForActor`); HTTP always uses the operator entity via `SocialClient` (`src/api/`). Agents use in-process `getSocialClient(username, agentEntityHash)` — no webapi identity switch. Reverse follower index: `{dataPath}/p2p/node/social/follower_index/buckets/{2hex}.json`.
- **Personal block/hide**: public `block`/`unblock` → `personal_block.json` + reputation; private `hide` → `personal_hide.json` only. API: chat `GET …/personal-lists`（operator）。Group kick/ban = node `denylist.json` (separate).
- **HTTP routes**: thin wrappers → `getSocialClient(username)`; writes at `POST …/posts` (incl. poll / contentWarning / sensitiveMedia / mediaRefs.alt), `…/edit`, `…/poll-vote`, `…/notes`, `…/notes/:id/vote`, `…/like|dislike|repost`, `DELETE …/posts`; `GET|PUT /taste`, `GET|PUT /profile/muted-keywords`, `POST /signals/dwell`; relationships likewise. Types: `src/decl/socialAPI.ts`; overview: `public/llms.txt`.
- **Protected concepts**: `socialMeta.hideFromDiscovery` ≠ post `content.visibility`. Visibility tiers: `public` / `unlisted` (readable, not discoverable) / `followers`+`followers_since` (GSH) / `selected`+`private` (pkw per-recipient wraps) / optional `except` (filter-only). `follow_approve` issues vault H, not locked-account approval. Feed decrypt failure: `post.decryptView.failed`. `contentWarning` collapses media/poll/body; `sensitiveMedia` blurs media only.
- **Profile cabinets tab**: lists published personal/shared cabinet metadata via Cabinet remote APIs (`renderProfileCabinets`); full visibility tiers (`followers_since` / `selected`) go through Cabinet `publish.mjs`. Reading files still requires cabinet keys / EVFS access.
- **Albums**: post-link collections (no separate media store). Timeline events `album_*` + reverse index `albumsByPost`; virtual `default` aggregates unlinked media posts and does not drive visibility. Member post visibility reconciles to the least-strict owning album (`post_visibility_set`). Feed items expose `albums[]` filtered by `canViewAlbum`. HTTP: `…/albums*`. Shared album↔feed helpers live in `src/lib/albumRefs.mjs` (do not import `api/client` from `feed/` — circular).
- **New timeline event types**: register in both `SOCIAL_TIMELINE_REDUCERS` and `SOCIAL_TIMELINE_EVENT_TYPES` (`federation/namespace.mjs`); ingress rejects unlisted types.
- **Reputation**: feed/search/trending filter/demote by `pickNodeScore(authorNodeHash)`; mentions skip authors below `SOCIAL_REP_HIDE_THRESHOLD`.
- **Notifications**: `reply|mention|like|repost|follow|care_post|poll_closed|post_note|live_started` (`inbox.mjs`).
- **Cross-shell chat HTTP**：viewer / personal-lists / entities/search / translation-prefs 一律走 `/api/parts/shells:chat/…`（前端 `chatApi`）；Social 不再注册重复路由。live/integration 节点需 `loadParts: ['shells/social', 'shells/chat']`。
- **part_query**：`src/federation/partQuery.mjs` 的 `registerSocialQueryKinds` / `unregisterSocialQueryKinds`；Load/Unload 各一次。KIND+handler 留在 `trending|search|discover|live/network.mjs`。
- **联邦帖行**：`src/federation/postQueryRow.mjs`（`federatedPostQueryRow` / `sanitizeFederatedPostQueryRow`）供 discover/search 共用。
- **Share URL**：chat `wrapProtocolHttpsUrl`（Social 经 `shared/protocolUrl.mjs` re-export）→ GitHub Pages protocol relay to the reader's local instance。`public/shared/runUri.mjs` 保持 Deno 纯测可 import（无 `/parts/` URL）。
- **Trending**: `scope=local|nearby`; nearby uses `part_query` `trending_hashtags`.
- **Dwell**: frontend `dwellTracker.mjs` uses local IntersectionObserver; short videos may report `watchMs`/`watchRatio`; local-only ranking signal, not federated.
- **Topics / search / videos / live**: `tag_follow` topic pages; `GET /search` with filters and `scope=nearby` (`post_search`); `GET /videos/feed` + vertical snap + cursor pagination/replay; `/live/*` (broadcast auto-posts `liveRef`, end `post_edit` stats, dual-host co-stream, lobby `scope=nearby` + viewer proxy) + `av-relay` preview/full (`joinAvRelayRoom` ← `chat/public/shared/avRelayClient.mjs`; WS URL ← `social/public/shared/liveAvWsUrl.mjs`); scheduled posts `publishAt` + `scheduledPostWatcher` (modeled on poll deadline).
- **Feed backfill**: when the home feed is thin, `federation/backfill.mjs` one-hop sync → discover → multi-hop `post_discover` ingest; `part_query` kinds registered in Social `Load`.
- **Reply gate**: `replyPolicy`/`replyDisplay`/`reply_feature`; authoritative filtering in `listReplies`, write-side pre-check + inbox skip.

## UI conventions

- No hardcoded user-visible strings; use `data-i18n` with `zh-CN.json` (`social.*` keys).
- Prefer `renderTemplate` / `mountTemplate` over large `innerHTML` blocks.
- Modals: reuse `openDialogFromTemplate` from `@src/public/pages/scripts/features/dialog.mjs`.
- Explore posts (`discoverPosts`) are newest-first (not random).
- Post card engagement: like / **dislike** (mutually exclusive; reducer clears the opposing reaction); `reaction_index` projects federated like/dislike signed events (controlled by entity `privacy.publishReactions`); `for_you` uses local `taste/*` cluster weights (`interestBoost`, can be negative). Preference UI: `#tasteView` → `views/taste.mjs` (two toggles: `publishPreferences` / `publishReactions`). Tag naming uses timeline `tag_name` events.
- **`activateView(name)`** → `#${name}View`（`data-view` 与 section id 必须同词干：`videos`→`#videosView`，勿写成 `#videoView`；否则主导航高亮后主栏整块空白）。
- 短视频 slide 字段取自 `buildPostFeedItem`：`post.content.text` / `post.content.mediaRefs` / `authorProfile`（经 `authorLabel`），不是扁平的 `item.text` / `item.authorName`。
- 短视频 UI：右侧操作栏含赞 / 评论 / 分享 / 静音；静音偏好写 `localStorage`（`fount.social.video.muted`）并同步全部 slide；评论抽屉盖住操作栏时靠关闭钮、点空白或 Esc 关掉（勿指望再点评论钮）；有回复时右下角固定高度轮播（`syncVideoCommentTicker`），点击条目打开抽屉并 `focusReplyInPanel` 滚到对应 `.reply[data-reply-id]`。分享复用 `shareOrCopyPostLink`。发评 / 查回复面板时 `cardRoot` 须为 `.post-card, .video-slide`（feed 与短视频可共享同一 actionKey，勿用裸 `document`）。
- **Cross-shell chat imports**: browser modules must use absolute `/parts/shells:chat/...` URLs (filesystem relatives resolve under the page origin and 404, breaking the whole module graph). Modules imported by Deno pure tests must not contain `/parts/...` URL imports — keep token helpers in chat (`inlineTokenSyntax.mjs`) and leave social shared pure modules dependency-free.

## Feed / profile pagination

- Shared infinite scroll: `/scripts/infiniteScroll.mjs` (`bindInfiniteScroll`, `ensureScrollSentinel`); default `rootMargin` ≈ two viewports (`480px`). Sentinel uses `overflow-anchor: none` + in-flight lock; **do not rebind** the observer after a replay append (only move the sentinel) — rebinding while the sentinel stays intersecting causes an infinite replay loop. Observer is **rising-edge**: one fire per enter-intersection; leave then re-enter to arm again. Pagination chains by rebinding after each page (`bindFeedInfiniteScroll` at end of `loadFeed`). If the loader has its own mutex (`notificationsLoading`), call `bindInfiniteScroll` **after** releasing it — otherwise the immediate post-`observe` callback is swallowed and pagination stalls until the sentinel leaves/re-enters.
- Feed / notifications / profile posts paginate via backend `nextCursor`; search mode has its own sentinel.
- Feed prefetch: after each page, frontend background-fetches the next cursor into `state.feedPrefetch`; sentinel consumes cache then schedules the next prefetch. Playwright must wait for `cursor=` during/after first paint (prefetch), not assume a network request on scroll.
- Feed / videos / live **replay**: when `nextCursor` is exhausted, further scrolls re-append already-shown items (feed inserts `.feed-replay-divider` with `social.feed.replayDivider`). Replay requires real scroll (`scrollY > 0` + content taller than viewport) so short feeds do not auto-duplicate on first paint. Delete/hide/block/mute must purge `state.feedShownItems` (`purgeFeedShownPost` / `purgeFeedShownAuthor`) or replay resurrects removed cards.
- Empty / thin first page triggers server `federation/backfill.mjs`: `syncFollowingTimelines` → discover + `syncTimelineForEntity` → multi-hop `post_discover` ingest. Live empty falls back to `buildNearbyLiveFeed`.
- Videos / live use vertical snap + cursor append near end (3rd from last); live preconnects next slide with AV `subscribe mode=preview` (keyframes only) + signal WS.
- Governance menu optimistic UX: `socialWrite.mjs` (`removePostsByAuthor` / `restoreRemovedPosts` / feedShown purge helpers) + `runSocialWrite` failure toasts.
- Hashtag / trending links → `#topic:…` topic view (`loadTopicView`), not feed search (`#search;`). Playwright must assert `#topicView` / `#topicPostList`.
- Playwright: `test/frontend/feed.spec.mjs` (scroll sentinel + prefetch `cursor=` + replay divider + topic deep links), `explore_notifications.spec.mjs` (notification cursor), `postActions.spec.mjs` (hide/delete). Foreign-author fixture: bootstrap `test/seedForeignFeedAuthor.mjs` → `findForeignAuthorPostCard` in `fixtures.mjs`.
- Dwell HTTP: `POST /signals/dwell` uses `username` from `socialClientFromReq` (not `client.username` — SocialClient duck type has no `username`).

## Agent integration

- New posts (local commit or federated ingest) flow through `dispatchSocialMessage`: every visible local agent gets `interfaces.social.OnMessage` (boolean intent); without `OnMessage`, @mention defaults to intent true and text via `lib/replyViaChat.mjs` → `chat.GetReply`. Operator care (chat `care` module) on author → `care_post` inbox row + `notifyUser`. Cross-node @ of non-local entities uses `social_post_notify` RPC. `OnFollow` retained (follow is not a message).
- Integration: `test/integration/social_on_message.test.mjs`, `test/integration/entity_parity.test.mjs` (operator HTTP vs agent SocialClient).
- **Testing trap**: `commitTimelineEvent` on `post` always triggers `dispatchSocialMessage` → `loadPart` for all local agents. If a char directory exists without `main.mjs`, use `appendTimelineEvent` instead (skips dispatch), or install a real fixture char.

## Identity

- Human and agent are both self-signed entities; `ownerEntityHash` is a belonging field (humans may also set it). Axioms: [human-agent-operational-parity-review.md](../../../../../../docs/review/human-agent-operational-parity-review.md).
- **Profile header**: bio 读 `description` / `description_markdown`；有 `ownerEntityHash` 时显示「此实体为 xxx 所有」链接（`formatSocialProfileHref`）。Social 时间线不存在导入重签归因问题，无需 attribution mismatch UI。
- Webapi identity is always the operator (`GET /api/parts/shells:chat/viewer` → `viewerEntityHash` + `profile`); no frontend identity switch, no `actingEntityHash`. Frontend shows edit/delete based on `ownerEntityHash === viewer`.
- Viewer identity: `viewerEntityHash()` / `socialState.viewerEntityHash`（operator；前端模块直接 import，无 appContext）。
- Agent private read/write only via `getSocialClient(username, agentEntityHash)` (entry: `src/api/client/index.mjs`).
- **Saved posts**: `shells/social/entities/{entityHash}/savedPosts.json`; HTTP `…/saved-posts*` (incl. `/search`) fixed to operator; agent CRUD/search is structurally identical (`client.saved.*`). Missing file must return a **new** empty structure (do not shallow-copy a shared `DEFAULT`).
- **Entity search**: chat `GET …/entities/search?q=` / `SocialClient.searchEntities` → chat `searchEntitiesNetwork` (`part_query` kind `entity_search`). Search page user section: follow / pin alias; Hub `#friends` sidebar has separate search → create DM.

## Notifications inbox

- **Storage**: per-recipient `{userDictionary}/shells/social/inbox/{entityHash}/events.jsonl` + `read.json` seen watermark. Incremental write in `src/inbox.mjs` → `appendInboxFromTimelineEvent` (`timeline/append.mjs` commit + `timeline/sync.mjs` ingest).
- **Read model**: `GET /notifications` aggregates high-frequency like/repost/follow rows; `unreadCount` counts aggregated cards. Optional `?types=` filter (incl. `care_post` / `poll_closed`).
- **API**: `GET /notifications` / `GET|PUT /notifications/seen` fixed to operator.
- **WS**: `pushFeedUpdate(username, { type: 'notification', notification })` on inbox append; frontend merges by `aggregateKey` when inbox view is open.
