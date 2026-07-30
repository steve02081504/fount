# Social UI details (less common)

Day-to-day rules: [AGENTS.md](AGENTS.md).

## Hash routing

- `switchView` → `#feed` / `#explore` / … / `#drafts` / `#settings`
- Post detail: `#post;<entityHash>;<postId>`
- Search: `#search;q` / `#search:q` / `?q=` → `#searchView`
- Hashtag/trending → `#topic:…`
- Preference UI lives under `#settings` (not a top-level nav entry)

## Search / replies / own-write feed

- **Search view**: render post hits as soon as `/search` returns; `entities/search` must not block the posts section (hashtag/tag-only queries skip the users block).
- **Replies panel**: first open loads then reveals; do not toggle visible before `renderRepliesPanel` or composer input can be wiped mid-type.
- **Own write → feed**: repost returns `{ event, item }` and `pushFeedUpdate`; UI `prependFeedItem(item, { force: true })` (dedupe + in-flight `pendingFeedInserts` so WS cannot double-insert during `buildPostCard`). Deep-pagination WS still banners unless `force`.

## Short video / live UI

- Slide fields from `buildPostFeedItem`: `post.content.text` / `post.content.mediaRefs` / `authorProfile` — not flat `item.text` / `item.authorName`.
- Action bar: like / comment / share / mute; mute in `localStorage` (`fount.social.video.muted`). Comment drawer: close button / click-outside / Esc. Reply ticker: `syncVideoCommentTicker`. `cardRoot` for panels: `.post-card, .reply, .video-slide`.
- Live: vertical snap + cursor near end; next slide preconnect with AV `subscribe mode=preview`. Empty lobby → `buildNearbyLiveFeed`.

## Long body fold

Feed/profile/search cards (`openDetail !== false`) collapse markdown code `<details>` by default and clamp tall `.body` (~280px) with `.body-expand`. Post detail keeps full height. `POST_CARD_OPEN_EXCLUDE` includes `summary` / `.body-expand`.

## Feed pagination / replay

- Shared: `/scripts/infiniteScroll.mjs` (`data-scroll-sentinel` + `insertBeforeScrollSentinel`). Do not `appendChild` past the sentinel. Rising-edge arm; after replay do not rebind while intersecting. `data-feed-replaying` marks an in-flight loop replay. If loader has its own mutex, bind **after** releasing it.
- Always `observe` the sentinel even when `hasMore()` is currently false (so a later scroll can enable replay). Feed arms `feedUserScrolled` with a one-shot `window` scroll listener and rebinds when cursor is already exhausted. Notifications: bind only on first page, then `queueMicrotask` one page-ahead fetch (long lists leave the sentinel below the fold so IO alone is unreliable).
- Prefetch next cursor into `state.feedPrefetch`. Replay when `nextCursor` exhausted: re-append shown items (`.feed-replay-divider`); requires real scroll. Delete/hide/block/mute must `purgeFeedShownPost` / `purgeFeedShownAuthor`. Deletes also enter `state.suppressedFeedPostIds` so `prependFeedItem` skips late WS re-inserts; remove from the set on failed-write rollback.
- Hashtag/trending → `#topic:…`; search deep links → `#searchView`.

## Empty states / shared widgets

- `templates/empty_state.html` via `lib/emptyState.mjs`. Snap feeds: `lib/snapCursorFeed.mjs`. Suggested accounts: `lib/suggestedAccounts.mjs`. Engagement: `templates/engagement_bar.html` + `lib/engagementBar.mjs`.
- Governance optimistic UX: `socialWrite.mjs` + `runWrite` failure toasts.
- **Download HTML**: post more menu → `exportHtml.mjs` → shared `markdown/standaloneDocument.mjs` (full offline document, including mediaRefs data URLs); same source as Chat message export. Saved filename follows the document `<title>`.
