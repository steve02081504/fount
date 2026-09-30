# code shell 会话运行时重构（设计契约）

面向 `shells/code` 的一次性重构：把「运行属于会话、输入属于标签页、DOM 只画当前标签页」确立为硬边界，据此修掉跨标签串状态、附件串会话、后台预览丢失、完成通知不可靠等问题，并顺手拆分过大的前端模块。

本文件是并行实现的接口契约：后端（`code/src/**`）、共享前端组件（`src/public/pages/**`）、code 前端（`code/public/**`）三方按此对齐，任何一方不得单方面改动下列形状。

> 状态：本契约已实现并落地（三方均已按此对齐）。本文件保留为回归测试与后续改动的接口基线，代码为准。

## 一、状态模型

### 前端运行时（`code/public/src/store.mjs`）

`store` 删除以下全局单例字段：`generating`、`generatingSession`、`generatingRunId`、`recovering`、`pendingFiles`、`dirtyTabKey`。

新增 `store.runtimes: Map<tabKey, SessionRuntime>`，按需创建。`tabKey` 仍为 `t:<workspaceId>:<id>`（`tabKeyOf(tab)`）。

```
SessionRuntime = {
  tabKey,
  session,            // 该标签页的会话对象；活动标签页时与 store.session 同一引用
  status,             // 'idle' | 'submitting' | 'generating' | 'recovering' | 'stopping'
  runId,              // 权威运行 id（后端 run-start 回填）
  previewText,        // 最近一次 preview 展示文本（切回标签页时重建流式气泡用）
  liveTools,          // Map<callId, { name, lang, code, output }>；切回时重建实时工具卡
  attach,             // 待决 attach 等待对象 { resolve, timer } | null
  attachments,        // 待发送附件 [{ id, name, mime_type, buffer, description, state }]
  revision,           // 本地修改版本号（保存队列用）
  savedRevision,      // 已落盘版本号
  scroll,             // { pinned, top } | null（可选）
}
```

`store.mjs` 对外冻结以下工具函数，全部 UI 判断只经由它们：

- `tabKeyOf(tab)`
- `activeTab()`
- `getRuntime(tabKey, { create = false })`
- `getActiveRuntime()`
- `isGenerating(tabKey)`：`status` 为 `generating` 或 `stopping`
- `isBusy(tabKey)`：`status !== 'idle'`

活动标签页始终满足 `getActiveRuntime().session === store.session`。

### 发送 / 停止按钮

`updateSendButton()` 只读活动标签页的 `status`：

- `generating` / `stopping` → 停止按钮，点击只中止该标签页对应 `sessionId` 的运行。
- 其他 → 发送按钮；即使别的标签页正在生成，也保持发送（允许并发）。

## 二、模块拆分（`code/public/src/`）

| 文件 | 职责 |
| --- | --- |
| `store.mjs` | 状态 + 运行时工具 + `elements` + `richInput` |
| `tabs.mjs` | 标签条渲染、右键菜单、开关/新建、跨页同步（BroadcastChannel）、URL 同步 |
| `session.mjs` | 会话加载/创建/删除、`activateTab`、草稿保存与恢复 |
| `sessionPersistence.mjs` | 按标签页的落盘队列（`markSessionDirty` / flush / beforeunload） |
| `generation.mjs` | 共享 WS、按会话运行状态、attach/recover、终态合并 |
| `streamView.mjs` | 生成中气泡、实时工具卡 |
| `submission.mjs` | 统一发送入口（普通消息 / regen / retry / 斜杠命令 / 仅附件） |
| `shellExecution.mjs` | `!` shell 模式执行 |
| `attachments.mjs` | 按标签页附件队列、缩略图、图片编辑、预览、序列化 |
| `completion.mjs` | `code-run-settled` 处理：声音、未读点、已读标记 |
| `messages.mjs` | 气泡、操作栏、反馈、滚动 |
| `composer.mjs` | 输入、历史、影子补全、斜杠/提及、粘贴/拖拽 |

迁移到位后直接更新消费者 import，不保留长期转发层。禁止循环依赖：`store` 不 import 其他业务模块；`generation` 不 import `messages`（通过回调或 `streamView` 解耦）。

## 三、WS 协议（后端 `code/src/endpoints.mjs`）

客户端 → 服务端帧不变：`send` / `regen` / `trigger` / `abort` / `attach` / `typing`，`send` 起每帧带 `runId`。

服务端 → 客户端帧不变：`run-start` / `preview` / `tool-output` / `entries-append` / `done` / `aborted` / `error`，每帧带 `runId` + `sessionId`。

新增约定：

1. **仅附件发送**：`send` 在 `content` 为空但 `files` 非空时也合法；校验改为「`content` 与 `files` 至少一个非空」。
2. **多观察连接**：`run.socket` 改为 `run.sockets: Set<WebSocket>`；`attach` 加入集合；连接关闭只从集合移除自身；所有出帧通过一个广播函数发出。前端一页共用一个 WS，按 `msg.sessionId` 路由到运行时。
3. **abort 校验运行身份**：`abort` 携带 `sessionId`（必需）与 `runId`（可选）；`runId` 不匹配当前运行时忽略该请求，避免迟到的停止中止下一次运行。
4. **终态事件**：运行到达终态并完成落盘后，`sendEventToUser(username, 'code-run-settled', payload)`，payload 形状：

