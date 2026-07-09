# World 分布形态规范：去中心化 WorldAPI 设计

生成时间：`2026-07-08`

## 动机

当前 world 在 chat 里只有一种存在方式：**单一主机托管**。

- `session_world_bind` / `session_world_bind_channel` 事件强制要求 `homeNodeHash`（`src/chat/dag/sessionEventValidate.mjs`）。
- `resolveWorld()` 判断 `homeNodeHash` 是否本机：是则 `loadPart`，否则一律 `createRemoteWorldProxy` 走群 RPC（`src/chat/session/resolvePart.mjs`）。
- 后果：**world 主机不在线，整个 chat 的 world 钩子全部 `REMOTE_UNAVAILABLE`**——即使这个 world 干的活和主机毫无关系。

但很多 world 根本不需要单一主机。以默认 fount world（`default/templates/user/worlds/fount/main.mjs`）为例，它本质上只做两件事：

1. 总结上文（`GetChatLogForCharname` 里裁剪 + AI 摘要）
2. 给 fount 角色提供有关 chat 前端渲染能力的知识（`GetPrompt`）

这两件事都是**本机视角的**：每台机器给自己托管的角色做总结、注入渲染知识即可，完全允许不同机子运行不同内容、产出不同摘要。把它绑死在一台主机上，只是让所有节点白白依赖一个单点。

另一个极端是狼人杀 / 跑团 DM 世界：有隐藏真相（暗牌、狼人身份、DM 的剧本），必须单一权威。这正是现状 hosted 模式该服务的场景。

中间还有一类：规则型 RPG——大伙本地运行的内容差不多一致就行，角色的背包数据本地处理，世界的公共状态（天气、地图开放度、任务进度）通过 DAG 共享。

因此需要把"world 运行在哪、状态放在哪"从隐含假设升级为**显式的分布形态声明**。

## 三种分布形态

| distribution | 运行位置 | 共享状态 | 隐藏真相 | 典型 |
| --- | --- | --- | --- | --- |
| `local` | 每个 replica 本机 | 无（各自为政） | 无 | 默认 fount world |
| `replicated` | 每个 replica 本机 | DAG `world_state` 事件 | 无（共享状态全员可见） | 规则型 RPG |
| `hosted` | `homeNodeHash` 单机 | 主机私有，按需播报 | 有（主机独占） | 狼人杀 / 跑团 DM（现状语义） |

三形态共用同一套 `WorldAPI.interfaces.chat.*` 钩子，差别只在**钩子在哪台机器上执行、共享状态经过哪条通道**。

### local：纯本机视图世界

- 每个 replica 用自己安装的同名 world part，在本机执行全部钩子；不发 RPC，不写共享状态。
- 不同节点甚至允许装**不同实现**的同名 world——效果只影响本机 viewer / prompt，无一致性要求。
- 未安装该 world 的节点：回退 chat 内置的**极小 world**（钩子全透传的 null-object，见 dev plan D6），chat 正常运转。这是"去单点"的直接收益。
- 默认 fount world 切到此形态后：每台机器自己跑摘要（结果照旧写 `chat_log[].extension.summary`，随 sidecar 本地留存）、自己注入渲染知识 prompt。主机离线不再影响任何人。

### replicated：p2p 副本共识世界

- 每个 replica 本机执行钩子（同 local），但公共世界状态通过 DAG `world_state` 事件共享，全群收敛到同一份状态。
- **职责切分**：
  - 共享状态（任务进度、世界事件、公共资源）→ `host.state`（DAG 权威，见下文 WorldChatHost）。
  - 私有数据（某角色的背包、某玩家的本地缓存）→ `host.localData`（world 自己的数据目录，不进 DAG）。
- **确定性要求**：从 `world_state` 序列折叠出状态的逻辑必须确定（同一 op 序列 → 同一状态）。不确定的计算（AI 调用、随机数、时钟）不允许放在折叠路径里；正确做法是**由发起者算完、把结果作为 op 签名落 DAG**，其他节点信任该 op 或自行重算校验。
- **权限语义在 world 折叠层裁决**：DAG/网络层只做它已经在做的事——签名校验、格式规整、payload 尺寸清扫（对非本机入站的必要清扫）。"这个成员有没有资格发这条 op"是世界规则，由 world 在折叠时决定接受还是忽略，shell 不代管。
- **副作用幂等**：`AfterAddChatLogEntry` 等落盘后钩子在每个 replica 各自触发一次；replicated world 的副作用要么是本机幂等的（刷新本机缓存），要么经 `world_state` 写共享状态（同 key LWW 天然收敛）。
- 未安装该 world 的节点：回退 RPC 到 bind 里的 `homeNodeHash`（首绑者充当种子主机），行为退化为 hosted——所以 replicated 是 hosted 的严格超集，不会比现状更糟。

### hosted：单一权威主机（现状语义，保留不动）

