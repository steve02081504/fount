# Chat 世界视角对齐设计草案：不优待人类的 viewer 对称模型

生成时间：`2026-07-04`

> **状态更新（2026-07-08）**：本设计的第一、二阶段已随 M1 完工——`chatViewer_t` 与 `WorldAPI.chat.GetChatLogForViewer` 已进 decl（`src/decl/chatLog.ts` / `src/decl/worldAPI.ts`），`applyWorldChatLogView` 落在 `src/chat/session/viewerLog.mjs`，agent 路径已走统一分发，`remoteWorldProxy` / `rpcDispatcher` 已补 RPC case，回归测试在 `test/pure/viewer_log_dispatch.test.mjs` 与 `test/integration/viewer_chatlog_parity.test.mjs`。落地时按计划**未新增** `GetChatLogForUsername`（仓库无存量实现，跳过过渡态）。第三阶段（human 对称读口 view-log）排在 M3。
>
> 另注两点边界，避免误读本设计：其一，viewer 对称只管"谁看到什么"，**回复生成始终是 char 的活**，world 通过 API 调用喂视图/贡献 prompt，与 char 的生成职责互不侵犯（见 [chat-social-dev-plan.md](../design/chat-social-dev-plan.md) 交互拓扑基线）。其二，`GetChatLogForViewer` 的执行位置取决于 world 的分布形态（[world-distribution-spec.md](../design/world-distribution-spec.md)）：hosted 下由权威主机出所有 viewer 的视图（主机知道全部真相）；local / replicated 下每台机器给自己托管的 viewer 出视图。

## 摘要

当前 `world` 能正式改写 agent 侧 `chat_log`，但 human 侧主读路径并不会经过同一套 world 逻辑。这导致系统语义上默认“人类看原始物化结果，agent 看被世界加工过的视图”，属于对 human 的隐性优待。

如果目标是“world 能对 agent 起作用的操作，也能对 user 起作用，不优待人类”，那么不应该把正式接口定成 `GetChatLogForUsername`，而应该引入**viewer 对称接口**，让 world 面对的是“谁在看”，而不是“是不是人”。

一句话结论：

- `GetChatLogForUsername` 可以作为过渡兼容糖衣
- 正式设计应当是 `GetChatLogForViewer`
- user 读消息的主链路也必须改成走同一个 viewer-log 物化函数，否则只是名字对称，行为仍不对称

## 现状

### 1. world 当前只对 agent 拥有正式 chatlog 钩子

现有 `WorldAPI.chat.GetChatLogForCharname(arg, charname)` 只在角色请求构建时调用，也就是只服务于角色生成路径。

这意味着 world 现在能做到：

- 给不同 agent 喂不同视角的历史
- 对某个 agent 隐藏某些消息
- 给某个 agent 注入额外上下文
- 伪造“它以为自己看到的历史”

但这些能力默认**不会自动作用到 human**。

### 2. user 主读路径绕过了 world chatlog 视图层

当前 Hub 读消息主路径是频道消息查询，直接读取频道层物化数据并返回 `{ messages, reactions }`，不是先构造 `chatLogEntry_t[]` 再让 world 过滤/改写。

结果是：

- agent 看到的是 `world-filtered view`
- user 看到的是 `storage/materialized raw view`

这不是中立设计。

### 3. `userAPI.chat.GetChatLog` 不是好答案

`userAPI.chat.GetChatLog` 现在更像悬空接口，而且就算把它接上，也不是推荐的主方案。

原因：

- chatlog 视图规则如果属于“世界规则”，应该由 `world` 决定
- 把 human 视图挂到 `userAPI`，本质上还是在给 human 单独开侧门
- 这样不是对称，而是把不对称换了个包装

## 设计目标

必须满足：

- human / char / remote member 使用同一套 viewer 抽象
- world 只需要回答“这个 viewer 应该看到什么”
- 不再把 human 当成默认真相观察者
- 本地角色、远端角色、用户本人都走统一分发逻辑
- chatlog 视图变换默认只影响“观察视图”，不直接篡改底层存储真相

明确不做：

- 不在本设计里顺手改存储层真相
- 不把联邦安全校验和 viewer 视图混在一起
- 不为了兼容旧接口而继续扩大 `charname` / `username` 特判

## 方案比较

### 方案 A：新增 `GetChatLogForUsername`

接口草案：

```ts
GetChatLogForUsername?: (arg: chatReplyRequest_t, username: string) => Promise<chatLogEntry_t[]>
```

优点：

