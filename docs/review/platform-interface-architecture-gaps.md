# 平台默认界面架构缺陷审阅 —— M7 无法实施的两处地基缺件

最后核对：`2026-07-13`

## 范围与结论

审阅对象：`shells:chat` 的 bridge 层（M5/M6 已落地部分）、ChatClient 对象模型（M4）、平台默认界面（`telegrambot` / `discordbot` / `wechatbot`），以及龙胆 `GentianAphrodite` 迁移到统一管线（`docs/design/chat-social-dev-plan.md` 的 **M7**）时暴露的架构缺口。

方法：以仓库代码为准，只陈述「代码里有什么 / 缺什么」，并对照 M7 迁移映射表逐项验证覆盖性。

**结论：M7（龙胆迁移）当前无法实施。** M1–M6 的主体（onMessage 管线、ChatClient 对象模型、bridge ingress、三壳改薄、care/notify）已落地，但 M7 依赖的两块地基在设计时被忽略，导致迁移映射表里两项龙胆核心能力**无处可去**：

1. **没有统一的「停止 bot 运行」方法** —— 龙胆「自裁」命令无对应落点。
2. **平台默认界面的身份映射不认识「user 自己」** —— 龙胆「主人」在 TG/DC 上无法被稳定识别为 operator 本人。

这两处不是实现细节遗漏，而是 dev plan 的**模型盲区**：把「平台 bot 壳退化为翻译层」当成纯消息格式转换问题，没有建模 bot 的**生命周期控制**与**平台账号 ↔ 本节点 user 本人**的身份归属。

---

## 一、缺陷：没有统一的「停止 bot 运行」方法

### 现状

龙胆的「自裁」命令（`bot_core/trigger.mjs::handleOwnerCommandsInQueue`）：

```351:358:data/users/steve02081504/chars/GentianAphrodite/bot_core/trigger.mjs
			if (base_match_keys(content, [/^龙胆.{0,2}自裁.{0,2}$/])) {
				const selfDestructReply = inHypnosisChannelId === channelId ? { content: '好的。' } : { content: '啊，咱死了～' }
				await sendAndLogReply(selfDestructReply, platformAPI, channelId, currentMessageToProcess)
				// ...
				await platformAPI.destroySelf()
				return TriggerResultType.EXIT // 发出退出信号
			}
```

`platformAPI.destroySelf()` 停掉**该平台的 bot 实例**（Telegraf / discord.js 连接），这是「让龙胆整体下线」的等价物。

### 缺口

统一管线里，平台 bot 壳退化为「一个壳实例绑一个 char」的翻译层，char 侧的操作面是 M4 的 `ChatClient` 对象模型。逐项核对该对象面：

- `ChatClient`：`groups()` / `group(id)` / `openDm` / `createGroup` / `messageFrom` —— **无「停止 / 下线本 char」**。
- `Group.leave()`：只退单个群，不是停 bot。
- M5 `bridgeOps`（`src/public/parts/shells/chat/src/chat/bridge/ops.mjs`）：`sendTyping` / `kickMember` / `createInvite` / `leaveChat` / `openDm` / `getNativeContext` —— **无 `destroySelf` 类别**。
- `onMessage` 事件是纯数据 + 返回布尔意愿，**没有副作用出口**去请求「停止运行」。

即：**M4/M5 的能力面里根本没有 `destroySelf` 的归宿**。M7 迁移映射表把生命周期 hook（`onGroupJoin` / `onOwnerLeaveGroup`）写成「改为 onMessage 惰性查询」，但对「自裁 = 停止整个 bot」这条**没有对应项**，只笼统归进「onMessage 内命令识别 + 副作用」——而副作用无处可施。

### 根因

dev plan 假设 char 的入站只需要 `onMessage`、出站只需要 `ChatClient`，把「bot 是一个有生命周期、可被主人叫停的进程实体」这一事实丢弃了。「谁能停、怎么停、停到什么粒度（本平台连接 / 本 char 全局 / 仅本群）」在整个 M1–M6 里没有建模。

---

## 二、缺陷：平台默认界面的身份映射不认识「user 自己」

### 现状

bridge identity 层（`src/public/parts/shells/chat/src/chat/bridge/identity.mjs`）：

- `bridgeEntityHash(platform, platformUserId)`：为**每个**平台用户确定性派生一个伪 entityHash（`sha512Hex('fount-bridge:...')`），不区分「这是路人」还是「这是本节点 operator 本人」。
- `bindBridgeIdentity(...)`：需要**手动**把某平台账号绑定到真实 fount 实体，绑定优先于派生。

平台 bot 配置里保留了 `OwnerUserID`（M5 规划：「私聊准入过滤仍在壳层」），但它**只用于私聊准入**，既不参与 bridge identity 映射，也不加载 operator 的默认 persona/profile。

### 缺口

「本节点 operator 用自己的 TG/DC 账号发消息」这件极其普遍的事，在当前架构里：