```
{ chatName: 'code-<sessionId>', sessionId, workspaceId, runId, status: 'done' | 'error' | 'aborted' }
```

被新请求取代的旧运行（`run.superseded`）不派发。唤醒/钩子/作业恢复运行照常派发。`error` 路径即使落盘失败也派发（`status: 'error'`）。

## 四、完成语义（前端 `completion.mjs`）

- 同一 `runId` 的声音只响一次；用共享去重集合（多页面用 `localStorage` + Web Locks，或退化为 localStorage 记录，随 runId 增长做上限清理）。
- 播放条件：**无**。不看来源标签页、不看焦点、不看是否 `suppressed`、不看系统通知权限。一次实际运行结束即尝试播放一次。
- 未读点：终态对应标签页不是「可见且聚焦的活动标签页」时加未读点；激活并成功渲染后清除。
- WS 终态帧与 `code-run-settled` 事件共用处理函数，按 `runId` 幂等。
- `bumpCodeSessionNotification()` 保留为兼容入口，转调终态处理。

共享层配合：

- `src/public/pages/service_worker.mjs` `routeNotification`：页内 `postMessage({ type:'notification', … })` **始终**发给 pathname 匹配的 client；`Notification.permission !== 'granted'` 只跳过 `showNotification`。
- `src/public/pages/base.mjs`：通知载荷带 `options.data.suppressPageSound` 时跳过其页内声音，避免与 code 终态声音重复。
- `src/public/pages/scripts/features/notificationSound.mjs`：新增可选的音频预初始化（首次用户手势），播放失败不再丢弃；导出保持 `playNotificationSound()`。

## 五、附件模型（前端 `attachments.mjs`）

- 附件挂在 `runtime.attachments`，随标签页走；不进入会话 JSON，也不进标签页广播。
- 稳定 `id`，移除/编辑按 `id` 定位，不用数组下标。
- 图片：缩略图 + 「编辑」（`/scripts/components/imageEditor.mjs` `openImageEditor`）+ 「预览」（`/scripts/components/mediaViewer.mjs` `openMediaViewer`）+ 说明输入（沿用 `description`）。
- 普通文件：类型图标 + 名称 + 大小（`/scripts/lib/formatBytes.mjs`）+ 下载/预览。
- 已发送条目：`renderMessageAttachments(entry)` 渲染缩略图/文件卡，图片可点开查看器；不再提供对历史附件的编辑。
- Blob URL 由持有者创建与回收：切标签页、移除、替换、关闭查看器时回收；查看器打开期间不得提前 revoke。缩略图 `<img>` 打 `svg-inliner-ignore`。
- 发送给后端的形状保持 `{ name, mime_type, buffer, description }`。

## 六、提交（发送）契约（`submission.mjs`）

1. 在第一次 `await` 之前快照：`tabKey`、`session`、目标 `machine/workdir`、`charname`、`ai_source`、`profile`、文本、附件。
2. 立即置该运行时 `status='submitting'`，阻止重复提交。
3. 展开 gist、组装 `files`、乐观插入用户条目并回显。
4. 请求送出成功后再清除本次发送对应的草稿内容与附件；用户在此之后新输入的内容保留。
5. 失败（含请求未送达）时保留/恢复本次草稿，明确区分「未发送」与「生成失败」。
6. `send` 支持仅附件；`fount.user.send` 与斜杠命令走同一入口。

## 七、i18n 归属

- code 前端键位于 `src/public/locales/{zh-CN,en-UK,ja-JP}.json` 的 `code.*` 树，至少补齐三种语言（en-UK 必须真实拉丁文本）。`shells/code/locales.json` 只是部件信息注册表（`info`），**不承载** `code.*` 文案键。
- 共享层新增键：`src/public/locales/{zh-CN,en-UK,ja-JP}.json` 的 `util.*`。
- 后端不得新增 locale 键（沿用既有 `code.notify.*`）。
- 用 Python 工具写 locale JSON，不用 JS `JSON.stringify`（会重排数字键）。

## 八、测试期望

- 前端：两标签页可各自发送/生成/停止；后台完成不改当前标签页按钮；切回生成标签页恢复预览与实时工具卡；附件跟随标签页；图片缩略图/编辑/预览；完成声音与未读点（含权限 denied、页面失焦/隐藏、WS 与事件双通道去重）。
- 后端：两会话并发与指定运行中止；多页 attach 不互抢；attach 重放含已产生预览/工具状态；错误落盘且离线可重试；`code-run-settled` 在落盘后派发；仅附件 `send`。
- 共享层：`routeNotification` 在无权限时仍派发页内消息；`suppressPageSound` 生效。
