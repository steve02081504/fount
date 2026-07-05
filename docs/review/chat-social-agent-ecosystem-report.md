# fount Chat / Social Agent 生态对比调研报告

生成时间：`2026-07-04`

## 摘要

这次调研的核心结论有三条：

1. 旧 `chat``C:\Users\steve02081504\Downloads\chat` 不是“简单薄壳”，而是一个 **parts 共治的聊天宿主**。它把 `char / world / persona / plugin` 放在同一层协作，`prompt_struct` 和 `chatReplyRequest` 是这套设计的核心。
2. 新版 `chat``src/public/parts/shells/chat/` 真正升级的是 **联邦化、可治理、可托管的会话宿主能力**，不是统一的 agent runtime。它把 `group / channel / member / session DAG / federation / remote proxy` 做大了，但 prompt/provider/tool loop 仍大量留在 `char.interfaces.chat.GetReply()` 背后。
3. `social``src/public/parts/shells/social/` 更像 **agent 的公开身份层、分发层、发现层、通知层**，不是主 runtime。它适合做 agent 的“前台和广场”，不适合直接取代 `chat` 作为“后台和发动机”。

一句话概括：

**旧 `chat` 强在 parts 共治的运行时心智；新版 `chat` 强在联邦宿主底盘；`social` 强在社交联邦外壳。**

## 调研范围与方法

这份报告严格区分了三个调研对象：

- 旧 `chat`：只指 `C:\Users\steve02081504\Downloads\chat`
- 新版 `chat`：指仓库内 `src/public/parts/shells/chat/`
- `social`：指仓库内 `src/public/parts/shells/social/`

本次调研有一个明确纠偏：

- **不把当前仓库中的 `easychar`、其他 shell、声明文件直接当成旧 `chat` 证据**
- 它们最多只能作为“演化线索”或“旁证”
- 旧 `chat` 的判断以 `Downloads/chat` 的实际代码为准

## 证据基础

### 旧 `chat` 已核验文件

- `C:\Users\steve02081504\Downloads\chat\main.mjs`
- `C:\Users\steve02081504\Downloads\chat\src\actions.mjs`
- `C:\Users\steve02081504\Downloads\chat\src\endpoints.mjs`
- `C:\Users\steve02081504\Downloads\chat\src\chat.mjs`
- `C:\Users\steve02081504\Downloads\chat\src\prompt_struct.mjs`
- `C:\Users\steve02081504\Downloads\chat\decl\chatLog.ts`
- `C:\Users\steve02081504\Downloads\chat\fount.json`
- `C:\Users\steve02081504\Downloads\chat\public\llms.txt`
- `C:\Users\steve02081504\Downloads\chat\home_registry.json`

### 新版 `chat` 已核验文件

- `src/public/parts/shells/chat/main.mjs`
- `src/public/parts/shells/chat/fount.json`
- `src/public/parts/shells/chat/public/llms.txt`
- `src/public/parts/shells/chat/src/chat/session/triggerReply.mjs`
- `src/public/parts/shells/chat/src/chat/session/chatRequest.mjs`
- `src/public/parts/shells/chat/src/chat/session/dagSession.mjs`
- `src/public/parts/shells/chat/src/chat/session/runtime.mjs`
- `src/public/parts/shells/chat/src/chat/session/resolvePart.mjs`
- `src/public/parts/shells/chat/src/chat/session/partConfig.mjs`
- `src/public/parts/shells/chat/src/chat/session/sessionSnapshot.mjs`
- `src/public/parts/shells/chat/src/chat/session/models.mjs`
- `src/public/parts/shells/chat/src/chat/session/timeSliceParts.mjs`
- `src/public/parts/shells/chat/src/chat/federation/remoteWorldProxy.mjs`
- `src/public/parts/shells/chat/src/chat/dag/hydration.mjs`
- `src/public/parts/shells/chat/src/chat/dag/reducers/sessions.mjs`
- `src/public/parts/shells/chat/src/chat/rpcDispatcher.mjs`
- `src/public/parts/shells/chat/src/prompt_struct/index.mjs`
- `src/public/parts/shells/easynew/parts/easychar/template/main.mjs`（仅作延续线索）
- `src/decl/charAPI.ts`
- `src/decl/worldAPI.ts`
- `src/decl/pluginAPI.ts`
- `src/decl/AIsource.ts`
- `src/decl/chatLog.ts`

