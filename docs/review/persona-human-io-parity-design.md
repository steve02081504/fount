# Persona 对真人输入/输出的对称劫持设计草案

生成时间：`2026-07-04`

## 摘要

当前 `persona` 在 `chat` 里的职责主要是：

- 给 agent 提供 `user_prompt`
- 影响 user 的展示身份（`displayName` / `avatar`）
- 在旧 session chatLog CRUD 里保留少量编辑/删除钩子接口

但它**不能正式劫持真人主输入链路**，也**不能正式劫持真人主读取输出链路**。

如果目标是：

- persona 不只是“给 AI 看的用户设定”
- 还要成为“真人输入/输出视图策略”的一等组件
- 不优待 human，不把真人 UI 当作绕过 part 系统的裸通道

那么需要新增一套 **persona-aware human IO pipeline**。

一句话结论：

- 现在的 `persona` 不是真人 I/O 中间层
- 如果要实现，需要把“发消息前”和“读消息前”的 viewer/user 路径都显式接入 `persona` 钩子
- 推荐不要做成 `username` 特判，而要做成统一的 `viewer` / `input actor` 抽象

## 现状结论

### 1. 真实 human 发消息主路径不经过 persona 钩子

当前 Hub 发消息主路径是：

- 前端 `sendGroupMessage()`
- 后端 `POST /groups/:groupId/channels/:channelId/messages`
- 最终 `postChannelMessage()`

这条链路会：

- 规范化 content
- 上传附件
- 计算 `displayName` / `displayAvatar`
- 追加 DAG `message`

但**不会调用**：

- `user.interfaces.chat.GetChatLog`
- `user.interfaces.chat.MessageEdit`
- 任何“发送前改写正文”的 persona hook

所以 persona 现在不能：

- 自动改写 human 输入正文
- 自动拒绝 human 输入
- 自动拆分 / 重排 / 附加 human 输入
- 自动把 human 输入投影成另一种内容对象

### 2. 真实 human 读消息主路径不经过 persona 钩子

当前 Hub 读消息主路径是：

- `GET /groups/:groupId/channels/:channelId/messages`
- `readChannelMessagesForUser()`
- 返回 `{ messages, reactions }`

这里不会调用 persona 的 `GetChatLog`。

所以 persona 现在不能：

- 动态隐藏某些消息不让真人看
- 对真人阅读视图做重排 / 替换
- 为真人注入“你以为你看到的是 X”式假视图
- 做 viewer-specific 的输出过滤

### 3. persona 当前真正能影响的是“agent 对 user 的理解”

在 prompt struct 里，`user.interfaces.chat.GetPrompt / TweakPrompt` 会进入 `user_prompt`，并能附加 `additional_chat_log`。

这意味着 persona 当前主要服务对象是：

- agent prompt
- world / char / plugin 在生成时看到的 user 侧语义

而不是 human UI。

### 4. persona 当前还能影响展示身份，但不是内容 I/O

persona 可以影响：

- user 发言显示名
- user 发言头像
- profile presentation

但这属于 presentation，不等于“劫持输入/输出正文”。

## 设计目标

如果要让 persona 成为真人 I/O 的正式参与者，需要满足：

- human 发送前，persona 有机会观察、拒绝、改写输入
- human 读取前，persona 有机会过滤、改写、重排输出
- 这套机制和 world 的 agent-view 机制语义对齐
- 不把 human UI 保留成永远绕过 part 系统的裸后门

## 不要怎么做

### 1. 不要只在前端临时 patch

如果只是前端发消息前跑一段 persona JS：

- 不可信
- 远端 / 其他客户端不一致
- CLI / action / bot / deep link 路径会绕过
- 不是系统级语义

所以必须有服务端正式钩子。

### 2. 不要继续把 human 作为特殊生物单独命名

例如：

- `BeforeSendForUsername`
- `GetOutputForUsername`

这种命名短期能用，但长期会把系统继续锁死在人类特权模型上。

更好的抽象是：

- input actor
- viewer
- member

## 推荐设计

### 1. 输入侧：persona 输入拦截器

新增 persona 接口：

```ts
BeforeUserSend?: (arg: {
    groupId: string
    channelId: string
    username: string
    personaname?: string
    memberId: string
    input: channelMessageContent_t
    files?: file_t[]
}) => Promise<{
    input?: channelMessageContent_t
    files?: file_t[]
    reject?: string
}>
```

语义：

- 在真人消息真正落 DAG 前调用
- 可返回改写后的 `input / files`
- 可通过 `reject` 拒绝发送
- 不返回则表示透传

调用位置：

- 服务端 `postChannelMessage()` 之前
- 所有 human 发消息入口统一走这里
- CLI / HTTP / deep link / bot 只要声明“human send”都应复用

### 为什么不用复用 `MessageEdit`

因为 `MessageEdit` 是事后补救，不是发送前策略。真人输入劫持应该发生在“落盘前”，否则：

- 已经签名了
- 已经广播了
- 已经被别的节点看到
- 再改只是补丁，不是输入劫持

### 2. 输出侧：persona viewer 视图接口

新增 persona 接口：

```ts
GetChatLogForViewer?: (
    arg: chatReplyRequest_t,
    viewer: chatViewer_t,
) => Promise<chatLogEntry_t[]>
```

其中：

```ts
type chatViewer_t = {
    kind: 'user' | 'char'
    memberId: string
    ownerUsername: string
    channelId: string
    charname?: string
    roles?: string[]
    entityHash?: string
}
```

