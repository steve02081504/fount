---
description: Social Shell frontend (follow/block, federated notifications, timeline UI)
globs: src/public/parts/shells/social/**, src/decl/socialAPI.ts
alwaysApply: false
---

# Social Shell Frontend Guide

## Trust model

- **Local trust domain**: Social UI, `/api/parts/shells:social/...`, local timeline append, and P2P deps are mutually trusted.
- **External untrusted**: `part_timeline_put`, `part_invoke` (Social RPC / timeline pull). Ingress: `src/timeline/sync.mjs`, `src/discover/rpc.mjs`; outbound filtering in `src/timeline/federationExport.mjs`.
- **Write auth** (`federation/write_auth.mjs`): folds the local key history chain; if no chain, bootstraps genesis via recovery-signed `social_meta` / gen0 `entity_key_rotate.senderPubKey`, or EVFS `profile.json` (`activePubKeyHex`) attestation. Genesis `ensureSocialMeta` signs `social_meta` with the recovery key.
- **Push admission** (`federation/push_admission.mjs`): `part_timeline_put` only accepts posts from "local entity follows union ∪ shared group members"; pull (`syncFollowingTimelines`) already filters by follow and bypasses this gate. Denylist/reputation still apply in the ingest chain.
- **Follow list**: materialized per entity timeline (`loadFollowingForActor`); HTTP always uses the operator entity via `SocialClient` (`src/api/`). Agents use in-process `getSocialClient(username, agentEntityHash)` — no webapi identity switch. Reverse follower index: `{dataPath}/p2p/node/social/follower_index/buckets/{2hex}.json` (`listKnownFollowersOf` for profile followers; `listLocalFollowersOf` for locally-hosted-only, used for notification delivery).
- **Personal block/hide**: public `block`/`unblock` → `personal_block.json` + reputation; private `hide` → `personal_hide.json` only. API: chat `GET …/personal-lists` (operator). Group kick/ban = node `denylist.json` (separate).
- **HTTP routes**: thin wrappers → `getSocialClient(username)`; writes at `POST …/posts` (incl. poll / contentWarning / sensitiveMedia / mediaRefs.alt), `…/edit`, `…/poll-vote`, `…/notes`, `…/notes/:id/vote`, `…/like|dislike|repost`, `DELETE …/posts`; `GET|PUT /taste`, `GET|PUT /profile/muted-keywords`, `POST /signals/dwell`; relationships likewise. Types: `src/decl/socialAPI.ts`; overview: `public/llms.txt`.
- **Protected concepts**: `socialMeta.hideFromDiscovery` ≠ post `content.visibility`. Visibility tiers: `public` / `unlisted` (readable, not discoverable) / `followers`+`followers_since` (GSH) / `selected`+`private` (pkw per-recipient wraps) / optional `except` (filter-only). `follow_approve` issues vault H, not locked-account approval. Feed decrypt failure: `post.decryptView.failed`. `contentWarning` collapses media/poll/body; `sensitiveMedia` blurs media only.
- **Profile cabinets tab**: lists published personal/shared cabinet metadata via Cabinet remote APIs (`renderProfileCabinets`); full visibility tiers (`followers_since` / `selected`) go through Cabinet `publish.mjs`. Reading files still requires cabinet keys / EVFS access.
- **Albums**: post-link collections (no separate media store). Timeline events `album_*` + reverse index `albumsByPost`; virtual `default` aggregates unlinked media posts and does not drive visibility. Member post visibility reconciles to the least-strict owning album (`post_visibility_set`). Feed items expose `albums[]` filtered by `canViewAlbum`. HTTP: `…/albums*`. Shared album↔feed helpers live in `src/lib/albumRefs.mjs` (do not import `api/client` from `feed/` — circular).
- **New timeline event types**: register in both `SOCIAL_TIMELINE_REDUCERS` and `SOCIAL_TIMELINE_EVENT_TYPES` (`federation/namespace.mjs`); ingress rejects unlisted types.
- **Reputation**: feed/search/trending filter/demote by `pickNodeScore(authorNodeHash)`; mentions skip authors below `SOCIAL_REP_HIDE_THRESHOLD`.
- **Notifications**: `reply|mention|like|repost|follow|care_post|poll_closed|post_note|live_started` (`inbox.mjs`).
- **Cross-shell chat HTTP**: viewer / personal-lists / entities/search / translation-prefs all go through `/api/parts/shells:chat/…` (frontend `chatApi`); Social does not register duplicate routes. Live/integration nodes need `loadParts: ['shells/social', 'shells/chat']`.
- **part_query**: `src/federation/partQuery.mjs` `registerSocialQueryKinds` / `unregisterSocialQueryKinds`; called once each in Load/Unload. KIND + handler live in `trending|search|discover|live/network.mjs`.
- **Federated post rows**: `src/federation/postQueryRow.mjs` (`federatedPostQueryRow` / `sanitizeFederatedPostQueryRow`) shared by discover/search.
- **Share URL**: chat `wrapProtocolHttpsUrl` (Social re-exports via `shared/protocolUrl.mjs`) → GitHub Pages protocol relay to the reader's local instance. `public/shared/runUri.mjs` must remain Deno-pure-test importable (no `/parts/` URL imports).
- **Trending**: `scope=local|nearby`; nearby uses `part_query` `trending_hashtags`.
- **Dwell**: frontend `dwellTracker.mjs` uses local IntersectionObserver; short videos may report `watchMs`/`watchRatio`; local-only ranking signal, not federated.
- **Topics / search / videos / live**: `tag_follow` topic pages; `GET /search` with filters and `scope=nearby` (`post_search`); `GET /videos/feed` + vertical snap + cursor pagination/replay; `/live/*` (broadcast auto-posts `liveRef`, end `post_edit` stats, dual-host co-stream, lobby `scope=nearby` + viewer proxy) + `av-relay` preview/full (`joinAvRelayRoom` ← `chat/public/shared/avRelayClient.mjs`; WS URL ← `social/public/shared/liveAvWsUrl.mjs`); scheduled posts `publishAt` + `scheduledPostWatcher` (modeled on poll deadline).
- **Feed backfill**: when the home feed is thin, `federation/backfill.mjs` one-hop sync → discover → multi-hop `post_discover` ingest; `part_query` kinds registered in Social `Load`.
- **Reply gate**: `replyPolicy`/`replyDisplay`/`reply_feature`; authoritative filtering in `listReplies`, write-side pre-check + inbox skip.

## UI conventions

- Prefer `data-i18n` / `setElementI18n(el, key, params)` for UI copy (params via `data-*` → `dataset`). `geti18n` only for non-DOM (`prompt`/`confirm`/`Error`) or embedding prebuilt HTML/DOM into a string. MutationObserver watches only `data-i18n` — same-key param updates need `setElementI18n`.
- **Input / textarea placeholders**: `data-i18n` must point to an object with a `placeholder` sub-key (e.g. `social.composer`); a string key takes the `innerHTML` path and textarea loses user input. Do not use i18n copy to drive disabled/hidden states — composer is only visible in `#feed` (`activateView` toggles `hidden`), other views should not inject placeholders.
- Prefer `renderTemplate` / `mountTemplate` over large `innerHTML` blocks.
- Modals: reuse `openDialogFromTemplate` from `@src/public/pages/scripts/features/dialog.mjs`.
- Explore posts (`discoverPosts`) are newest-first (not random).
- Post card engagement: like / **dislike** (both use thumb-up / thumb-down icons); mutually exclusive; post cards and reply rows share `templates/engagement_bar.html` (`lib/engagementBar.mjs`); `reaction_index` projects federated like/dislike (gated by `privacy.publishReactions`); `for_you` uses local `taste/*`. Preference UI: `#settings` (no longer a top-level `#taste` nav entry).
- **Template interpolation**: Social HTML templates always use `${...}` (`template.mjs`); Mustache `{{...}}` is forbidden.
- **Profile relationship stats**: stats row shows posts / following / followers; clicking following or followers opens a list dialog — do not add a "following" profile tab.
- **Album cover**: `coverMediaRef` picks the latest visible image without contentWarning / sensitiveMedia; do not use spoiler images as thumbnails.
- **Hash routing**: `switchView` writes `#feed`/`#explore`/…/`#drafts`/`#settings`; `applyIncomingNavigation` handles main nav + `#post;entity;postId` detail + `#search:query` (single search view). Refreshing restores the current tab.
- **Post detail**: `#post;<entityHash>;<postId>` → `views/postDetail.mjs`; `GET …/posts/:entityHash/:postId`. Share links use `formatSocialPostRunUri`.
- **Replies**: `listReplies` returns full feed items; panel rows and post cards share `engagement_bar` (reply/repost/like/dislike/save/share); same-page self-reply chains are merged into ascending `.post-thread` by `feedThreads.mjs`; cards display `replyContext`.
- **Profile banner**: `paintEntityProfileBanner` (chat `entityProfileCard.mjs`) — uses `profile.banner` if present, otherwise `entityProfilePattern` hash texture (`entityProfileBanner.css`).
- **Entity avatars**: always use chat `shared/entityAvatar.mjs` (`renderAvatarHtml` / `entityAvatarUrl`) + `hashAvatar.mjs` (`customProfileAvatar`); without explicit avatar, draw hash initial letter; do not blindly fetch `files/profile/avatar` or hand-write `charAt(0)`. Composer / reply box must pass `socialState.viewerProfile` (containing `avatar` + `infoDefaults`), same source as post card `authorProfile`.
- **`activateView(name)`** → `#${name}View` (`data-view` and section id must share the same stem: `videos`→`#videosView`, not `#videoView`; mismatch causes the main column to go blank after nav highlight).
- Short video slide fields come from `buildPostFeedItem`: `post.content.text` / `post.content.mediaRefs` / `authorProfile` (via `authorLabel`), not the flat `item.text` / `item.authorName`.
- Short video UI: right-side action bar has like / comment / share / mute; mute preference saved to `localStorage` (`fount.social.video.muted`) and synced to all slides; when the comment drawer covers the action bar, close it with the close button, click-outside, or Esc (do not rely on clicking the comment button again). When replies exist, fixed-height ticker in the bottom-right (`syncVideoCommentTicker`, with avatar); clicking an entry opens the drawer and `focusReplyInPanel` scrolls to `.reply[data-reply-id]`. Share reuses `shareOrCopyPostLink`. For comment/reply panels, `cardRoot` must be `.post-card, .reply, .video-slide` (feed and short video can share the same actionKey; do not use bare `document`).
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
- Integration: `test/integration/timeline_ingress.test.mjs` (remote agent recovery genesis bootstrap + unknown key rejection), `social_on_message.test.mjs`, `entity_parity.test.mjs`.
- **Testing trap**: `commitTimelineEvent` / ingest `post` triggers `dispatchSocialMessage` → `loadPart`; `dispatch` already `.catch`-skips char directories without `main.mjs`. Integration tests still prefer real fixture chars, or use `appendTimelineEvent` (skips dispatch).

## Identity

- Human and agent are both self-signed entities; `ownerEntityHash` is a belonging field (humans may also set it). Axioms: [human-agent-operational-parity-review.md](../../../../../../docs/review/human-agent-operational-parity-review.md).
- **Profile header**: bio / post Markdown → chat `shared/trustedMarkdown.mjs` (thin wrappers around `display.renderTrustedPostMarkdown` / `mountMarkdown`); `isTrustedMarkdownAuthor` for self, local agents (nodeHash prefix), owned agents (`author.ownerEntityHash === viewer`), declared master (`viewer.ownerEntityHash === author`), and trust list → trusted tier. Do not trust remote HTML; do not `escapeHtml` the markdown source.
- **Display names**: `authorLabel` → chat `resolveDisplayName` (alias → profile.name → `entityHashLabel`); do not hand-write `formatHashShort` fallbacks.
- **@id display**: post cards / replies / profile / search subtitles all use `entityHandle(entityHash, profile)` → chat `formatEntityAtId`; produces `@handle (@hash…)` when `profile.handle` exists, otherwise `@hash…`. Feed `authorProfile` summary must include `handle` (`authorProfileSummary`). Profile page must call `rememberEntityHandle` before rendering the post list, to avoid thin summaries that drop the handle and show only `@hash`.
- Webapi identity is always the operator (`GET /api/parts/shells:chat/viewer` → `viewerEntityHash` + `profile`); no frontend identity switch, no `actingEntityHash`. Frontend shows edit/delete based on `ownerEntityHash === viewer`.
- Viewer identity: `viewerEntityHash()` / `socialState.viewerEntityHash` (operator; directly imported by frontend modules, no appContext bag).
- Agent private read/write only via `getSocialClient(username, agentEntityHash)` (entry: `src/api/client/index.mjs`).
- **Saved posts**: `shells/social/entities/{entityHash}/savedPosts.json`; HTTP `…/saved-posts*` (incl. `/search`) fixed to operator; agent CRUD/search is structurally identical (`client.saved.*`). Missing file must return a **new** empty structure (do not shallow-copy a shared `DEFAULT`).
- **Composer drafts**: `shells/social/entities/{entityHash}/drafts.json`; HTTP `…/drafts*` fixed to operator; agent via `client.drafts.*`. Body mirrors `POST /posts` (sanitized; no File blobs). Cap 100. UI: `#drafts` + composer "Save Draft" button; publish deletes `activeDraftId`.
- **Entity search**: chat `GET …/entities/search?q=` / `SocialClient.searchEntities` → chat `searchEntitiesNetwork` (`part_query` kind `entity_search`). Search page user section: follow / pin alias; Hub `#friends` sidebar has separate search → create DM.

## Notifications inbox

- **Storage**: per-recipient `{userDictionary}/shells/social/inbox/{entityHash}/events.jsonl` + `read.json` seen watermark. Incremental write in `src/inbox.mjs` → `appendInboxFromTimelineEvent` (`timeline/append.mjs` commit + `timeline/sync.mjs` ingest).
- **Read model**: `GET /notifications` aggregates high-frequency like/repost/follow rows; `unreadCount` counts aggregated cards. Optional `?types=` filter (incl. `care_post` / `poll_closed`).
- **API**: `GET /notifications` / `GET|PUT /notifications/seen` fixed to operator.
- **WS**: `pushFeedUpdate(username, { type: 'notification', notification })` on inbox append; frontend merges by `aggregateKey` when inbox view is open.