- operator 的平台账号被 `bridgeEntityHash` 派生成一个**陌生的 bridge 伪实体**，而不是 operator 的 entityHash；
- 于是 operator 在自己 bot 的私聊 / 群里发言，**不以自己身份入账**（care / inbox / alias / 通知归属全落在伪实体上）；
- 龙胆的「主人」= operator 本人，龙胆靠 `isCaredBy(username, 龙胆Hash, 主人Hash)` 认主人；但主人在 TG/DC 上是伪实体 hash，**除非主人手动对每个平台账号 `bindBridgeIdentity`**，否则龙胆认不出主人。

M7 迁移映射表把主人识别写成「初始化时 `setCared` 把主人各平台账号的 `bridgeEntityHash` 派生值写进 care 列表」——这要求龙胆**预先知道主人在每个平台的 uid**，而这些 uid 散落在各壳的 bot 配置里（`OwnerUserID` / `OwnerDiscordID` / `OwnerUserName`），char 侧拿不到；且「派生伪 hash」路线意味着主人**永远是个平台专属的假身份**，跨平台 / 与 Hub 的 fount 身份对不上。

### 根因

dev plan 的 bridge identity 模型只考虑了「把任意平台第三方映射成一个稳定锚点」，**漏掉了最重要的一类平台用户：本节点 user 自己**。平台默认界面本质上是「user 把自己的一个平台账号接进 fount」，理应能声明「这个 uid/uname 就是我」，并让该账号的消息以 operator 身份、加载 operator 默认 profile 入账。当前架构没有这条通路。

---

## 三、M7 判定：无法实施

M7 依赖 M4 `ChatClient` / M5 bridge 作为地基，但上述两块地基缺件：

| 龙胆能力 | M7 映射表去向 | 实际落点 | 判定 |
| --- | --- | --- | --- |
| `自裁`（`platformAPI.destroySelf`） | 「onMessage 内命令识别 + 副作用」 | M4/M5 无停止 bot 的操作面 | **阻塞** |
| 主人识别（跨平台） | 「`setCared` 各平台 `bridgeEntityHash` 派生值」 | 平台账号无法认领为 operator 本人；uid 散落壳配置 char 拿不到 | **阻塞** |

在补齐这两块地基前，**不应继续 M7 的实施**。dev plan 中 M7 一节应标注为**无法实施 / 待地基**，其余映射项（trigger 打分 → onMessage、命令副作用 → `chat_scoped_char_memory`、复读/复诵 → noAI 短路、`bot_core` 删除）在地基补齐后方可推进。

---

## 四、补齐方向（非本次实施，供后续排期）

1. **统一「停止 bot 运行」的一等操作**：在 charAPI / `ChatClient` 或 bridge 契约里给出跨平台一致的「下线本 char / 停止本平台接入」语义，明确粒度（本平台连接 / 本 char 全局 / 仅退群），作为 `destroySelf` 的正式归宿。
2. **平台身份映射认领 operator 本人**：平台默认界面配置里让 user 声明自己的平台 uid/uname；bridge 层把这些账号直接映射到 operator entityHash（而非派生伪 hash），并加载该 user 的默认 profile / persona。主人识别、care、通知归属随之统一，龙胆无需预知各平台 uid。

---

## 五、现有实现与 M1–M6 规划的差异（规划 agent 必须核对项）

M7 的两处阻塞是「规划面 vs 现实面」脱节的极端后果；同样的脱节在 M1–M6 已落地部分里以较轻的形式**大量存在**——dev plan 写的路径 / 命名 / 语法与仓库实际实现有系统性偏差。这些偏差本身多数是**有意的实现选择**（功能已覆盖设计意图），但对规划 agent 意味着：**dev plan 的文件路径、API 名、token 语法都不可直接引用，必须逐条对照代码**（这正是文档开头「以仓库代码为准」原则的实测代价）。

### 5.1 结构性偏差（路径 / 命名 / 语法）

| 里程碑 | 规划文本 | 实际实现 | 影响规划的点 |
| --- | --- | --- | --- |
| M2 | inline tokenizer 在 `src/public/pages/scripts/lib/inlineTokens.mjs`；`pages/scripts/lib/mentions.mjs` | 实际在 `src/public/parts/shells/chat/public/shared/inlineTokens.mjs`；薄封装在 `chat/public/shared/mentions.mjs` | 引用 tokenizer / mention 工具的路径全错 |
| M2 | entity @ 语法为裸 `@[<128hex>]`（token 表明确「裸 `@128hex` 废除」） | 实际为 `@[hash:<128hex>]`（`inlineTokens.mjs::parseBracketMention` 要求 `hash:` 前缀） | **token 语法与设计表不一致**；出入站改写、渲染、fixture 全部按 `hash:` 写 |
| M2 | Web Push / notify 在 `src/server/notify/` | 实际在 `src/server/web_server/notify/`（`notify.mjs` / `webPush.mjs`） | 接入点路径错 |
| M5 | @ 双向转换落 `chat/bridge/format.mjs` | **无 `chat/bridge/format.mjs`**；@ 转换分散在各壳 `src/format.mjs`（telegrambot/discordbot/wechatbot 各一份） | 「桥接层持有格式转换」的假设不成立；平台格式是各壳自持 |
| M1 | Hub 前端切 `inbox*` 命名 | 仍是 `hub/mentionsView.mjs` / `mentionsInbox.mjs`（已切 `/inbox` 路由，仅文件名未改） | 前端文件命名与规划不符 |
| M1 | `buildOnMessageEvent` 未指定落点 | 实际在 `session/replyThrottle.mjs` | 事件构建入口在意料之外的文件 |