语义：

- `world` 决定世界规则
- `persona` 决定“这个 user 以何种主观视角看世界”
- human 与 char 都用同一个 viewer 抽象

推荐顺序：

1. base log
2. world `GetChatLogForViewer`
3. persona `GetChatLogForViewer`
4. UI DTO 投影

这样：

- world 先施加客观世界规则
- persona 再施加 user 主观滤镜

### 为什么 persona 输出层不该只叫 `GetChatLogForUsername`

因为那会继续把 human 写死成特权观察者。

如果未来还要支持：

- 远端 user
- 多账号切换
- watcher / bot / guest viewer
- 角色 impersonation 视角

那么 `viewer` 抽象更稳。

### 3. 现有 `userAPI.chat.GetChatLog` 怎么办

它现在像个半成品悬空接口。

建议二选一：

#### 方案 A：升级它

把它废弃重命名为：

```ts
GetChatLogForViewer(arg, viewer)
```

#### 方案 B：保留但降级

保留 `GetChatLog(arg)` 仅做 legacy sugar，内部等价于：

```ts
GetChatLogForViewer(arg, currentHumanViewer)
```

我更倾向方案 A，避免再留一个无 `viewer` 的糊涂接口。

## 主链路接入点

### 1. human send 主链路

当前：

- `sendGroupMessage()`
- `POST /channels/:id/messages`
- `postChannelMessage()`

需要改为：

1. 解析当前 persona / `memberId`
2. 构造 `humanSendContext`
3. 调 `persona.BeforeUserSend()`
4. 若 `reject`，HTTP 4xx
5. 若 `rewrite`，使用改写后内容继续落 DAG

### 2. human read 主链路

当前：

- `GET /channels/:id/messages`
- `readChannelMessagesForUser()`

需要增加 world / persona-aware viewer 物化层，例如：

```ts
materializeViewerChatLog(groupId, channelId, viewer)
```

由它完成：

1. 读取底层 message rows
2. hydrate 成 `chatLogEntry_t[]`
3. world viewer 过滤
4. persona viewer 过滤
5. 返回 UI 需要的消息 DTO

注意：

- raw channel messages API 可以保留给调试 / 治理
- 但 Hub 主聊天体验要切到 viewer-aware 读口
- 否则 persona 输出侧永远只是纸面接口

### 3. human edit / delete

当前 Hub edit/delete 直接走 DAG `message_edit` / `message_delete`。

如果要让 persona 参与真人消息维护，建议加：

```ts
BeforeUserEdit?: (ctx) => Promise<{
    edited?: object
    reject?: string
}>

BeforeUserDelete?: (ctx) => Promise<{
    reject?: string
}>
```

否则 persona 只能控制“发出去之前”，不能控制 user 自己后续撤回 / 改写。

## 推荐的接口集合

### persona chat 接口推荐增量

```ts
chat?: {
    GetPrompt?: ...
    TweakPrompt?: ...

    BeforeUserSend?: (ctx) => Promise<{
        input?: object
        files?: object[]
        reject?: string
    }>

    GetChatLogForViewer?: (
        arg: chatReplyRequest_t,
        viewer: chatViewer_t,
    ) => Promise<chatLogEntry_t[]>

    BeforeUserEdit?: (ctx) => Promise<{
        edited?: object
        reject?: string
    }>

    BeforeUserDelete?: (ctx) => Promise<{
        reject?: string
    }>
}
```

## 边界与原则

### 1. persona 可以是主观滤镜，不应该篡改底层真相

建议 persona 的输出过滤只影响：

- human viewer 看到的视图
- agent prompt 看到的视图

不要直接修改底层 DAG 原始 message truth，除非是输入前拦截。

### 2. world 与 persona 分工

推荐语义：

- `world`：世界规则、客观环境、共有幻觉、群体机制
- `persona`：用户主观镜头、用户交互策略、human-facing 体验层

这样职责最清楚。

### 3. human 不该有裸后门

如果 world 能骗 agent，但 human 永远直连 raw message store，那本质上还是 `human privileged architecture`。

如果系统目标是不优待人类，就必须让 human UI 也变成一个普通 viewer。

## 落地顺序

### 第一阶段：把输入拦截补齐

- 在 persona API 中新增 `BeforeUserSend`
- 在 `postChannelMessage()` 之前接入
- 统一所有 human 发送入口

### 第二阶段：把输出 viewer 化

- 新增 `chatViewer_t`
- 新增 persona `GetChatLogForViewer`
- 落一个 `materializeViewerChatLog()`

### 第三阶段：切 Hub 主读口

- 新增 viewer-aware 消息读取 API
- Hub 主聊天体验切过去
- raw channel API 保留给治理 / 调试

### 第四阶段：把 edit/delete 补齐

- 新增 `BeforeUserEdit`
- 新增 `BeforeUserDelete`
- 接入现有 message edit/delete 路径

## 最终结论

当前 `persona`：

- 能影响 agent 对 user 的理解
- 能影响 human 的展示身份
- 不能正式劫持 human 主输入正文
- 不能正式劫持 human 主输出视图

如果要补齐，应新增两类正式能力：

1. `BeforeUserSend`
   - 让 persona 成为真人输入前置中间层

2. `GetChatLogForViewer`
   - 让 persona 成为真人输出视图层的一部分

并且必须把 Hub 主读写链路接到这些服务端钩子上，否则接口再漂亮也只是摆设。