### `social` 已核验文件

- `src/public/parts/shells/social/main.mjs`
- `src/public/parts/shells/social/fount.json`
- `src/decl/socialAPI.ts`
- `src/public/parts/shells/social/src/dispatch.mjs`
- `src/public/parts/shells/social/src/lib/charSocial.mjs`
- `src/public/parts/shells/social/src/lib/resolveActingEntity.mjs`
- `src/public/parts/shells/social/src/lib/bootstrap.mjs`
- `src/public/parts/shells/social/src/timeline/append.mjs`
- `src/public/parts/shells/social/src/timeline/materialize.mjs`
- `src/public/parts/shells/social/src/timeline/sync.mjs`
- `src/public/parts/shells/social/src/discovery.mjs`
- `src/public/parts/shells/social/src/notifications.mjs`
- `src/public/parts/shells/social/src/endpoints/posts_routes.mjs`
- `src/public/parts/shells/social/src/endpoints/relationships_routes.mjs`
- `src/public/parts/shells/social/test/integration/timeline_ingress.test.mjs`
- `src/public/parts/shells/social/test/integration/federation_rpc.test.mjs`
- `src/public/parts/shells/social/test/integration/notifications_dispatch.test.mjs`

## 一、三者的最简定位

| 对象 | 最准确的定位 | 强项 | 弱项 |
| --- | --- | --- | --- |
| 旧 `chat` | parts 共治的聊天宿主 | `char/world/persona/plugin` 同层协作，运行时心智统一 | 联邦、多节点托管、平台化能力弱 |
| 新版 `chat` | 联邦化会话宿主 | `group/channel/member/session DAG/federation/remote proxy` 完整 | runtime 归属分裂，parts 不对称 |
| `social` | 社交联邦外壳 | 身份、时间线、发现、关注、通知、公开互动 | 不具备完整 chat/runtime 编排能力 |

## 二、旧 `chat` 的真实形态

旧 `chat` 最容易被误解成“薄壳”。这只说对了一半。

更准确地说：

- 它在 **prompt 语义和扩展权力** 上更放给 `char / world / persona / plugin`
- 但在 **会话状态、时间线、流式生成、自动接话、分支持久化** 上，宿主并不薄

它的核心不是“一个页面调一下 LLM”，而是：

- 有自己的会话对象和时间片
- 有 `chatReplyRequest`
- 有 `prompt_struct`
- 有 `LastTimeSlice`
- 有 `chatLog + timelines`
- 有插件后处理和追加日志能力

旧 `chat` 最宝贵的设计，是把这些 parts 放在了同一层：

- `world` 贡献 prompt、调整上下文、裁剪日志
- `persona/user` 贡献用户视角
- `char` 负责最终回复
- `plugin` 参与 prompt 与回复后处理

`prompt_struct` 是这套设计的关键中间层。它不是单纯的“拼字符串”，而是多 part 共写上下文的统一落点。

因此，旧 `chat` 的本质更接近：

**一个 parts 主导的聊天运行时，而不是一个统一宿主掌控一切的 agent OS。**

## 三、新版 `chat` 真正升级了什么

新版 `chat` 真正升级的不是“模型层”，而是“宿主底盘”。

它把下面这些能力做成了一整层平台能力：

- `group / channel / member`
- `session DAG`
- session materialization
- session snapshot
- remote char / world proxy
- group RPC
- mailbox consumer
- manifest ACL / transfer
- chunk provider
- federation room provider
- default agent hosting

如果目标是：

- 多节点
- 联邦
- agent 托管
- 群治理
- 远端角色参与会话

那新版 `chat` 显然比旧 `chat` 高了不止一档。

它真正做成的是：

**从“本地聊天壳”升级为“联邦化会话宿主”。**

## 四、新版 `chat` 没有同步做成什么

新版 `chat` 的最大问题不是功能少，而是 **升级方向不均衡**。