- 最小改动
- 很容易在现有 `GetChatLogForCharname` 旁边补一个 human 分支
- 短期可以快速验证“world 也能骗 user”

缺点：

- 继续把 human 作为特殊物种建模
- `username` 是本机账户视角，不是统一成员身份
- 联邦 / 多 owner / 实体哈希语义都不干净
- 未来支持远端 user、匿名 viewer、系统 viewer 时还会继续裂接口

结论：

- **可作过渡兼容，不适合作为正式主设计**

### 方案 B：新增 `GetChatLogForViewer`（推荐）

接口草案：

```ts
export type chatViewer_t = {
    kind: 'user' | 'char'
    memberId: string
    ownerUsername: string
    channelId: string
    charname?: string
    roles?: string[]
    entityHash?: string
}

GetChatLogForViewer?: (
    arg: chatReplyRequest_t,
    viewer: chatViewer_t,
) => Promise<chatLogEntry_t[]>
```

优点：

- 真正对称，不区分 human 特权
- 可直接复用现有 `memberId` / `entityHash` 语义
- 与 `GetGroupPrompt.perMember`、`visibility.members`、RPC member routing 更一致
- 未来扩展最干净

缺点：

- 需要把 user 读路径也接进 viewer pipeline
- 比 `GetChatLogForUsername` 多一点落地工作

结论：

- **这是应该成为正式接口的方案**

### 方案 C：复活 `userAPI.chat.GetChatLog`

优点：

- 表面上看也能让 user 有定制视图

缺点：

- 视图规则从 world 挪到 user，自相矛盾
- 同一个世界下，human/agent 看到什么不再由同一个 part 决定
- 会把“世界规则”和“用户人格规则”搅在一起

结论：

- **不推荐作为主方案**
- 最多保留为 persona 私有附加处理，不应用来替代 world 视图对称性

## 推荐正式设计

### 1. 主接口命名

正式主接口：

```ts
WorldAPI.chat.GetChatLogForViewer?: (
    arg: chatReplyRequest_t,
    viewer: chatViewer_t,
) => Promise<chatLogEntry_t[]>
```

兼容别名，仅作为过渡：

```ts
WorldAPI.chat.GetChatLogForCharname?: (
    arg: chatReplyRequest_t,
    charname: string,
) => Promise<chatLogEntry_t[]>

WorldAPI.chat.GetChatLogForUsername?: (
    arg: chatReplyRequest_t,
    username: string,
) => Promise<chatLogEntry_t[]>
```

原则：

- 新代码只写 `GetChatLogForViewer`
- 老 world 可以继续只实现 `GetChatLogForCharname`
- 如果真想给 human 单开过渡实现，可临时支持 `GetChatLogForUsername`
- shell 内部的主调度一律先看 `GetChatLogForViewer`

### 2. viewer 抽象

建议统一 viewer 字段：

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

字段解释：

- `kind`
  - `user`：human / operator / 以用户身份看
  - `char`：agent / char member / 以角色身份看
- `memberId`
  - 统一主键，不再以 `username` 或 `charname` 当正式身份键
  - human 可复用当前 operator/entity 视角
  - char 可复用当前 agent entity/member 视角
- `ownerUsername`
  - 本地加载 part / locale / persona 时有用
  - 但不是观察者身份本体
- `channelId`
  - 当前 world 已经是频道相关的，视图也应带频道上下文
- `charname`
  - 仅对本地 char viewer 的兼容辅助字段
  - 不是身份本体

### 3. 统一分发函数

shell 内部新增统一 helper，例如：

```ts
async function applyWorldChatLogView(arg, viewer) {
    const worldChat = arg.world?.interfaces?.chat
    if (!worldChat) return arg.chat_log

    if (worldChat.GetChatLogForViewer)
        return await worldChat.GetChatLogForViewer(arg, viewer)

    if (viewer.kind === 'char' && viewer.charname && worldChat.GetChatLogForCharname)
        return await worldChat.GetChatLogForCharname(arg, viewer.charname)

    if (viewer.kind === 'user' && worldChat.GetChatLogForUsername)
        return await worldChat.GetChatLogForUsername(arg, viewer.ownerUsername)

    return arg.chat_log
}
```

注意：

- `GetChatLogForUsername` 这里只是兼容 fallback
- 不能成为第一优先级
- 真正的标准入口始终是 `GetChatLogForViewer`

## 调用点应该怎么接

### 1. agent 路径

当前 `getChatRequest(groupId, charname, channelId, options)` 在构造完 `chatReplyRequest.chat_log` 后，会直接按 `charname` 调 world。

应改为：

