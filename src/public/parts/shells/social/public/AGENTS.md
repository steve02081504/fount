---
description: Social Shell frontend (follow/block, federated notifications, timeline UI)
globs: src/public/parts/shells/social/**, src/decl/socialAPI.ts
alwaysApply: false
---

# Social Shell Frontend Guide

Deeper UI (video/live, body fold, feed replay): [ui-details.md](ui-details.md).

## Trust & backend surface

- **Local trust**: Social UI, `/api/parts/shells:social/...`, local timeline append. **Untrusted**: `part_timeline_put`, `part_invoke` — ingress `timeline/sync.mjs`, `discover/rpc.mjs`; outbound filter `timeline/federationExport.mjs`.
- **Write auth** (`federation/write_auth.mjs`): key history chain; genesis via recovery-signed `social_meta` / gen0 rotate / EVFS `profile.json` attestation.
- **Push admission**: `part_timeline_put` **and** `social_post_notify` accept follows-union ∪ shared group members; pull already follow-filters. Denylist/reputation still apply.
- **Identity**: HTTP always operator via `SocialClient`. Agents: in-process `getSocialClient(username, agentEntityHash)`. No webapi identity switch.
- **Personal block/hide**: public block → `personal_block.json` + reputation; private hide → `personal_hide.json`. Group kick/ban = node `denylist.json` (separate). Chat personal-lists HTTP: `GET …/personal-lists`.
- **Visibility**: `socialMeta.hideFromDiscovery` ≠ post `content.visibility`. Tiers: `public` / `unlisted` / `followers`+`followers_since` / `selected`+`private` / optional `except`. Feed decrypt failure: `post.decryptView.failed`. `contentWarning` collapses body+media+poll; `sensitiveMedia` blurs media only.
- **mediaRefs.url**: `sanitizeMediaRefs` + `mediaRefUrl` use the same scheme whitelist as Markdown untrusted sanitize (`isSafeHtmlUrl`).
- **EVFS / file GET**: `applySafeContentHeaders` (`src/scripts/http_content.mjs`) — `nosniff`; only image/audio/video may inline; html/svg/etc. → `attachment` + `application/octet-stream`.
- **New timeline event types**: register in both `SOCIAL_TIMELINE_REDUCERS` and `SOCIAL_TIMELINE_EVENT_TYPES` (`federation/namespace.mjs`).
- **part_query**: register/unregister in Load/Unload (`federation/partQuery.mjs`); handlers in `trending|search|discover|live/network.mjs`.
- **Cross-shell chat HTTP**: viewer / personal-lists / entities/search / translation-prefs via `/api/parts/shells:chat/…`. Live nodes need `loadParts: ['shells/social', 'shells/chat']`.
- **Share URL**: chat `wrapProtocolHttpsUrl`. `public/shared/runUri.mjs` must stay Deno-pure-importable (no `/parts/` URL imports).
- Types: `src/decl/socialAPI.ts`; overview: `public/llms.txt`.

## UI conventions

- CSS: page-local, no `social-` prefix. Icons `.icon` + `.icon-*`. Ready-gate: `SOCIAL_GATE` / `fount:social-*`.
- Prefer `data-i18n` / `setElementI18n`; placeholders must be object keys with `placeholder`. Templates: `${...}` only (no Mustache `{{...}}`). Prefer `renderTemplate` / `mountTemplate`.
- Empty states: `lib/emptyState.mjs` (`buildEmptyState` / `mountEmptyState` / `appendEmptyState`) + `templates/empty_state.html`.
- Heart anim: `lib/heartAnim.mjs` `playHeartAnim` (shared by video / live / post media).
- HTTP routes: `endpoints/shared.mjs` `socialJson(handler)`; per-post JSON projection: `federation/postScopedJsonStore.mjs`.
- Hash routing: `switchView` → `#feed`/`#explore`/…/`#drafts`/`#settings`; detail `#post;<entityHash>;<postId>`; search `#search;q` / `#search:q` / `?q=` → `#searchView`.
- **`activateView(name)`** → `#${name}View` — `data-view` and section id must share the stem (`videos` → `#videosView`).
- Avatars/names/@id: chat `entityAvatar.mjs` / `resolveDisplayName` / `formatEntityAtId` (`entityHandle`). Profile page: `rememberEntityHandle` before rendering posts. Hover: `lib/profileHover.mjs` → chat hover card.
- Bio/post Markdown: chat `shared/trustedMarkdown.mjs`. Trusted: self / local-char / declared master / trust list. Remote self-declared `ownerEntityHash` does not elevate.
- Browser imports of chat: absolute `/parts/shells:chat/...` URLs. Modules used by Deno pure tests must not contain `/parts/` imports.
- Preference UI: `#settings` (taste is not a top-level nav entry).

## Identity / private state

- Axioms: [human-agent-operational-parity-review.md](../../../../../../docs/review/human-agent-operational-parity-review.md).
- Edit/delete UI when `ownerEntityHash === viewer`. Viewer: `viewerEntityHash()` / `state.viewerEntityHash`.
- Saved posts / drafts: per-entity JSON under `shells/social/entities/{entityHash}/`; HTTP fixed to operator; agents via `client.saved.*` / `client.drafts.*`. Missing file → **fresh** empty structure (never shared `DEFAULT` shallow copy).
- Entity search: chat `GET …/entities/search` / `SocialClient.searchEntities`.

## Agent integration

- New posts → `dispatchSocialMessage` → local agents `interfaces.social.OnMessage`; without it, @mention defaults to chat `GetReply`. Operator care → `care_post` inbox. Cross-node @ of non-local: `social_post_notify` RPC.
- Tests: prefer real fixture chars, or `appendTimelineEvent` (skips dispatch). `commitTimelineEvent` / ingest triggers `loadPart`.

## Notifications

Per-recipient `shells/social/inbox/{entityHash}/`. `GET /notifications` aggregates like/repost/follow; WS `type: 'notification'`. API operator-only.
