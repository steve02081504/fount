---
description: Social Shell frontend (follow/block, federated notifications, timeline UI)
globs: src/public/parts/shells/social/**, src/decl/socialAPI.ts
alwaysApply: false
---

# Social Shell Frontend Guide

Deeper UI (video/live, body fold, feed replay, hash routing, search/replies/own-write): [ui-details.md](ui-details.md).
Timeline commit / OnMessage test traps: [test domain-harness](../../../../../../src/scripts/test/docs/domain-harness.md).

## Trust & backend surface

- **Local trust**: Social UI, `/api/parts/shells:social/...`, local timeline append. **Untrusted**: `part_timeline_put`, `part_invoke` — ingress `timeline/sync.mjs`, `discover/rpc.mjs`; outbound filter `timeline/federationExport.mjs`.
- **Write auth** (`federation/write_auth.mjs`): key history chain; genesis via recovery-signed `social_meta` / gen0 rotate / EVFS `profile.json` attestation.
- **Push admission**: `part_timeline_put` **and** `social_post_notify` accept follows-union ∪ shared group members ∪ follow/unfollow targeting a local entity. Pull already follow-filters. Denylist/reputation still apply.
- **Identity**: HTTP always operator via `SocialClient`. Agents: in-process `getSocialClient(username, agentEntityHash)`. No Web API identity switch.
- **Personal block/hide**: public block → `personal_block.json` + reputation; private hide → `personal_hide.json`. Group kick/ban = node `denylist.json` (separate). Chat personal-lists HTTP: `GET …/personal-lists`.
- **Visibility**: `socialMeta.hideFromDiscovery` ≠ post `content.visibility`. Tiers: `public` / `unlisted` / `followers`+`followers_since` / `selected`+`private` / optional `except`. Feed decrypt failure: `post.decryptView.failed`. `contentWarning` collapses body+media+poll; `sensitiveMedia` blurs media only.
- **mediaRefs.url**: same scheme whitelist as Markdown untrusted sanitize (`isSafeHtmlUrl`). EVFS/file GET: `applySafeContentHeaders` (`nosniff`; only image/audio/video may inline).
- **New timeline event types**: register in both `SOCIAL_TIMELINE_REDUCERS` and `SOCIAL_TIMELINE_EVENT_TYPES` (`federation/namespace.mjs`).
- **part_query**: register/unregister in Load/Unload (`federation/partQuery.mjs`); handlers in `trending|search|discover|live/network.mjs`.
- **Cross-shell chat HTTP**: viewer / personal-lists / entities/search / translation-prefs via chat shell APIs — frontend uses named functions in `public/src/endpoints/chatBridge.mjs` (not path-string clients). Live nodes need `loadParts: ['shells/social', 'shells/chat']`.
- **Share URL**: chat `wrapProtocolHttpsUrl`. `public/shared/*` is Deno-pure-importable (no `/parts/` or `/scripts/` URL imports). UI under `public/src/` may use `/scripts/*` and `/parts/…` freely.
- Types: `src/decl/socialAPI.ts`; overview: `public/llms.txt`.

## UI conventions

- CSS: page-local, no `social-` prefix. DaisyUI; custom chrome uses `.surface` (not `.card`). Empty states via `emptyState.mjs`. Ready-gate: `SOCIAL_GATE` / `fount:social-*`. Do not re-declare `.hidden` (from `/base.css`).
- Prefer `data-i18n` / `setElementI18n` / `renderTemplate` / `promptDialog`. **@-mention**: `aria-controls` + `aria-activedescendant` only — no `role="combobox"` on `<textarea>`.
- Fire-and-forget: `.catch(handleError('social.…'))` for fount faults; `showToastI18n` for user mistakes — never empty `.catch`.
- **Frontend HTTP**: named functions in `public/src/endpoints/*.mjs` only. Backend: `socialJson(handler)`; per-post JSON: `federation/postScopedJsonStore.mjs`.
- Hash routing / search / replies / own-write: [ui-details.md](ui-details.md). Avatars/names: chat `entityAvatar` / `resolveDisplayName` / `formatEntityAtId`. Bio/post Markdown: chat `shared/trustedMarkdown.mjs` (remote self-declared `ownerEntityHash` does not elevate).
- Hashtags: `src/lib/hashtags.mjs`; trending aside paints cache/local first, then `scope=nearby`. Browser imports of chat: absolute `/parts/shells:chat/...` URLs.

## Identity / private state

- Axioms: [human-agent-operational-parity-review.md](../../../../../../docs/review/human-agent-operational-parity-review.md).
- Edit/delete UI when `ownerEntityHash === viewer`. Viewer: `viewerEntityHash()` / `state.viewerEntityHash`.
- Saved posts / drafts: per-entity JSON under `shells/social/entities/{entityHash}/`; HTTP fixed to operator; agents via `client.saved.*` / `client.drafts.*`. Missing file → **fresh** empty structure (never shared `DEFAULT` shallow copy).
- Entity search: chat `GET …/entities/search` / `SocialClient.searchEntities`.

## Agent integration

New posts → `dispatchSocialMessage` → local agents `interfaces.social.OnMessage`; without it, @mention defaults to chat `GetReply` via `replyViaChat`. **Hard rule**: `User*` = operator, `Char*` = agent, `ReplyTo*` = post author — never put the post author in `User*`. Operator care → `care_post` inbox. Cross-node @ of non-local: `social_post_notify` RPC. Regression: `social_on_message`.

## Notifications

Per-recipient `shells/social/inbox/{entityHash}/`. `GET /notifications` aggregates like/repost/follow; WS `type: 'notification'`. API operator-only.
