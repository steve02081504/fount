# World 分布形态规范

更新：`2026-07-12` · **已落地**（M7 声明与分发、M8 状态通道）

> 类型与 API 以 `src/decl/worldAPI.ts` 为准；运行时行为以 `src/public/parts/shells/chat/src/chat/session/AGENTS.md` 为准。本文只保留**设计动机、形态语义与验收要领**，不维护实施状态。

## 动机

world 在 chat 里原先隐含 **单一主机托管**：`homeNodeHash` 不在本机则一律 RPC，主机离线时 world 钩子全部 `REMOTE_UNAVAILABLE`——即使该 world 的工作与主机毫无关系。

但很多 world 根本不需要单一主机。以默认 fount world 为例，它本质上只做两件事：

1. 总结上文（`GetChatLogForViewer` 里裁剪 + AI 摘要）
2. 给 fount 角色提供有关 chat 前端渲染能力的知识（`GetPrompt`）

这两件事都是**本机视角的**：每台机器给自己托管的角色做总结、注入渲染知识即可，完全允许不同机子运行不同内容、产出不同摘要。

另一个极端是狼人杀 / 跑团 DM 世界：有隐藏真相（暗牌、狼人身份、DM 的剧本），必须单一权威——这正是 `hosted` 该服务的场景。

中间还有一类：规则型 RPG——大伙本地运行的内容差不多一致就行，角色的背包数据本地处理，世界的公共状态（天气、地图开放度、任务进度）通过 DAG 共享。

因此把「world 运行在哪、状态放在哪」从隐含假设升级为**显式的分布形态声明**。

## 三种分布形态

| distribution | 运行位置 | 共享状态 | 隐藏真相 | 典型 |
| --- | --- | --- | --- | --- |
| `local` | 每个 replica 本机 | 无（各自为政） | 无 | 默认 fount world |
| `replicated` | 每个 replica 本机 | DAG `world_state` 事件 | 无（共享状态全员可见） | 规则型 RPG |
| `hosted` | `homeNodeHash` 单机 | 主机私有，按需播报 | 有（主机独占） | 狼人杀 / 跑团 DM |

三形态共用同一套 `WorldAPI.interfaces.chat.*` 钩子，差别只在**钩子在哪台机器上执行、共享状态经过哪条通道**。

### local：纯本机视图世界

- 每个 replica 用自己安装的同名 world part，在本机执行全部钩子；不发 RPC，不写共享状态。
- 不同节点甚至允许装**不同实现**的同名 world——效果只影响本机 viewer / prompt，无一致性要求。
- 未安装该 world 的节点：回退 chat 内置的**极小 world**（`BUILTIN_WORLD`，钩子全透传），chat 正常运转。
- 默认 fount world（`distribution: 'local'`）：每台机器自己跑摘要、自己注入渲染知识 prompt；主机离线不再影响任何人。

### replicated：p2p 副本共识世界

- 每个 replica 本机执行钩子（同 local），但公共世界状态通过 DAG `world_state` 事件共享，全群收敛到同一份状态。
- **职责切分**：
  - 共享状态（任务进度、世界事件、公共资源）→ `host.state`（DAG 权威，见 WorldChatHost）。
  - 私有数据（某角色的背包、某玩家的本地缓存）→ `host.localData`（world 自己的数据目录，不进 DAG）。
- **确定性要求**：从 `world_state` 序列折叠出状态的逻辑必须确定（同一 op 序列 → 同一状态）。不确定的计算（AI 调用、随机数、时钟）不允许放在折叠路径里；正确做法是**由发起者算完、把结果作为 op 签名落 DAG**，其他节点信任该 op 或自行重算校验。
- **权限语义在 world 折叠层裁决**：DAG/网络层只做签名校验、格式规整、payload 尺寸清扫（对非本机入站的必要清扫）。「这个成员有没有资格发这条 op」是世界规则，由 world 在折叠时决定接受还是忽略，shell 不代管。
- **副作用幂等**：`AfterAddChatLogEntry` 等落盘后钩子在每个 replica 各自触发一次；replicated world 的副作用要么是本机幂等的（刷新本机缓存），要么经 `world_state` 写共享状态（同 key LWW 天然收敛）。
- 未安装该 world 的节点：回退 RPC 到 bind 里的 `homeNodeHash`（首绑者充当种子主机），行为退化为 hosted——replicated 是 hosted 的严格超集。

### hosted：单一权威主机