- world 只在 `homeNodeHash` 上运行，其他节点经 `remoteWorldProxy` RPC 调用（现有代码路径原样保留）。
- 适合有隐藏真相的世界：暗牌、身份、DM 剧本只存在于主机内存/磁盘，其他节点只能看到主机通过钩子返回的视图——这正是 `GetChatLogForViewer` 按 viewer 撒谎能力的权威来源。
- 主机离线 = 世界暂停，这是该形态的本质属性而非缺陷（DM 不在，游戏就是不能进行）。
- hosted world 同样可以用 `host.state` 把想公开的状态写进 DAG（比如公开的比分板），让离线节点也能读到最后已知状态。

## 声明与绑定

### world 侧声明

`WorldAPI_t` 新增顶层字段：

```ts
export class WorldAPI_t {
	info: info_t
	/** 分布形态；缺省 'hosted'（兼容现状）。 */
	distribution?: 'local' | 'replicated' | 'hosted'
	// ...
}
```

由 world part 自己声明。缺省 `hosted` 保证所有存量 world 行为不变。

### bind 事件

`session_world_bind` / `session_world_bind_channel` 的 content 增加 `distribution` 字段（绑定者从本地加载的 world part 读出后写入）：

- `hosted`：`homeNodeHash` 必填（现状校验不变）。
- `replicated`：`homeNodeHash` 仍必填，语义降级为"种子主机 / 未安装者的回退 RPC 目标"。
- `local`：`homeNodeHash` 可缺省；有也只作为"推荐安装来源"提示。
- 校验（`sessionEventValidate.mjs`）按 distribution 分支；缺省视为 `hosted`，存量事件无需迁移。

### resolveWorld 分发

```
无 bind          → 内置极小 world（D6；distribution 天然 local，钩子全透传）
bind.distribution:
  'local'      → 本机装了同名 world ? loadPart : 内置极小 world
  'replicated' → 本机装了同名 world ? loadPart : createRemoteWorldProxy(homeNodeHash)
  'hosted'     → isLocalNode(homeNodeHash) ? loadPart : createRemoteWorldProxy(homeNodeHash)（现状）
```

`resolveWorld` 从此**永不返回 null**：未绑定与 local 未安装都由内置极小 world 兜底，调用方删光 `world?.interfaces?.chat?.X` 判空特判。极小 world 是 shell 内部对象，不是磁盘 part，不参与安装/卸载，不进 bind 事件。

## WorldChatHost：world 对 chat 存储 / p2p 层的正式调用面

交互拓扑基线里，world 的两条通道是：

1. world 通过发起 API 调用与 persona、char 交互——这条已经存在（`GetCharReply`、`GetSpeakingOrder` yield turn、`GetChatLogForViewer` 喂视图、`GetPrompt`/`GetGroupPrompt` 进 prompt_struct）。
2. world 通过发起 API 调用使用 chat 的存储和 p2p 层——**这条目前没有正式接口**（world 只能被动接收钩子入参，没有主动读写共享状态、触发回复的官方通道）。

WorldChatHost 补齐第 2 条：

```ts
type WorldChatHost_t = {
	groupId: string
	replicaUsername: string

	/** 共享世界状态：DAG 权威，world_state 事件承载。 */
	state: {
		/** LWW KV 读（折叠自 world_state set/delete，按 HLC 收敛）。 */
		get(key: string): Promise<unknown>
		entries(): Promise<Record<string, unknown>>
		/** 写 = 追加签名 world_state 事件，经现有 append → broadcastAndPersist → 联邦同步。 */
		set(key: string, value: unknown): Promise<void>
		del(key: string): Promise<void>
		/** 原始状态写入序列（HLC 全序），供需要自定义折叠语义的 world 自己 fold。 */
		log(sinceEventId?: string): Promise<worldStateEvent_t[]>
	}

	/** 本机私有数据：world 自己的数据目录 JSON，不进 DAG。 */
	localData: {
		get(key: string): Promise<unknown>
		set(key: string, value: unknown): Promise<void>
	}

	/** 主动能力：触发角色回复、投递系统消息（走统一写路径）。 */
	triggerCharReply(channelId: string, charname: string): Promise<void>
	postSystemMessage(channelId: string, content: channelMessageContent_t): Promise<void>

	/** 只读群信息。 */
	listMembers(): Promise<memberSummary_t[]>
	listChannels(): Promise<channelSummary_t[]>
}
```

交付方式：新增可选钩子，绑定/加载时调用一次，world 自行持有引用（计时器、任意钩子内均可用）：

```ts
interfaces.chat.ChatHostConnected?: (host: WorldChatHost_t) => Promise<void>
```

要点：

- `state.set/del` 落的是**当前 replica 成员签名**的 `world_state` 事件——replicated 下每台机器以自己的成员身份写，hosted 下只有主机在写。谁写的一目了然，权限裁决材料齐全。
- `postSystemMessage` / `triggerCharReply` 复用统一写路径与 `triggerCharReply()`，不开旁门。
- 不做能力洁癖：host 对象经 `chatReplyRequest` 间接可达也无妨，char hack 进别的 char 为所欲为本来就是被允许的特性；我们只保证"正门存在且好走"。

## `world_state` 事件与通用 reducer

新增 DAG 事件类型 `world_state`：