- 先构造 `viewer = { kind: 'char', ... }`
- 再统一调用 `applyWorldChatLogView(arg, viewer)`

也就是把“按 charname 特判”收敛成“按 viewer 分发”。

### 2. user 路径

如果要真的做到“不优待人类”，user 看历史也必须走同一个 helper。

不能继续让 Hub 主显示路径永远只看原始频道消息 DTO。

推荐新增统一函数，例如：

```ts
async function materializeViewerChatLog(groupId, channelId, viewer, options = {}) {
    // 1. 读底层消息
    // 2. hydrate 成 chatLogEntry_t[]
    // 3. 附 sidecar / timeline / locale
    // 4. 调 applyWorldChatLogView(arg, viewer)
    // 5. 返回 viewer-specific chatlog
}
```

然后 user 侧显示：

- 直接消费 `viewer chatlog`
- 或再把它投影成 UI 需要的 DTO

### 3. 一个关键事实

**单有 `GetChatLogForViewer` 还不够。**

如果 `/channels/:channelId/messages` 继续直接返回原始频道消息 DTO，而 Hub 又继续直接吃这个 DTO，那么 human 依然绕过 world。

所以二选一：

#### 路线 1：新增 world-aware viewer-log endpoint

例如：

- `GET /api/parts/shells:chat/groups/:groupId/channels/:channelId/view-log`

由它返回 world 处理后的 viewer chatlog。

优点：

- 最清晰
- 不污染 raw message endpoint
- raw endpoint 还能留给调试/治理/管理工具

缺点：

- 前端要切读口

#### 路线 2：让现有 Hub 主视图改吃 viewer chatlog 物化层

优点：

- 语义更统一

缺点：

- 改动可能更大
- 要处理 reactions / pins / branch display 等现有 DTO 差异

我的建议：

- **保留 raw channel API**
- **新增 world-aware viewer-log API**
- 让“受 world 支配的聊天体验”走 viewer-log
- 让治理 / 调试 / 审计继续走 raw API

这样边界最清楚。

## 和现有 `userAPI.chat.GetChatLog` 的关系

建议：

- 不把它当主入口
- 最多允许它在 user persona 层对 `arg.chat_log` 做二次加工
- 但 world 对称视图必须优先于 user persona 自定义

优先级建议：

1. shell 先构造 base log
2. world `GetChatLogForViewer`
3. 如有必要，再让 persona/user 做 viewer-specific tweak
4. 最终交给 UI 或 prompt

如果要保持系统干净，甚至可以评估删掉 `userAPI.chat.GetChatLog`，避免未来出现“human 视图由 user 决定，agent 视图由 world 决定”的双中心设计。

## 为什么正式接口不该叫 `GetChatLogForUsername`

因为这名字天然把 human 当中心。

而现有系统里更通用、更对称的键其实已经存在：

- `extension.memberId`
- entity hash
- char member routing
- `GetGroupPrompt.perMember`
- `visibility.members`

既然架构已经在往 `member/viewer` 收敛，就不应该在新接口上重新倒退回 `username` 特权。

所以我的判断是：

- `GetChatLogForUsername` 这个名字可以存在
- 但只能作为**兼容 fallback**
- 不能作为正式一等接口

## 落地顺序

### 第一阶段：先把模型摆正

- 加 `chatViewer_t`
- 加 `WorldAPI.chat.GetChatLogForViewer`
- 写 `applyWorldChatLogView()`

### 第二阶段：先统一 agent 路径

- `getChatRequest()` 改走统一 helper
- 保持老 world 的 `GetChatLogForCharname` 继续可工作

### 第三阶段：补 user 对称路径

- 新增 `materializeViewerChatLog()`
- 新增 world-aware `viewer-log` API
- 让 Hub 中需要 obey world 视图的页面切到新 API

### 第四阶段：清理旧特判

- 新 world 只推荐实现 `GetChatLogForViewer`
- `GetChatLogForCharname` / `GetChatLogForUsername` 标记为 legacy sugar
- 评估 `userAPI.chat.GetChatLog` 是否继续保留

## 最终结论

如果目标是“不优待人类”，那正确方向不是：

- 给 human 额外补一个 `GetChatLogForUsername`

而是：

- 把“谁在看”抽象成统一的 `viewer/member`
- 让 world 基于 viewer 决定视图
- 让 agent 和 user 都走同一条 world-aware log pipeline

正式接口建议定成：

```ts
GetChatLogForViewer(arg, viewer)
```

而不是：

```ts
GetChatLogForUsername(arg, username)
```

后者可以有，但只能是过渡兼容层，不能是最终架构中心。
