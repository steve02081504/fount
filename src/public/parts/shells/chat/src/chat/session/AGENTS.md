---
description: Chat session viewer model (GetChatLogForViewer, member_roles, greeting hooks)
globs: src/public/parts/shells/chat/src/chat/session/**, src/decl/chatLog.ts, src/decl/worldAPI.ts
alwaysApply: false
---

# Chat Session Viewer Guide

## Viewer 对称

- 正式接口：`WorldAPI.chat.GetChatLogForViewer(arg, viewer)`（`chatViewer_t` 定义在 `src/decl/chatLog.ts`）。
- Shell 分发：`session/viewerLog.mjs` → `applyWorldChatLogView`（优先 Viewer；char 回退 legacy `GetChatLogForCharname`；无则透传）。
- Agent 路径已走统一分发：`getChatRequest` 构造 `viewer` 后调用；Hub human 主读仍是 raw messages（M3 再切 view-log）。
- 联邦：`remoteWorldProxy` + `rpcDispatcher.createWorldRpcDispatcher` 均有 `GetChatLogForViewer` case。

## member_roles

- `getChatRequest` 从物化 `state.members[*].roles` 注入顶层与 `extension.member_roles`。
- Char：`resolveActiveAgentMemberKeyByCharname`；本机 user：`resolveActiveMemberKeyForLocalUser`（local_signer_seed → pubKeyHash）。
- 不要用 `extension.memberId`（operator entity hash）直接查 `state.members` 的 user 键。

## Greeting

- `insertCharGreeting` / world greeting：缺 `GetGreeting` / `GetGroupGreeting` 时直接跳过，勿假定 hook 必存。
- 集成测试 fixture 可不实现 greeting；需要时复用 `test/fixtures/chars|worlds/*`。

## 回归

- Pure：`test/pure/viewer_log_dispatch.test.mjs`
- Integration：`test/integration/viewer_chatlog_parity.test.mjs`（fixture 复制进用户 `chars/` / `worlds/` 后 `newGroup` + `setWorld` + `addchar` + `postChannelMessage` + `getChatRequest`）