### 5.2 功能性缺口（PARTIAL / 未闭合）

| 里程碑 | 缺口 | 对后续（含 M7）的意义 |
| --- | --- | --- |
| M1 | `runTriggerPipeline` 的 **无 `onMessage` 兜底** DM 判定用 `state.groupMeta?.dmKind === 'ecdh'`，未覆盖 `buildConversationContext` 派生的 **bridge DM**（`groupSettings.bridge.chatKind === 'dm'`） | 实现了 onMessage 的 char（如龙胆）读 `event.group.kind` 无碍；但**未实现 onMessage 的 char 在 TG/DC 私聊里不会被兜底触发** |
| M3 | UI 接线未走完整解析链：`domUtils.authorDisplayLabel` 只用 `aliasForEntity`，未接 `resolveDisplayName`（缺 profileName 层）；成员列表未统一走 `disambiguateLabels` 消歧 | 具名层「三层解析」在展示端未贯通；同名消歧未全覆盖 |
| M5 | bridge DTO 的结构化 `mentions` 字段未被消费——入站靠壳层把正文改写成 `@[hash:...]` token（而非传结构化 mention 实体） | 「DTO 带 `mentions[]`」的规划接口是空的；实际契约是「壳层负责改写正文」 |
| M5 | telegrambot 遗留死代码：`TelegramMessageToFountChatLogEntry` 仍导出但未用；扁平 `default_interface.mjs` 副本残留；`default_interface/` 目录未如规划「消失」 | 迁移残留未清理，易误导后续读者 |
| M6 | WeChat **无 edit/delete ingress**（无 `postBridgeEdit`/`postBridgeDelete`）；`registerBridgeOps('wechat', …)` 仅 `sendTyping` + `getNativeContext`（平台能力所限） | 三平台能力面不对齐；「四端一致」在 WeChat 侧天然打折 |

### 5.3 验收未闭合（M5/M6 测试）

规划的验收项有相当部分**未落测**：搜索可查、未读递增、`postBridgeMessage → runTriggerPipeline → char 回复 → notifyBridgeOutbound` 端到端、`postBridgeEdit`/`postBridgeDelete` 集成、telegrambot mock Telegraf→DTO、出站贴纸回归、`FormatOutboundReply` 返回 true 跳过默认格式化、四端触发一致性回归——均缺失。规划 agent 若以「M5/M6 已验收」为前提排 M7，会高估地基可靠度。

### 5.4 对规划 agent 的直接结论

- **不要引用 dev plan 里的路径 / API 名 / token 语法**——它们与现实系统性偏差，必须用 Glob/Grep 对照代码后再写进新规划。
- **「已落地」≠「按规划落地」**：M1/M2/M4 主体到位但细节漂移，M3 UI、M5/M6 测试与 WeChat 能力面均有缺口。排期新工作前要按上表核对真实覆盖，而非信任规划文本的完成度描述。

---

## 六、流程改进：规划应先研究龙胆真实架构需求

M7 的两处阻塞本可在规划阶段发现——龙胆的 `bot_core` / `platform-api.mjs` / 命令语义 / 生命周期就是「一个 agent 在平台上实际需要什么」的实战清单。dev plan 却是**先定 M4/M5 的抽象面，再把龙胆能力逐项塞进去**，映射表每一项都写了「去向」，却没有对照目标面的**实际 API** 验证覆盖，结果两项在落地时才发现无处可去，属「为了规划而规划」。

改进要求：

- 架构规划 agent 在写迁移映射表前，**必须先通读龙胆的 `bot_core`、`interfaces/*/platform-api.mjs`、命令处理与生命周期代码**，把「agent 在平台上真正需要的能力」列成清单作为设计输入。
- 映射表的每一项要对照**目标面已存在的具体 API / 方法**逐条验证覆盖；找不到对应项即当场标注为**阻塞地基**，而不是用「onMessage 惰性查询」「副作用」等含糊措辞掩盖缺件。
- 涉及生命周期、身份归属这类跨切面语义时，优先确认模型是否成立，再谈映射。

---

## 关联

- 设计文档：[../design/chat-social-dev-plan.md](../design/chat-social-dev-plan.md)（M7 应据本报告标注为无法实施）
- 龙胆架构：`data/users/steve02081504/chars/GentianAphrodite/AGENTS.md`
- 触发统一审阅：[chat-platform-trigger-unification-review.md](./chat-platform-trigger-unification-review.md)
- 操作平权审阅：[human-agent-operational-parity-review.md](./human-agent-operational-parity-review.md)