- world 只在 `homeNodeHash` 上运行，其他节点经 `remoteWorldProxy` RPC 调用。
- 适合有隐藏真相的世界：暗牌、身份、DM 剧本只存在于主机内存/磁盘，其他节点只能看到主机通过钩子返回的视图——`GetChatLogForViewer` 按 viewer 撒谎能力的权威来源。
- 主机离线 = 世界暂停，这是该形态的本质属性而非缺陷。
- hosted world 同样可以用 `host.state` 把想公开的状态写进 DAG（比如公开的比分板），让离线节点也能读到最后已知状态。

## 声明与绑定

### world 侧声明

`WorldAPI_t.distribution?: 'local' | 'replicated' | 'hosted'`——由 world part 自行声明；缺省 `hosted` 保证存量 world 行为不变。

### bind 事件

`session_world_bind` / `session_world_bind_channel` 的 content 携带 `distribution`（绑定者从本地加载的 world part 读出后写入）：

| distribution | homeNodeHash |
| --- | --- |
| `hosted` | 必填 |
| `replicated` | 必填（语义：种子主机 / 未安装者的回退 RPC 目标） |
| `local` | 可缺省；有也只作「推荐安装来源」提示 |

校验（`sessionEventValidate.mjs`）按 distribution 分支；缺省视为 `hosted`，存量事件无需迁移。

### resolveWorld 分发

```text
无 bind          → BUILTIN_WORLD（distribution 天然 local）
bind.distribution:
  'local'      → 本机装了同名 world ? loadPart : BUILTIN_WORLD
  'replicated' → 本机装了同名 world ? loadPart : createRemoteWorldProxy(homeNodeHash)
  'hosted'     → isLocalNode(homeNodeHash) ? loadPart : createRemoteWorldProxy(homeNodeHash)
```

`resolveWorld` **永不返回 null**：未绑定与 local 未安装都由 `BUILTIN_WORLD` 兜底。极小 world 是 shell 内部对象，不是磁盘 part，不参与安装/卸载，不进 bind 事件。

## WorldChatHost：world 对 chat 存储 / p2p 层的正式调用面

交互拓扑基线里，world 的两条通道是：

1. world → persona / char：已存在（`GetCharReply`、`GetSpeakingOrder`、`GetChatLogForViewer`、`GetPrompt`/`GetGroupPrompt` 等）。
2. world → chat 存储 / p2p 层：经 `WorldChatHost` 主动读写共享状态、触发回复、投递系统消息。

`WorldChatHost_t` 提供：

- **`state`**：DAG `world_state` 事件的 LWW KV（`get`/`set`/`del`/`entries`/`log`）。
- **`localData`**：本机私有 JSON（`worlds/{worldname}/chat_data/{groupId}.json`），不进 DAG。
- **`triggerCharReply`** / **`postSystemMessage`**：走统一写路径，不开旁门。
- **`listMembers`** / **`listChannels`**：只读群摘要。

交付：`WorldAPI.chat.ChatHostConnected(host)` 在 `resolveWorld` 本机加载 part 时惰性接线一次；`BUILTIN_WORLD` 与 `remoteWorldProxy` 不接线。

要点：

- `state.set/del` 落的是**当前 replica 成员签名**的 `world_state` 事件——replicated 下每台机器以自己的成员身份写，hosted 下只有主机在写。
- shell 级 LWW reducer（`dag/reducers/worldState.mjs`）保持世界无关；**越权 op 的忽略**是 world 自定义折叠层（`state.log()`）的责任，不是 shell reducer 的责任。
- 不做能力洁癖：host 对象经 `chatReplyRequest` 间接可达也无妨；我们只保证「正门存在且好走」。

## `world_state` 事件

DAG 事件 `world_state`，content：`{ worldname, action: 'set'|'delete', key, value? }`。

- **通用 reducer**：物化到 `state.worldStates[worldname]`，`set/del` 按 HLC 全序做 LWW；reducer 不解释 value 语义。
- **状态为群级**：shell 不做频道级隔离；需要频道作用域的 world 用键约定（如 `chan/{channelId}/...`）。
- **原始 log 保留**：需要非 LWW 语义（计数器、集合合并、回合制指令流）的 world 用 `state.log()` 自己折叠。
- **网络层清扫**：远端入站沿用签名 / 成员校验 / HLC skew 管线，额外 64KB content 上限（`remoteIngest.mjs`）；本机写不受限。语义有效性不在网络层裁决。
- 非消息类事件，`broadcastAndPersist` 仅重建 checkpoint，不进 `messages.jsonl`。

## 与现有钩子的关系

