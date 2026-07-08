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
- 群内已有其它条目时 `greeting_type=group`：优先 `GetGroupGreeting`，可回退 `GetGreeting`。
- `setWorld` 问候按 `channelId` 用 `resolveWorld`，不要只读 `LastTimeSlice.world`（那只反映默认频道）。
- 集成测试 fixture 可不实现 greeting；需要时复用 `test/fixtures/chars|worlds/*`。

## 写路径（DAG-first，M2）

- **唯一 human 入口**：`postChannelMessage`（Hub HTTP + CLI `actions.send`）。persona `BeforeUserSend` 在落盘前改写/拒绝。
- **落盘门面**：`channel/messageCommit.mjs` → world `AddChatLogEntry`（pre-DAG transform/reject）→ canonical content → `appendSignedLocalEvent`。
- **After 唯一触发点**：`broadcastAndPersist` 对 `message` / 终稿 `message_edit` await `AfterAddChatLogEntry`；char/greeting 经 `syncChatLogEntryToDag` / `finalizeDagGeneratingMessage` 进同一条管线。
- Canonical：全员 `displayName`/`displayAvatar`；生成类另附 `sessionSnapshot`/`chatLogEntryId`。
- Fixture 钩子计数：用 `globalThis`（part 被拷进用户目录后不能相对 import 测试仓库里的 helper）。见 `test/fixtures/write_path_hook_state.mjs`（测试侧）与 fixture `main.mjs` 内联同 key 的 `hookState()`（复制进用户 `worlds/`/`personas/` 后仍可用）。
- Fixture **禁止** `import '../write_path_hook_state.mjs'`之类相对路径：装入用户目录后解析会炸。

## 回归

- Pure：`test/pure/viewer_log_dispatch.test.mjs`
- Integration：`test/integration/viewer_chatlog_parity.test.mjs`（fixture 复制进用户 `chars/` / `worlds/` 后 `newGroup` + `setWorld` + `addchar` + `postChannelMessage` + `getChatRequest`）
- Integration：`test/integration/write_path_unification.test.mjs`（BeforeUserSend + Add/After 单点；`triggerCharReply` 为 fire-and-forget，断言前需等到 After）