宿主层做大了，但 agent runtime 没有同步收口到宿主。

目前从代码看，真正的主链更像这样：

1. shell 负责 session、stream、DAG、RPC、federation
2. shell 构造 `chatReplyRequest`
3. shell 最终仍然调用 `char.interfaces.chat.GetReply(request)`
4. prompt 组装、`AIsource.StructCall`、plugin tool loop 仍大量留在 `char` 侧

这带来几个直接后果：

- 宿主无法统一治理 provider 选择
- 宿主无法统一治理 tool contract
- 宿主无法统一治理重试、审计、权限与可观测性
- parts 扩展点看似统一，实际执行链仍旧分散

所以，新版 `chat` 不是“已经有统一 agent runtime”，而是：

**宿主已经现代化，runtime 还停留在旧范式。**

## 五、旧 `chat` vs 新版 `chat`

### 1. agent 生态

旧 `chat` 的优势：

- `char / world / persona / plugin` 协作关系更对称
- prompt 和回复的心智模型更统一
- 本地组装 parts 的手感更自然

新版 `chat` 的优势：

- agent 成了群里的正式成员，不再只是某个对话里的 bot
- 支持远端 char/world 参与
- session、治理、联邦、托管能力更强

新版 `chat` 的代价：

- `plugin` 仍偏本机
- `persona` 跨节点靠特判透传
- `char/world/persona/plugin` 不再同层对称
- 运行时分层比旧版复杂得多

### 2. fount 组件生态

旧 `chat` 的优势：

- 更像“直接装 parts 进会话”
- 本地 `char/world/persona/plugin` 接入手感好

新版 `chat` 的优势：

- `fount.json`、registries、P2P、session provider、entity resolver 等显式整合更完整
- 真正融入了整个 `fount` 的平台基础设施

新版 `chat` 的代价：

- 原本顺手的会话操作变成协议化流水线
- `append DAG event -> materialize session -> rebuild runtime -> broadcast`
- 开发手感不如旧版直接

### 3. 聊天模型抽象

旧 `chat`：

- 宿主不强管 provider
- `char` 自己决定怎么组 prompt、调模型、跑插件
- 模型 runtime 分散，但心智简单

新版 `chat`：

- `transport / session / federation` 明显更强
- `prompt / provider / tool / memory` 没有同步统一
- runtime 仍然分散在 `char` 实现里

准确说，新版在聊天模型抽象上不是单向升级，而是：

**底盘升级，模型 runtime 未完成收口。**

## 六、新版 `chat` 的问题分级

### 架构级问题

1. **runtime 归属分裂**  
   shell 管 session/RPC/stream/DAG，`char` 还在管 prompt/provider/tool loop。

2. **上下文真相分裂**  
   DAG、sidecar、runtime cache、persisted prelude 都在承担一部分上下文权威。

3. **agent 语义和群治理语义耦合**  
   agent 的存在和 member 生命周期绑得太紧。

4. **parts 联邦能力不对称**  
   `char/world`、`plugin`、`persona` 的跨节点能力层次不一致。

5. **单一会话心智被打散**  
   旧版接近 `LastTimeSlice + chatLog + timelines`；新版是多层状态共同构成会话。

### 接线级问题

1. **`member_roles` 没真正接进 request/prompt 视角**  
   类型和可见性逻辑里有角色语义，但实际 request 里还是空数组。

2. **远端 world prompt 相关接口没接全**  
   `WorldAPI` 里有的 prompt 相关接口，`remoteWorldProxy` 里并没有完整实现。

3. **`public/llms.txt` 与实现模型已经漂移**  
   文档叙述和实际 reducer / session 事件模型不完全一致。

## 七、如果只能从旧 `chat` 迁回 3 个优点

1. **恢复 parts 的对称协作地位**  
   `char / world / persona / plugin` 应重新更接近同层一等公民，而不是能力边界参差不齐。

2. **把 runtime 主链收回宿主**  
   `buildPromptStruct -> AIsource.StructCall -> ReplyHandler/GetReplyPreviewUpdater` 这条链，不应长期躲在 `char` 模板里。

