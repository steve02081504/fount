---
description: Chat Hub frontend (trust model, streaming AV, message storage UI)
globs: src/public/parts/shells/chat/public/hub/**
alwaysApply: false
---

# Chat Hub Frontend Guide

## Trust model

- **Local trust domain**: Hub UI, `/api/parts/shells:chat/...`, and in-process server logic are mutually trusted. Do not duplicate federation-style hex/array validation on local API calls or UI state.
- **External untrusted**: Trystero wire, `remoteIngest`, federation discovery/mailbox ingress, remote social payloads. Validate only at gates: `src/scripts/p2p/wire_ingress.mjs`, `src/public/parts/shells/chat/src/chat/dag/remoteIngest.mjs`, `src/scripts/p2p/schemas/*`.

## Streaming AV

- **Default (no `streamingSfuWss`)**: WebCodecs + server **av-relay** (`codecsAv.mjs`, `/ws/.../av-relay/:roomId`).
- **With external SFU URL**: iframe/embed via `renderStreamingChannel`.
- Hub default: av-relay via `renderCodecsAvStreamingChannel` → `joinHubAvSession` unless SFU configured.

## UI conventions

- **Errors**: use `handleUIError` from `public/src/ui/errors.mjs` — toast + `console.error` + Sentry (all three). Do not catch with only `showToastI18n` alone. Background paths: `toError` + `console.error` + Sentry without toast.
- **Relative imports**: files directly under `public/hub/` must reach shared frontend helpers with `../src/...`; using `../../src/...` resolves to `/parts/src/...` in the browser and hard-fails module loading.
- No hardcoded user-visible strings; use `data-i18n` and `zh-CN.json`.
- Prefer `renderTemplate` / `mountTemplate` over inline `innerHTML`.
- Modals: `openDialogFromTemplate` from `@src/public/pages/scripts/features/dialog.mjs`.
- State: `hubStore` in `core/state.mjs`; banner visibility via `core/bindings.mjs`.

## Message storage & APIs

Backend storage model (hot / cold archive / DAG, federation sync): [archive guide](../../src/chat/archive/AGENTS.md).

Hub-facing API shapes:

- **Decrypt failure**: merged rows use top-level `decryptView: { failed: true, pendingGeneration? }` with `content: null`.
- **Reactions**: `GET …/messages` returns `{ messages, reactions }` — per-page emoji aggregation keyed by target event id.
- **Group state**: `GET …/groups/:id/state` → `{ meta, viewer, federation }`; members use `{ memberKey, kind, ownerPubKeyHash? }`.
- **Display**: prefers `content.displayName`/`content.displayAvatar` on archived/folded posts, then live profile.
- **Navigation**: `messages/channelMessageStore.mjs` owns fetch/merge by `eventId` (`ensureMessageLoaded`); `messages.mjs` handles scroll/highlight (`scrollToMessageEventId`).
