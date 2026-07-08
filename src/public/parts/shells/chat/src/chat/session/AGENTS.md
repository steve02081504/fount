---
description: Chat session viewer model (GetChatLogForViewer, member_roles, greeting hooks, D6 builtins)
globs: src/public/parts/shells/chat/src/chat/session/**, src/decl/chatLog.ts, src/decl/worldAPI.ts, src/decl/userAPI.ts
alwaysApply: false
---

# Chat Session Viewer Guide

## Viewer symmetry

- Formal interfaces:
  - `WorldAPI.chat.GetChatLogForViewer(arg, viewer)` (`chatViewer_t` in `src/decl/chatLog.ts`)
  - `UserAPI.chat.GetChatLogForViewer(arg, viewer)` (persona's subjective filter; the dangling legacy `GetChatLog` has been removed)
- Shell dispatch: `session/viewerLog.mjs`
  - `applyWorldChatLogView` (prefers Viewer; falls back to legacy `GetChatLogForCharname` for char)
  - `applyPersonaChatLogView`
- **Fixed order**: base → world (objective) → persona (subjective).
- Agent: `getChatRequest` builds the viewer, then runs the two steps above.
- Human: `materializeViewerLog.mjs` → `GET …/view-log`; projects back to row DTOs (hides discarded entries, applies rewrite overrides, `viewerRewritten`); raw `GET …/messages` is preserved separately.
- Hub: `loadMessages` / incremental refresh go through `getChannelViewLog`; navigation backfill can still use raw batch-get / pin-context.
- Federation: `federation/remoteWorldProxy.mjs` + `federation/rpcDispatcher.mjs`; the world side exposes `GetChatLogForViewer`, `GetPrompt`/`TweakPrompt`/`GetGroupPrompt`, `GetCharReply`.
- **Optional-hook degradation across RPC**: the proxy defines every method, so "remote didn't implement it" surfaces as a `METHOD_NOT_FOUND` RPC error — `invokeRemote` catches it and returns `undefined`, making a missing remote hook indistinguishable from a locally-undefined one. Callers therefore uniformly use `hook?.(…) ?? fallback`. The dispatcher throws `METHOD_NOT_FOUND` for local parts lacking the method instead of falling through to network RPC.

## D6 built-in minimal world / persona

- `session/builtinParts.mjs`: `BUILTIN_WORLD` (`distribution: 'local'`), `BUILTIN_PERSONA`.
- `resolveWorld` / `loadPlayerFields` / `buildTimeSliceFromSession` return these singletons when nothing is bound or nothing is installed locally — **never `null`**.
- Their hooks either pass everything through or contribute nothing; they deliberately **do not implement** `GetSpeakingOrder` / `GetCharReply` / `GetGreeting` / `MessageEdit`(`Delete`) (implementing any of these would replace the default path).
- The pipeline can assume `world` / `user`/`player` are always objects, except in federation `rpcDispatcher`'s `not_local` branch.

## member_roles

- `getChatRequest` / materialize inject `state.members[*].roles` from the materialized state, both at the top level and into `extension.member_roles`.
- Char: `resolveActiveAgentMemberKeyByCharname`; local user: `resolveActiveMemberKeyForLocalUser` (`local_signer_seed` → `pubKeyHash`).
- Do not use `extension.memberId` (the operator's entity hash) to look up a user's key in `state.members` directly.

## Greeting

- `insertCharGreeting` / world greeting: skip outright when `GetGreeting` / `GetGroupGreeting` is missing — don't assume the hook always exists.
- When the group already has other entries, `greeting_type=group` prefers `GetGroupGreeting`, falling back to `GetGreeting`.
- `setWorld` greeting resolves the world per `channelId` via `resolveWorld`; don't just read `LastTimeSlice.world` (that only reflects the default channel).
- Integration test fixtures may skip implementing greeting; reuse `test/fixtures/chars|worlds/*` when one is needed.

## Write path (DAG-first, M2)

- **Sole human entry point**: `postChannelMessage` (Hub HTTP + CLI `actions.send`). Persona `BeforeUserSend` rewrites/rejects before persisting.
- **`BeforeUserSend` resolution**: resolve the persona for the **sender's** `username` via `getMaterializedSession` + `loadPlayerForReplica` — **do not** use `getActiveGroupRuntime` (in federation simulations a group slot may belong to a different replica and lack `LastTimeSlice`).
- **Persistence facade**: `channel/messageCommit.mjs` → world `AddChatLogEntry` (pre-DAG transform/reject) → canonical content → `appendSignedLocalEvent`.
- **Sole `After` trigger point**: `broadcastAndPersist` awaits `AfterAddChatLogEntry` for `message` and finalized `message_edit`; char/greeting flow through the same pipeline via `syncChatLogEntryToDag` / `finalizeDagGeneratingMessage`.
- Canonical content: everyone gets `displayName`/`displayAvatar`; generated entries also attach `sessionSnapshot`/`chatLogEntryId`.
- Fixture hook counters: use `globalThis` (once a part is copied into a user directory, it can no longer relatively import a helper from the test repo). See `test/fixtures/write_path_hook_state.mjs` (test side) and the fixture `main.mjs`'s inline `hookState()` using the same key (still works after being copied into a user's `worlds/`/`personas/`).
- Fixtures **must not** `import '../write_path_hook_state.mjs'` or similar relative paths — resolution breaks once installed into a user directory.
- Pure-test projection: only import `viewerLogProject.mjs` (don't pull in the session I/O graph via `materializeViewerLog`).

## Regression tests

- Pure: `test/pure/viewer_log_dispatch.test.mjs`
- Integration: `test/integration/viewer_chatlog_parity.test.mjs` (agent-path world filtering)
- Integration: `test/integration/viewer_human_viewlog.test.mjs` (view-log, persona, ordering, D6)
- Integration: `test/integration/write_path_unification.test.mjs` (single point for `BeforeUserSend` + Add/After; `triggerCharReply` is fire-and-forget, so wait for `After` before asserting)

## Edit/delete hooks (channel-native)

- **Sole Hub path**: `PUT/DELETE …/messages/:eventId` → `channel/channelUserHooks.mjs` (persona `BeforeUserEdit`/`BeforeUserDelete` → world `MessageEdit`/`MessageDelete`) → `messageMutations.appendChannelMessage*`.
- Persona resolution is the same as `BeforeUserSend` (the sender's replica via `loadPlayerForReplica`).
- `session/messages.mjs`'s `editMessage` has been removed; `deleteMessage` only does abort-placeholder cleanup.
- `triggerReply`: `world.GetCharReply?.(…) ?? char.GetReply(…)` — nullish result (missing hook, remote METHOD_NOT_FOUND, or explicit null) falls through to the char itself.
- Fixture counters: `test/fixtures/edit_path_hook_state.mjs` (same `globalThis` pattern as the write path).
- Integration: `test/integration/edit_path_hooks.test.mjs`.