```ts
{
	type: 'world_state',
	content: {
		worldname: string,
		action: 'set' | 'delete',
		key: string,
		value?: unknown,          // action === 'set' 时必填
	}
}
```

- **通用 reducer**（shell 侧，`dag/reducers/` 新增）：物化到 `state.worldStates[worldname]`，`set/del` 按 HLC 全序做 LWW。reducer 保持世界无关——shell 不解释 value 语义。
- **状态为群级**：shell 不做频道级隔离；需要频道作用域的 world 用键约定自理（如 `chan/{channelId}/...`）——与"key 语义归 world"一致，reducer 不多长一个维度。
- **原始 log 保留**：需要非 LWW 语义（计数器、集合合并、回合制指令流）的 world 用 `state.log()` 自己折叠，折叠规则是 world 代码的一部分（这就是"客户端共识"：共识 = 相同代码 + 相同 op 序列）。
- **网络层清扫**（唯一需要防御的边界，遵循仓库信任惯例）：远端入站 `world_state` 沿用现有签名 / 成员校验 / HLC skew 管线（`remoteIngest.mjs`），额外加 content 尺寸上限（建议 64KB，超限拒收）。语义有效性不在网络层裁决。
- 非消息类事件，`broadcastAndPersist` 现有分支已覆盖（仅重建 checkpoint，不进 messages.jsonl）。

## 与现有钩子的关系

| 钩子 | local / replicated | hosted（现状） |
| --- | --- | --- |
| `GetPrompt` / `GetGroupPrompt` / `TweakPrompt` | 本机实例执行 | RPC 到主机 |
| `GetChatLogForViewer`（含 legacy `GetChatLogForCharname`） | 本机执行；每台机器给自己托管的 viewer 出视图 | RPC 到主机（主机知道全部真相） |
| `AddChatLogEntry` / `AfterAddChatLogEntry` | 每 replica 本机各触发一次，副作用需本机幂等 | 各 replica 转发主机（现状即如此） |
| `GetSpeakingOrder` | 仅在**回复触发发起机**上生效（本机触发本机裁决）；需要全群强一致轮转的世界应选 hosted | 主机权威裁决 |
| `GetGreeting` / `GetGroupGreeting` | 本机执行 | RPC 到主机 |
| `MessageEdit` / `MessageDelete` | 本机执行 | RPC 到主机 |

判别口诀：**世界需不需要对不同 viewer 隐藏真相？需要 → hosted；不需要但要全群共享进度 → replicated；连共享都不需要 → local。**

## 示例映射

### 默认 fount world → `local`

- `distribution: 'local'`；代码几乎不用改（摘要与渲染知识本来就是本机语义）。
- 收益：主机离线不再拖垮任何群；每台机器的摘要 AI 源用自己的配置。

### 规则型 RPG world → `replicated`

- 公共状态：`host.state.set('weather', ...)`、`host.state.set('quest/main/stage', 3)`。
- 背包：`host.localData.set('inventory/alice', [...])`——本地处理，不广播。
- 掷骰：发起机掷完把结果连同种子作为 op 落 DAG（`state.log` 语义），他人信任或验证。
- 玩家越权 op（改别人背包、跳任务阶段）：world 折叠时按成员身份忽略之，网络层不管。

### 狼人杀 DM world → `hosted`

- 暗牌 / 身份表只在主机 `localData`；`GetChatLogForViewer` 按 viewer 裁剪夜晚频道消息。
- 公开状态（存活名单、白天计票）可选写 `host.state` 供离线节点读最后已知值。
- DM（主机）离线 = 游戏暂停，符合预期。

## 落地顺序

依赖 dev plan 的 D6（内置极小 world，`resolveWorld` 兜底）先行；除此之外依赖极少（不依赖 A-E 工作流；`resolveWorld` 一处与 D1 的写路径改动无交集）。测试随批走：

1. **G1 声明与分发**（dev plan 批次 M7）：`WorldAPI_t.distribution` decl + bind 事件字段与校验分支 + `resolveWorld` 三分支。默认 fount world 标 `local`。存量行为零变化（缺省 hosted）。配套测试：local fixture 本机执行与未安装回退极小 world；hosted 回归（现有联邦矩阵已覆盖大半）。
2. **G2 状态通道**（dev plan 批次 M8）：`world_state` 事件类型 + 通用 reducer + `WorldChatHost` 模块（`src/chat/session/worldHost.mjs`）+ `ChatHostConnected` 钩子接线 + 入站尺寸清扫。配套测试：replicated fixture world 两 replica 写 op、断言状态收敛与越权 op 被折叠层忽略、超限 payload 入站拒收。

## 验收

- local world 绑定后，主机离线，其他成员的 chat 功能（含 agent 回复）不受影响；各机 world 钩子本机生效；未安装节点回退极小 world，行为等同无 world。
- replicated 双 replica：A 机 `state.set`，B 机 `state.get` 收敛到同值；B 机伪造越权 op，A 机折叠层忽略且不炸。
- hosted 行为与现状完全一致（缺省 distribution 的存量 bind 事件走原路径）。
- `world_state` 超限 payload 被入站清扫拒收，本机写不受限制（本机信任自己）。
