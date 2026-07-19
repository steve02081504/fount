---
description: Chat session viewer model (GetChatLogForViewer, member_roles, greeting hooks, builtin world/persona)
globs: src/public/parts/shells/chat/src/chat/session/**, src/decl/chatLog.ts, src/decl/worldAPI.ts, src/decl/userAPI.ts
alwaysApply: false
---

# Chat Session Viewer Guide

World distribution product model: [docs/design/world-distribution-spec.md](../../../../../../../../docs/design/world-distribution-spec.md).
Multi-node bind / fixture probes: [test domain-harness](../../../../../../../../src/scripts/test/docs/domain-harness.md).

## Speaker identity (`Uid`)

- Request: `UserUid` / `CharUid` / `ReplyToUid?`（与 `*Charname` 对称）。日志行：`chatLogEntry_t.uid`（必填；序列化始终写出）。
- **安全硬规则**：`User*` = 本机 operator/主人；`Char*` = 正在生成的 agent；`ReplyTo*` = 回复对象（可为外人）；`chat_log[].uid` = 该行说话人（可为外人）。**禁止**把 Discord/Telegram/Social 消息作者塞进 `User*`——角色可操作本机，认错主人极危险。
- 不透明可比较字符串（`===` / JSON）；fount chat 用 entityHash；bridge 用 `authorEntityHash`。**不是** RFC UUID。简化双人壳（shellassist / ide）可用 `'user'` / `'char'`。
- `name` / `*Charname` 只表示显示名；身份比对**只**走 `uid` / `*Uid`（勿按显示名回退）。
- 水合：`hydration.resolveSpeakerUid`；`getChatRequest` 填顶层 Uid，并从最近 `extension.replyTo.senderEntityHash` 填 `ReplyTo*`。Discord/Telegram/WeChat 经 bridge → `getChatRequest`，勿自建 request。
- `AddLongTimeLog` 若未带 `uid`，按 `role` 从请求的 `CharUid` / `UserUid` 补全（其余为 `'system'`）。

## Viewer symmetry

- Interfaces: `WorldAPI.chat.GetChatLogForViewer` / `UserAPI.chat.GetChatLogForViewer` (`chatViewer_t` in `src/decl/chatLog.ts`).
- Dispatch: `session/viewerLog.mjs` — **order** base → world (objective) → persona (subjective).
- Agent: `getChatRequest` builds viewer then runs both steps. Human: `materializeViewerLog.mjs` → `GET …/view-log` (row DTOs; raw `GET …/messages` separate for moderation).
- **Visibility ACL**: `lib/visibility.mjs` `entryVisibleToViewer` runs in prompt assembly **and** view-log base (before world hook). Raw `/messages` does not filter.
- **Pagination**: `readViewerChannelMessages` → `{ messages, visibleEventIds, hasMore, oldestRawEventId }`. `hasMore` = raw page hit `limit` before filtering. Empty filtered page with `hasMore` → advance with `oldestRawEventId`.
- Hub: `getChannelViewLog` / `getChannelViewLogByEventIds`. Federation proxies: `remoteWorldProxy.mjs` / `remoteProxy.mjs` / `rpcDispatcher.mjs`.
- **other_chars / other_personas**: from latest 500 lines + `aggregateChannelActivity`; other_chars = (`charFrequencies > 0`) ∪ Top-N (`otherCharsActiveLimit`, default 8); other_personas = active humans mapped to `session.personas` (exclude local `user`).
- **Optional hooks over RPC**: missing remote method → `METHOD_NOT_FOUND` → `invokeRemote` returns `undefined`. Callers use `hook?.(…) ?? fallback`.

## Built-in world / persona

- `session/builtinParts.mjs`: `BUILTIN_WORLD` (`distribution: 'local'`), `BUILTIN_PERSONA`. Returned when unbound / not installed — **never `null`**.
- They pass through or no-op; they deliberately omit `GetSpeakingOrder` / `GetCharReply` / `GetGreeting` / `MessageEdit`/`MessageDelete` (implementing any would replace defaults).

## World distribution

- `WorldAPI_t.distribution?: 'local' | 'replicated' | 'hosted'` (default `hosted`); written into `session_world_bind*` on bind.
- `resolveWorld` (`session.channelWorlds[channelId] || session.world`):
  - **`local`**: local `loadPart` or `BUILTIN_WORLD` (never RPC)
  - **`replicated`**: local install or `createRemoteWorldProxy(homeNodeHash)`
  - **`hosted`**: local host node → `loadPart(ownerUsername)`; else RPC
- Inbound: `hosted`/`replicated` require `homeNodeHash`; `local` may omit.
- **`GetChatPlugins`**: live objects; local same-name wins; hosted host-only (no RPC). **`TweakPrompt` hosted RPC**: in-place mutation lost across JSON.

## Local plugins

`groups/{groupId}/local_plugins.json` via `session/localPlugins.mjs` — node-private; not federated.

## World shared state + WorldChatHost

- DAG `world_state`: `{ worldname, action: 'set'|'delete', key, value? }` → `state.worldStates[worldname][key]` (LWW, group-scoped — use key prefixes for channel scope).
- Shell reducer is ACL-agnostic; world's fold layer ignores unauthorized ops.
- `WorldChatHost` (`session/worldHost.mjs`): `state`, `localData`, `triggerCharReply`, `postSystemMessage`, `listMembers`/`listChannels`. Wired once on local `resolveWorld` via `ChatHostConnected` (not for builtin/remote proxy).
- `session_*` is node-local (federation ingest rejects). Federation inbound: `aclGated` + 64KB content limit.

## member_roles / greeting

- Inject `state.members[*].roles` into top-level and `extension.member_roles`. Resolve char via `resolveActiveAgentMemberKeyByCharname`; local user via `resolveActiveMemberKeyForLocalUser`. Do not look up `state.members` by `extension.memberId` (operator entity hash).
- Skip greeting when hooks are missing. Keep `timeSlice.greeting_type` (and mirrors) — deleting breaks re-roll / `greetingLog`. `bindWorld` greeting uses `resolveWorld(channelId)`, not only `LastTimeSlice.world`.

## Write / edit path

- Human entry: `postChannelMessage`. Persona `BeforeUserSend` before persist — resolve persona for **sender's** `username` via `getMaterializedSession` + `loadPlayerForReplica` (**not** `getActiveGroupRuntime`).
- Persist: `channel/messageCommit.mjs` → world `AddChatLogEntry` → `appendSignedLocalEvent`. Sole `After` point: `broadcastAndPersist` for `message` and finalized `message_edit`.
- Char display: `resolveDisplaySnapshot` with `charId` (not sender persona). Preserve `displayName`/`displayAvatar` through streaming finalize / `message_edit`.
- Edit/delete Hub path: `PUT/DELETE …/messages/:eventId` → `channel/channelUserHooks.mjs` → `messageMutations`. `triggerReply`: `world.GetCharReply?.(…) ?? char.GetReply(…)`.
- Pure projection tests: import `viewerLogProject.mjs` only (not the full session I/O graph).
