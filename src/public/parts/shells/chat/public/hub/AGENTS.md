# Chat Hub Frontend Guide

## Trust model

- **Local trust domain**: Hub UI, `/api/parts/shells:chat/...`, and in-process server logic are mutually trusted. Do not duplicate federation-style hex/array validation on local API calls or UI state.
- **External untrusted**: Trystero wire, `remoteIngest`, federation discovery/mailbox ingress, remote social payloads. Validate only at those gates (`scripts/p2p/wire_ingress.mjs`, `remoteIngest`, `scripts/p2p/schemas/*`).

## Streaming AV

- **Default (no `streamingSfuWss`)**: WebCodecs + server **av-relay** (`codecsAv.mjs`, `/ws/.../av-relay/:roomId`). Suited to more viewers per publisher than browser WebRTC mesh.
- **With external SFU URL**: iframe/embed path via `renderStreamingChannel`.
- WebRTC mesh (`streaming.mjs` / group WS signaling) remains for peer-to-peer experiments; Hub join flow uses relay unless SFU is configured.

## UI conventions

- **User-visible errors**: use `handleUIError` from `public/src/ui/errors.mjs` — **toast + `console.error` + Sentry** (all three). Do not `catch` with only inline `hub/empty/error` or `showToastI18n` alone. Background/non-user paths may use `toError` + `console.error` + Sentry without toast (e.g. quiet federation rebind).
- No hardcoded user-visible strings in HTML/JS; use `data-i18n` and `zh-CN.json` (do not run `update-locales.py` in routine PRs).
- Prefer `renderTemplate` / `mountTemplate` over inline `innerHTML` for markup.
- Modals: use `openDialogFromTemplate` from `@src/public/pages/scripts/dialog.mjs` when available.
- State: `hubStore` in `core/state.mjs`; banner visibility via `core/bindings.mjs` when wired.

## Related

- [Shell AGENTS.md](../../AGENTS.md)
- [Pages AGENTS.md](../../../../pages/AGENTS.md)

## Message storage (hot / archive / DAG)

- **Hot**: `checkpoint.json` (`hot_posts` latest N + pin ±N), `messages/{channelId}.jsonl` slim cache.
- **Cold archive**: `groups/{groupId}/archive/{channelId}/{YYYY-MM}.jsonl` — local plaintext `PostSnapshot` (final content, reactions, display name/avatar).
- **DAG WAL**: `events.jsonl` — foldable process events (`message_edit`, reactions, pin/unpin); archived `message` rows removed only after cold archive + `dagFoldAfterArchive`.
- **Read path**: `listChannelMessages({ includeArchive: true })` merges hot + archive; `before` pagination may call `requestChannelHistoryFromPeers` when local miss.
- **Cleanup**: any group member deletes **local** cold months via settings → `DELETE .../archive?before=YYYY-MM` (does not silent-prune DAG).
- **Archive sync**: `POST .../archive/sync` triggers `syncMissingArchiveMonths`（联邦 `monthDigests` 信誉仲裁，非管理员 Seal）；入群 `joinSnapshot` 后 catchUp 顺序：信誉 checkpoint → gossip → 补拉冷月；远端 manifest 仅 union 月份 hint。
- **Discovery**: 广告签名为「某成员曾声称」，索引需信誉或 ≥2 独立 node 来源（见 `discovery/index.mjs`）；Hub 列表展示 `sources` 缩写。
- **Display**: Hub prefers `content.displayName` / `content.displayAvatar` on archived or folded posts, then live profile.
- **Message navigation**: `messages/channelMessageStore.mjs` owns fetch/merge by `eventId` (`ensureMessageLoaded`); `messages.mjs` only scrolls/highlights DOM (`scrollToMessageEventId`).