| 钩子 | local / replicated | hosted |
| --- | --- | --- |
| `GetPrompt` / `GetGroupPrompt` / `TweakPrompt` | 本机实例执行 | RPC 到主机（**TweakPrompt 就地 mutation 经 JSON 边界丢失**；不做钩子代理修补） |
| `GetChatPlugins` | 本机返回活对象，merge 进本机 char 的 `plugins`（本机同名优先） | **仅主机侧**真 part 生效；远端代理不挂此钩子（活对象不可 RPC） |
| `GetChatLogForViewer` | 本机执行；每台机器给自己托管的 viewer 出视图 | RPC 到主机（主机知道全部真相） |
| `AddChatLogEntry` / `AfterAddChatLogEntry` | 每 replica 本机各触发一次，副作用需本机幂等 | 各 replica 转发主机 |
| `GetSpeakingOrder` | 仅在**回复触发发起机**上生效；需要全群强一致轮转应选 hosted | 主机权威裁决 |
| `GetGreeting` / `GetGroupGreeting` | 本机执行 | RPC 到主机 |
| `MessageEdit` / `MessageDelete` | 本机执行 | RPC 到主机 |

### `GetChatPlugins`

world 可向**当前频道**所有本机生成的 char 注入插件活对象（形状同 `PluginAPI_t`，先例：`codeContextPlugin`）。

- `resolveWorld` 按频道解析 → 「当前频道生效」天然成立。
- shell 在 `getChatRequest` 中：`{ ...worldPlugins, ...localPlugins }`，**本机插件同名覆盖 world**。
- **local / replicated**：各节点装了该 world 则本地生效；未安装则无 world 插件。
- **hosted**：仅主机进程内 `resolveWorld` 拿到真 part 时生效（guest 侧 remote proxy 不暴露此钩子）。
- 不做 `GetChatPlugins` RPC：返回值是活对象，依赖原地钩子，不可序列化。

判别口诀：**世界需不需要对不同 viewer 隐藏真相？需要 → hosted；不需要但要全群共享进度 → replicated；连共享都不需要 → local。**

## 示例映射

### 默认 fount world → `local`

- `distribution: 'local'`；摘要与渲染知识本来就是本机语义。
- 收益：主机离线不再拖垮任何群；每台机器的摘要 AI 源用自己的配置。

### 规则型 RPG world → `replicated`

- 公共状态：`host.state.set('weather', ...)`、`host.state.set('quest/main/stage', 3)`。
- 背包：`host.localData.set('inventory/alice', [...])`——本地处理，不广播。
- 掷骰：发起机掷完把结果连同种子作为 op 落 DAG，他人信任或验证。
- 玩家越权 op：world 折叠时按成员身份忽略，网络层不管。

### 狼人杀 DM world → `hosted`

- 暗牌 / 身份表只在主机 `localData`；`GetChatLogForViewer` 按 viewer 裁剪夜晚频道消息。
- 公开状态（存活名单、白天计票）可选写 `host.state` 供离线节点读最后已知值。
- DM（主机）离线 = 游戏暂停，符合预期。

## 实现索引

| 主题 | 路径 |
| --- | --- |
| 类型声明 | `src/decl/worldAPI.ts` |
| 内置极小 world | `src/public/parts/shells/chat/src/chat/session/builtinParts.mjs` |
| resolveWorld 三分支 | `src/public/parts/shells/chat/src/chat/session/resolvePart.mjs` |
| GetChatPlugins merge | `src/public/parts/shells/chat/src/chat/session/chatRequest.mjs` |
| 本机插件名单 | `src/public/parts/shells/chat/src/chat/session/localPlugins.mjs` |
| bind 校验 | `src/public/parts/shells/chat/src/chat/dag/sessionEventValidate.mjs` |
| WorldChatHost | `src/public/parts/shells/chat/src/chat/session/worldHost.mjs` |
| world_state reducer | `src/public/parts/shells/chat/src/chat/dag/reducers/worldState.mjs` |
| 入站清扫 | `src/public/parts/shells/chat/src/chat/dag/remoteIngest.mjs` |
| 默认 fount world | `default/templates/user/worlds/fount/main.mjs` |
| replicated fixture | `src/public/parts/shells/chat/test/fixtures/worlds/replicated_world/` |

测试：`test/pure/world_distribution_validate.test.mjs`、`test/integration/world_distribution.test.mjs`、`test/integration/world_state.test.mjs`、`test/integration/world_chat_host.test.mjs`（均在 chat shell `test/manifest.json`）。

## 验收要领

- **local**：主机离线后其他成员的 chat 功能（含 agent 回复）不受影响；各机 world 钩子本机生效；未安装节点回退 `BUILTIN_WORLD`。
- **replicated**：双 replica 写 `state.set` 后 `state.get` 收敛；越权 op 在 world 折叠层被忽略且不炸群。
- **hosted**：缺省 distribution 的存量 bind 走原 RPC 路径，行为与迁移前一致。
- **入站清扫**：联邦 `world_state` 超限 payload 拒收；本机写不受 64KB 限制。
