# Chat Hub Frontend Guide

## Trust model

- **Local trust domain**: Hub UI, `/api/parts/shells:chat/...`, and in-process server logic are mutually trusted. Do not duplicate federation-style hex/array validation on local API calls or UI state.
- **External untrusted**: Trystero wire, `remoteIngest`, federation discovery/mailbox ingress, remote social payloads. Validate only at those gates (`src/scripts/p2p/wire_ingress.mjs`, `src/public/parts/shells/chat/src/chat/dag/remoteIngest.mjs`, `src/scripts/p2p/schemas/*`).

## Streaming AV

- **Default (no `streamingSfuWss`)**: WebCodecs + server **av-relay** (`codecsAv.mjs`, `/ws/.../av-relay/:roomId`). Suited to more viewers per publisher than browser WebRTC mesh.
- **With external SFU URL**: iframe/embed path via `renderStreamingChannel`.
- `public/src/channels/streaming.mjs` is legacy WebRTC mesh code (not used by Hub). Hub default path is av-relay via `renderWebRtcStreamingChannel` → `joinHubAvSession`, unless SFU is configured.

## UI conventions

- **User-visible errors**: use `handleUIError` from `public/src/ui/errors.mjs` — **toast + `console.error` + Sentry** (all three). Do not `catch` with only inline `hub/empty/error` or `showToastI18n` alone. Background/non-user paths may use `toError` + `console.error` + Sentry without toast (e.g. quiet federation rebind).
- No hardcoded user-visible strings in HTML/JS; use `data-i18n` and `zh-CN.json` (do not run `update-locales.py` in routine PRs).
- Prefer `renderTemplate` / `mountTemplate` over inline `innerHTML` for markup.
- Modals: use `openDialogFromTemplate` from `@src/public/pages/scripts/features/dialog.mjs` when available.
- State: `hubStore` in `core/state.mjs`; banner visibility via `core/bindings.mjs` when wired.

## Related

- [Shell AGENTS.md](../../../AGENTS.md)
- [Pages AGENTS.md](../../../../../pages/AGENTS.md)

## Message storage (hot / archive / DAG)

- **Hot**: `groups/{groupId}/snapshot.json` (`hot_posts` latest N + pin ±N; checkpoint payload), `messages/{channelId}.jsonl` slim cache.
- **Cold archive**: `groups/{groupId}/archive/{channelId}/{YYYY-MM}.jsonl` — local plaintext `PostSnapshot` (final content, reactions, display name/avatar).
- **DAG WAL**: `events.jsonl` — foldable process events (`message_edit`, reactions, pin/unpin); archived `message` rows removed only after cold archive + `dagFoldAfterArchive`.
- **Read path**: `listChannelMessages({ includeArchive: true })` merges hot + archive; `before` pagination may call `requestChannelHistoryFromPeers` when local miss.
- **Cleanup**: any user with a local group replica may delete **local** cold months via settings → `DELETE .../archive?before=YYYY-MM` (does not silent-prune DAG).
- **Archive sync**: `POST .../archive/sync` triggers `syncMissingArchiveMonths` (federation `monthDigests` reputation arbitration via `pickArchiveMonthByReputation` / `pickNodeScoreFromReputation`, not an admin Seal); after join, `catchUpGroupFromPeers` order is: joinSnapshot (reputation checkpoint) → `syncMissingArchiveMonths` → gossip `wantIds`; remote manifest only unions month hints.
- **Discovery**: an advert signature means "a member once claimed this"; indexing requires reputation or ≥2 independent node sources (see `discovery/index.mjs`); the Hub list shows abbreviated `sources`.
- **Display**: Hub prefers `content.displayName` / `content.displayAvatar` on archived or folded posts, then live profile.
- **Decrypt failure**: merged message rows use top-level `decryptView: { failed: true, pendingGeneration? }` with `content: null` (not inline `content.decryptFailed`). Archive `PostSnapshot` may still embed legacy `decryptView` on the snapshot object.
- **Reactions API**: `GET …/messages` returns `{ messages, reactions }` where `reactions` is per-page emoji aggregation keyed by target event id (not synthetic `reactionEvents` rows).
- **Group state**: `GET …/groups/:id/state` returns layered `{ meta, viewer, federation }`; members use `{ memberKey, kind, ownerPubKeyHash? }` not raw `pubKeyHash` dictionary keys.
- **Message navigation**: `messages/channelMessageStore.mjs` owns fetch/merge by `eventId` (`ensureMessageLoaded`); `messages.mjs` handles scroll/highlight (`scrollToMessageEventId`) and channel message load orchestration.