3. **恢复更清晰的会话心智模型**  
   新版可以保留 DAG / federation / snapshot，但最好把“哪一层是真正的会话真相”收得更明确。

## 八、`social` 的真实定位

`social` 最容易被误判成“另一套 agent 平台”。实际不是。

它真正擅长的是：

- entity 身份
- 签名时间线
- 可见性
- 关注关系
- 发现
- 提及
- 通知
- 联邦分发

也就是说，它是：

**agent 的公开身份层、触达层、分发层、发现层。**

但它没有这些东西：

- chat log/session
- `prompt_struct`
- `world/persona/plugin` 会话装配
- provider/serviceSource 主链
- 统一的推理 runtime

当前 `social` 对 agent 暴露的，主要还是 `interfaces.social` 的几个事件入口，而不是完整执行内核。

因此，`social` 的强不是“更会思考”，而是“更会出场、传播、被发现、被触达”。

## 九、`social` vs `chat`

### `social` 强于 `chat` 的地方

- 更自然的公开身份模型
- 更自然的 follow / mention / discover / notification 机制
- 更像人和 agent 共用的社交联邦层
- 更适合承载 agent 的公开外部形象和活动流

### `social` 弱于 `chat` 的地方

- 没有完整的会话与 runtime 编排
- 没有 `world/persona/plugin` 的 rich binding
- 没有 prompt/provider/tool loop 中心
- 不能自然承担复杂多轮协作与长上下文认知任务

### 一个很关键的现实边界

当前测试已经明确表明：

- `social` 还不是真正完整接纳“远端非本机托管 agent timeline”的体系

这说明它连“远端 agent 的社交宿主”都还没完全打通，更不该被误说成“主 runtime”。

## 十、推荐的双层架构边界

如果未来继续发展，我认为最自然的切法是：

- `social` 负责 **who the agent is**
- `chat` 负责 **how the agent thinks and works**

具体地：

### `social` 负责

- 公开身份
- profile
- 时间线
- 关注关系
- mention / repost / quote / like
- discover
- notifications
- 联邦分发和公开触达

### `chat` 负责

- session
- prompt 组装
- `world/persona/plugin`
- provider / serviceSources
- tool loop
- 长上下文
- 多 agent 协作
- 私密任务和流式执行

### 桥接原则

- `social -> chat` 只传结构化 ingress
- `chat -> social` 只产出结构化发帖/回复草稿
- 不要把 `persona/world/plugin/provider` 直接塞回 `social` 的主语义层

否则结果大概率不是“social 更强”，而是“在 social 里重写一个更散的 chat”。

## 十一、这类分析最容易犯的误判

1. 把旧 `chat` 粗暴叫成“薄宿主”  
   它只是 prompt 权力更下放，不代表会话与流式层很薄。

2. 看到新版 `chat` 有 DAG / federation / hosting，就误判成“已经有统一 agent runtime”  
   代码并不支持这个结论。

3. 把当前仓库里的 `easychar` 或其他 shell 直接当成旧 `chat` 证据  
   它们最多只是演化线索。

4. 把 `social` 里“agent 有 entity、能发帖、能被 @”误判成“social 已经是主 agent 平台”  
   它现在更像社交入口，不是认知内核。

5. 只看声明和文档，不看实现  
   本次调研里，`chat` 和 `social` 都已经出现了声明/实现漂移。

## 十二、最终判断

如果只看“agent 生态友善性”，三者分别代表了三种不同的友善：

- 旧 `chat`：对 **parts 共治和低门槛扩展** 友善
- 新版 `chat`：对 **联邦化托管、会话治理、远端角色参与** 友善
- `social`：对 **公开身份、分发、发现、触达、通知** 友善

但如果只问一个问题：

**“谁适合做主 agent runtime？”**

目前答案仍然是：

- 不是旧 `chat`
- 更不是 `social`
- 只能是新版 `chat`

前提是：**新版 `chat` 必须把现在仍分散在 `char` 里的 runtime 主链真正收回来。**

否则它会长期停在一个尴尬状态：

**底盘很大，宿主很强，但灵魂仍散落在各个 char 里。**
