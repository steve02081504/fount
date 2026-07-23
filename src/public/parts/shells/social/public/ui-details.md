# Social UI details (less common)

Day-to-day rules: [AGENTS.md](AGENTS.md).

## Hash routing

- `switchView` → `#feed` / `#explore` / … / `#drafts` / `#settings`
- Post detail: `#post;<entityHash>;<postId>`
- Search: `#search;q` / `#search:q` / `?q=` → `#searchView`
- Hashtag/trending → `#topic:…`
- Preference UI lives under `#settings` (not a top-level nav entry)

## Short video / live UI

- Slide fields from `buildPostFeedItem`: `post.content.text` / `post.content.mediaRefs` / `authorProfile` — not flat `item.text` / `item.authorName`.
- Action bar: like / comment / share / mute; mute in `localStorage` (`fount.social.video.muted`). Comment drawer: close button / click-outside / Esc. Reply ticker: `syncVideoCommentTicker`. `cardRoot` for panels: `.post-card, .reply, .video-slide`.
- Live: vertical snap + cursor near end; next slide preconnect with AV `subscribe mode=preview`. Empty lobby → `buildNearbyLiveFeed`.

## Long body fold

Feed/profile/search cards (`openDetail !== false`) collapse markdown code `<details>` by default and clamp tall `.body` (~280px) with `.body-expand`. Post detail keeps full height. `POST_CARD_OPEN_EXCLUDE` includes `summary` / `.body-expand`.

## Feed pagination / replay

- Shared: `/scripts/infiniteScroll.mjs` (`data-scroll-sentinel` + `insertBeforeScrollSentinel`). Do not `appendChild` past the sentinel. Rising-edge arm; after replay do not rebind while intersecting. `data-feed-replaying` marks an in-flight loop replay. If loader has its own mutex, bind **after** releasing it.
- Prefetch next cursor into `state.feedPrefetch`. Replay when `nextCursor` exhausted: re-append shown items (`.feed-replay-divider`); requires real scroll. Delete/hide/block/mute must `purgeFeedShownPost` / `purgeFeedShownAuthor`.
- Hashtag/trending → `#topic:…`; search deep links → `#searchView`.

## Empty states / shared widgets

- `templates/empty_state.html` via `lib/emptyState.mjs`. Snap feeds: `lib/snapCursorFeed.mjs`. Suggested accounts: `lib/suggestedAccounts.mjs`. Engagement: `templates/engagement_bar.html` + `lib/engagementBar.mjs`.
- Governance optimistic UX: `socialWrite.mjs` + `runWrite` failure toasts.
