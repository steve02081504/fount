# Social UI details (less common)

Day-to-day rules stay in [AGENTS.md](AGENTS.md).

## Short video / live UI

- Slide fields from `buildPostFeedItem`: `post.content.text` / `post.content.mediaRefs` / `authorProfile` — not flat `item.text` / `item.authorName`.
- Action bar: like / comment / share / mute; mute in `localStorage` (`fount.social.video.muted`). Comment drawer: close button / click-outside / Esc. Reply ticker: `syncVideoCommentTicker`; click → `focusReplyInPanel`. `cardRoot` for panels: `.post-card, .reply, .video-slide`.
- Live: vertical snap + cursor near end; next slide preconnect with AV `subscribe mode=preview`. Empty lobby → `buildNearbyLiveFeed`.

## Long body fold

Feed/profile/search cards (`openDetail !== false`) collapse markdown code `<details>` by default and clamp tall `.body` (~280px) with `.body-expand` (`social.feed.showMore` / `showLess`). Post detail keeps full height. `POST_CARD_OPEN_EXCLUDE` includes `summary` / `.body-expand`.

## Feed pagination / replay

- Shared: `/scripts/infiniteScroll.mjs`. After replay, **move** the sentinel — do not rebind while intersecting (infinite loop). Rising-edge arm. If loader has its own mutex, bind **after** releasing it.
- Prefetch next cursor into `state.feedPrefetch`. Playwright: wait for `cursor=` during/after first paint.
- Replay when `nextCursor` exhausted: re-append shown items (`.feed-replay-divider`). Requires real scroll (`scrollY > 0` + content taller than viewport). Delete/hide/block/mute must `purgeFeedShownPost` / `purgeFeedShownAuthor`.
- Hashtag/trending → `#topic:…` (`loadTopicView`), not `#search;`. Search deep links → `#searchView`.

## Empty states / shared widgets

- `templates/empty_state.html` via `lib/emptyState.mjs`. Snap feeds: `lib/snapCursorFeed.mjs`. Suggested accounts: `lib/suggestedAccounts.mjs`. Engagement: `templates/engagement_bar.html` + `lib/engagementBar.mjs`.
- Governance optimistic UX: `socialWrite.mjs` + `runWrite` failure toasts.
