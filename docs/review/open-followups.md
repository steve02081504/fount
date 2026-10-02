# 待跟进事项汇总（chat 整理 / DM 频道 / 测试并行）

最后核对：`2026-10-02`（逐条对照工作树代码，未运行测试套件）。写法：[docs/AGENTS.md](../AGENTS.md)。

已修复项不收进本文件（见下「已收口」）。这里只留**当前代码里仍能复现**的残差，每条都给了证据与明确的「不是这个」。

来源：本文件合并并取代了 `test-parallel-followups.md`、`chat-auto-name-follow-up.md`、`chat-dm-channel-followups.md`（三份已删除）。频道级私域状态的**实施方案**保留在 [chat-scoped-local-state.md](../issues/chat-scoped-local-state.md)，本文件只记其一处的文档失配。

关联：[chat-vs-industrial-im-gap.md](./chat-vs-industrial-im-gap.md)、[social-platform-gap-analysis.md](./social-platform-gap-analysis.md)、[chat-social-cabinet-tech-stack.md](./chat-social-cabinet-tech-stack.md)。

---

## 结论摘要

一人一台日常会碰到的：

1. **✗ 整理对话会改权限**：DM 空名频道自动归类时顺带把频道的权限块指针换成分类，整理动作等于一次访问控制变更。
2. **△ 整理不是原子操作**：建类 / 改频道 / 摘旧父 / 挂新父是 1+N+1 条独立签名事件，中途失败或并发整理可留空分类或让频道暂时从侧栏消失。
3. **✗ 跨频道重新生成串台**：重新生成/分支仍取**群级**时间线末条，切过频道后会改到别的频道最后一条消息；问候重掷不进 DAG。
4. **△ 历史丢失事件无修复流程**：旧缺陷把某次 `channel_create` 折进基态后，升级不会重建该频道，且无任何比对/修复工具。

只影响多任务跑测试的开发机（不影响产品使用，但会拖慢 agent 工作）：

5. **△ Deno 启动检查仍串行**：测试正文已并行，但每个测试文件的 `spawn → JS-ready` 仍排队等单一租约；上游 [denoland/deno#35804](https://github.com/denoland/deno/issues/35804) 未修。
6. **△ 资源画像开环**：CPU 上限仍固定 85%，内存用 RSS（不含已换出的提交量）；准入只看预订值，无实测反馈、无大任务 aging。
7. **△ 无标记临时目录仍可能漏报**：有归属标记的目录已能按 job 归属报告；约 40 处测试自建目录与若干生产代码临时目录无标记，`ms-playwright` 仍只靠 baseline。

---

## 已收口（不再跟踪）

- DM 群「折叠检查点后首次创建的频道消失」——追加路径已补齐缺失锚点：`chat/dag/append.mjs:92-98`，回归 `test/integration/channel_create_folded_anchor.test.mjs:33-38`。
- 角色 DM 每个新文本频道独立发送问候：`session/partConfig.mjs:236`（`greetDmChannel`，`:248` 按频道去重）→ `api/channel.mjs:267-275`，回归 `test/integration/dm_channel_greeting.test.mjs:38-50`。
- 自动命名：按实际话题分类、保留说话者与最近消息、跳过无正文记录、校验输出名称（`group/routes/channelAutoName.mjs`、`group/lib/channelAutoNamePrompt.mjs`）。
- 测试并行调度四类缺陷：队首资源不足阻塞后续 job；预算刷新不唤醒等待者；物理内存预算漏计交换空间；serial 首个 worker / heavy 单元租约的死锁与回收。证据：`runner/scheduler.mjs:110-114`、`:121-125`、`:315-323`、`:420-431`；回归 `selftest/resources_scheduler.test.mjs:49/61/73/87/99/151/696`、`selftest/kernel_lifecycle.test.mjs:118`。

---

## 一、私聊频道自动命名与归类

文件：`src/public/parts/shells/chat/src/group/routes/channelAutoName.mjs`、`src/public/parts/shells/chat/src/group/lib/channelAutoNamePrompt.mjs`。

### ✗ 1.1 自动归类同时改变权限继承（主路径）

- **影响**：新建对话触发旧频道自动归类时，除调整父频道 links，还把目标频道的 `permissionBlockId` 设成分类 ID（`channelAutoName.mjs:120`，与名称合成同一条 `channel_update`，`:121-122`）。分类若带不同权限，一次「整理」就改变了原频道的有效权限。
- **证据**：该指针即有效权限来源（`chat/dag/reducers/channels.mjs:35` 写入，`chat/dag/permissionBlockOwner.mjs:7-20` 沿指针解析）。代码里没有任何保留原有效权限的分支：`reducers/channels.mjs:64-68` 只在 `updates.permissionBlockId === null`（主动脱钩）时复制有效块，这里传的是真实分类 ID。也没有被复用的统一移动/权限同步操作——`chat/dag/channelOperations.mjs:67-132` 只有 links/update 原语，权限同步只在 `group/routes/governance.mjs:249-273` 与前端 `public/src/endpoints/groupChannel.mjs:480-486`，自动命名两者都没调用。
- **Not this**：不是 AI 话题判断错误，也不表示这些私聊已发生权限泄漏；是否可见取决于分类的权限配置。普通同机私聊同样走这条路径。
- **后续**：明确自动移动是否保留原有效权限，复用统一的移动/权限同步操作，并覆盖有权限覆写、私有频道和跨分类移动。

### △ 1.2 分类与移动是多事件操作，缺少完整提交保障（主路径；中断或并发时出现）

- **影响**：一次自动归类实际写 1+N+1 条独立签名事件（`:95-108` 锁内 find-or-create 分类 → `:118-122` 改频道名称+权限块 → `:128` 逐个从旧父移除 link → `:130` 挂到分类）。任一步失败会留下空分类、频道未移动或暂时失去侧栏入口；多个旧频道并发整理时，`channelOperations.mjs:84-87`、`:114-116` 各自 `getState` 后整表写回父 links，仍可能互相覆盖。
- **已缓解**：`:33` + `:95` 每群分类 find-or-create 互斥锁（`group/lib/locks.mjs:17`，进程内、群粒度），避免并发建同名分类；AI 调用前后两次重读（`:86`、`:112`，注释 `:111`）防止覆盖 AI 等待期间的手动改名、或向已删除频道写回。这些都不等于整组操作原子化。
- **Not this**：不是要求重做 AI prompt，也不应直接改写已有签名事件或 snapshot 来「修好」。
- **后续**：为群内树变更设计统一协调或可恢复的移动操作，覆盖并发分类、手动移动、删除和每一步失败后的重试。

### △ 1.3 摘录预算与模型质量仍未验证（主路径；长对话时出现）

- **影响**：上下文上限仍是最近 13 条消息、4000 字符（`channelAutoName.mjs:27`、`channelAutoNamePrompt.mjs:4`）。超预算时改为保留**最新**部分（丢头部、以省略标记开头，`channelAutoNamePrompt.mjs:10-15`），并靠提示词要求以用户实际问题为主题、证据不足时输出空标签（`:31-34`）。但截断仍是对拼接串直接切片，可能落在消息中间；多话题长对话仍可能被尾部话题代表。
- **Not this**：这是取样策略问题，不是角色身份分类的特例；纯函数测试只覆盖预算、序列化与解析，不证明任何模型一定按话题正确分类。
- **证据**：`src/public/parts/shells/chat/test/pure/channelAutoNamePrompt.test.mjs` 断言三组：顺序与预算（小输入原样、空输入、超长时长度恰为 4000、以省略标记开头且以最后一条消息结尾）、prompt 内 JSON 可完整往返（含 XML 标签与换行）、解析校验（trim、空标签、换行/HTML/超长被拒、emoji 计数）。无模型质量评估。
- **后续**：改为按消息分配预算、显式保留用户问题与开头/结尾主题；用脱敏的记忆核对、开发排障、日常交流和实际创作对话做模型评估。

---

## 二、Chat DM 频道

### ✗ 2.1 频道间重新生成仍共用群级时间线（主路径）

- **影响**：在不同 DM 频道间切换后重新生成/分支，可能操作**另一频道**的最后一条消息或分支。新增的每频道问候放大了暴露面——现在每个 DM 频道各有一条 greeting，而重新生成仍取群级末条。
- **证据**：`chat/session/timeLine.mjs:49` 的 `modifyTimeLine(groupId, channelId, delta)` 收了 `channelId` 但函数体从不引用（全文只有 `:45` JSDoc 与 `:49` 形参）；`:63-64` 取 `chatMetadata.chatLog[chatMetadata.chatLog.length - 1]`，`:84-88`、`:163-166` 同样按群级写回，`:36-38` 用群级 `timeLines` / `timeLineIndex`；全仓无 channelId 键控的时间线结构。问候的重掷只改内存 + `broadcastGroupEvent`（`timeLine.mjs:96-154` 的 import 段无 chatLogMirror），而问候**创建**是落 DAG 的（`partConfig.mjs:216` → `chatLogAppend.mjs:62` → `chatLogMirror.mjs:252-271`）；镜像层对问候直接早退（`chatLogMirror.mjs:81`、`193`、`288`、`321`）。路由只把 `channelId` 当默认频道兜底（`group/routes/groups.mjs:157-170`），`GET /branch` 仍读群级 `timeLineIndex`（`:146-155`）。
- **Not this**：本轮已修的是新问候的目标频道与 DM prompt 跨频道混入；这里说的是**手动重新生成与分支持久化**，不是新频道自动开场。
- **后续**：按频道管理当前条目与分支，用明确的消息 ID 编辑；把问候重掷纳入 DAG 编辑链并保留 `greeting:<subtype>`；补切频道、重载、分支回滚测试。

### ✗ 2.2 已丢失的首次创建事件没有历史修复流程（边角；仅发生在中过旧缺陷的单机群）

- **影响**：旧版本已把某次创建事件写入磁盘、却把**不含该频道**的状态签进后续检查点时，升级不会自动重建那个历史频道。用户当前群 `channel_6595773f06dc44498fc3a2e0746990dc` 就处于此状态：该群 `events.jsonl` 含对应 `channel_create`（id `0d36fd08…585523`），而 `snapshot.json` 的 `members_record.channels` 只有 `root` / `default` / `channel_3ebf382d…` / `channel_28902a0f…`；该 create 事件 id 反而在 `snapshot.epoch_chain`（14 项）里，即已被基态覆盖。自动重建被显式抑制：`chat/dag/wal.mjs:47-49` 对采纳的 owner 签名基态直接放行，`chat/dag/materialize.mjs:238-263` 走 `materializeFromCheckpoint` + `coveredByAnchor` 跳过。
- **证据（无工具）**：全仓搜 `channel_recover` / `recoverChannel` / `missingChannels` / `orphanChannel` / `listRecoverable` / `restoreChannel` 无相关实现；`group/routes/*.mjs` 全部端点、`path/src/cmd/`（19 个命令）、`src/scripts` 都无「保留事件 vs 物化状态」比对工具。唯一 `repair` 命名项 `repairJoinSnapshot`（`public/src/endpoints/groupFederation.mjs:62` → `groupSync.mjs:374`）语义是向联邦邻居拉快照。事件类型也只有 `channel_create/update/delete`（`chat/dag/eventTypes.mjs:33-35`），无恢复/修复类型。
- **Not this**：这是已有历史状态的修复，不影响修复后正常新建的频道——追加路径的缺锚点问题已修（见「已收口」）。不能简单丢掉签名基态做全量重放：联邦节点可能缺少已折叠的历史，重放会损失成员与权限状态。
- **后续**：提供显式维护工具，比对保留事件与当前物化状态，列出可恢复项及权限依据；通过新的**签名治理事件**修复，不篡改检查点、不重复提交旧事件。

---

## 三、多任务并行测试（开发机）

### △ 3.1 Deno 启动检查仍需短暂串行

- **影响**：多个 agent 同时提交大量 Deno 测试时，`spawn → JS-ready` 阶段仍要排队等单一租约；测试正文已经是并行的。
- **证据**：`src/scripts/test/kernel/module_check.mjs:39` `ModuleCheckGate`（单租约 `:58`，`:93` 获取、`:143` 释放、`:165` ready；持有上限 `:17-19`，默认 3 分钟、可用 `FOUNT_TEST_MODULE_CHECK_HOLD_MS` 覆盖），占用点 `kernel/runtime.mjs:1132`（suite 级）与 `deno/serial.mjs:235`（**每个文件**）。正文并行：`deno/serial.mjs:219` `runPool`、`:271` `Promise.all`，配合 `hub/clients/unit_lease.mjs:52`。ready 信号在 `module_check_ready.mjs:10`（preload，先于用户代码）。
- **上游**：`src/scripts/test/docs/upstream-blockers.md:5`（[denoland/deno#35804](https://github.com/denoland/deno/issues/35804) 并发 `node_modules/.deno` 损坏）、`:9`（明写互斥只覆盖 spawn→JS-ready，不解决 ready 后的懒加载竞态，例如 `growly` / `node-notifier`）。（旧文档把该文件写成 `docs/upstream-blockers.md`，实际在 `src/scripts/test/docs/`。）
- **Not this**：不是测试全文串行，也不能直接删掉互斥——共享自动生成的 `node_modules/.deno` 可能损坏。
- **后续**：上游修复后验证多个 CLI 与 serial worker 同时冷启动，再统一去掉启动闸门并同步调整 ETA 模拟、自测与文档。若改走独立依赖目录，需另设计动态 URL/npm 依赖、磁盘成本与回收流程。

### △ 3.2 资源画像与实时性能仍有偏差

- **影响**：CPU 用历史均值/manifest 预订，内存画像用 RSS；开启交换空间后 RSS 不含已换出的提交量。机器负载不同时，预算可能偏保守或高估余量。
- **证据**：`src/scripts/test/core/proc_sample.mjs:23`（Windows `WorkingSetSize`）、`:60`（`ps -o rss`）、`:229`、`:232` `#lastTreeRssBytes`、`:333` 全为 RSS，`finish()`（`:256-271`）只回 `{peakMemMb, peakUnitMemMb, avgCpuPct}`，不含 swap/commit；commit 只用于预算侧 `core/concurrency.mjs:16`（Windows 提交余量）、`:38`（POSIX `+ info.swapFree`）、`:63`（`MEM_HEADROOM = 0.7`）。CPU 上限仍 85%（`core/baseline.mjs:15` → `runner/scheduler.mjs:76`）。准入是开环：`scheduler.mjs:178` `#canFit` 只比预订值与常量预算，`:220-236` / `:295-310` 只按 `#fillScore` 填缝，waiter 无入队时间戳，因此没有实测消耗反馈，也没有大任务 aging。
- **Not this**：不是把整块空闲磁盘当内存——本次只用 OS 提供的已配置分页/交换容量（Windows 用提交余量）。
- **后续**：采集提交量与瞬时全机 CPU/磁盘分页压力；区分「尚未启动的资源预订」与「已开始任务的实测消耗」，设计有滞回、有限增量的反馈准入，防瞬时低负载大量超发；给长期等待的大任务加 aging，避免持续小任务填缝导致饥饿。

### △ 3.3 并行 job 的无标记临时目录泄漏归属仍不完整

- **已修复**：`origin.txt` 带 job ID，套件子进程通过 `FOUNT_TEST_CLEANUP_OWNER` 继承归属（`core/temp_origin.mjs:42-43`、`runner/suite_run.mjs:69`、`:140-141`）；job 完成时立刻扫自己的有标记目录（`kernel/runtime.mjs:417` 取 baseline、`:1383-1390` 按 owner 过滤后报 `exitCode = 3` 并广播 `cleanup-leak`），即使还有其它套件在跑也在该 job 的 `cleanup-leak` / `job-done` 里报告；`core/cleanup_check.mjs:54-79` 只上报 `jobId === owner` 的目录。回归：`selftest/kernel_lifecycle.test.mjs:36`（真实双 job）、`selftest/cleanup_check.test.mjs:62`（后到 job 的 baseline 仍能报、不误报 peer）。
- **影响**：无归属标记的旧目录、写标记失败的目录与 `ms-playwright` 仍只能在「无其它套件运行且非嵌套并行」时按 baseline 扫描（`kernel/runtime.mjs:1383-1390` 的 `includeUnowned` 条件；`core/cleanup_check.mjs:58-59`）。较早结束的 job 留下这类残留时仍可能漏报。仍缺标记的创建点：`tools/bench/common.mjs:96 withTempDir`（被 `kernel_startup.mjs:96`、`kernel_link.mjs:77` 使用）、`tools/bench/test_cycle.mjs:35`、`:84`；约 40 处测试自建 `fount…` 临时目录（`selftest/*.test.mjs`、`src/public/parts/**/test/**`；`shells/chat/test/integration/routes_http.test.mjs:43` 是已标记反例）；生产代码里走系统 Temp 且未标记的点：`src/public/parts/shells/wechatbot/src/format.mjs:123`、`:149`、`src/public/parts/shells/export/src/manager.mjs:78`、`src/public/parts/ImportHandlers/fount/main.mjs:78`、`src/public/parts/ImportHandlers/fount/zip.mjs:59`、`:119`、`src/public/parts/ImportHandlers/Risu/main.mjs:50`、`src/public/parts/plugins/sub-agent/archive.mjs:41`、`src/public/parts/serviceGenerators/AI/gemini/main.mjs:563`。
- **Not this**：不是要求对运行中的套件直接扫目录并报错——那会把仍在使用的目录误报成泄漏。
- **后续**：补齐没有调用来源标记的创建点，或为无标记残留设计「队列排空后延迟扫描」并明确报告归属；不能让内嵌测试内核的 job 等父套件结束才返回，否则父子互相等待。

---

## 四、文档失配（待修，非代码缺陷）

[chat-scoped-local-state.md](../issues/chat-scoped-local-state.md) 的机制已落地，但与工作树不符的 3 处描述（该文件本身保留为实施方案基线，不并入本文件）：

| 文档写的 | 实际 |
| --- | --- |
| `chat/session/scopedMemory.mjs`，`{groupHash}/{channelId}/{charname}.json`，导出 `key()` / `getScopedMemory` / `getScopedWorkdir` | 实际文件 `chat/session/scopedState.mjs`；每频道一个 `groups/{groupId}/scoped_state/{channelId}.json`（`chat/lib/paths.mjs:146`），内部 `{ [charname]: { memory, workdir? } }`；导出 `getScopedCharState:162`、`saveScopedState:124`、`saveScopedMemory:183`、`saveScopedWorkdir:196`、`clearScopedState:209`、`withScopedStateMutex:93`、`markScopedStateChannelActive:68` |
| `timeSlice_t` 的 `toJSON/toData/fromJSON/copy` 剥离 `chars_memories` | 字段已整体删除，`chars_memories` 全仓代码 0 命中（`models.mjs:39-95`、`hydrate.mjs:17` 均无），不存在「剥离」逻辑 |
| 测试 `test/pure/time_slice_memory.test.mjs` | 不存在。实际覆盖在 `test/integration/scoped_state.test.mjs`、`test/integration/set_workdir_persistence.test.mjs`、`test/integration/leave_cleans_group_dir.test.mjs` |

其余一致：读取 `chatRequest.mjs:192` → `:287` / `:291`；写回 `triggerReply.mjs:339-351`（一次同时快照 memory + workdir，单次原子读改写）；GC `dag/channelOperations.mjs:140-151`（先写 `channel_delete` 再 `clearScopedState`）与 `dag/lifecycle.mjs:303-305`（整群目录删除）。未覆盖项：没有测试显式断言 `deleteChannel → clearScopedState`。

---

<details>
<summary>附录：证据索引</summary>

| 主题 | 路径 |
| --- | --- |
| 自动命名 / 归类 | `group/routes/channelAutoName.mjs`；`group/lib/channelAutoNamePrompt.mjs`；`group/lib/locks.mjs`（chat = `src/public/parts/shells/chat/src/`） |
| 频道树 / 权限 | `chat/dag/channelOperations.mjs`；`chat/dag/reducers/channels.mjs`；`chat/dag/permissionBlockOwner.mjs`；`group/routes/governance.mjs` |
| 时间线 / 镜像 | `chat/session/timeLine.mjs`；`chat/dag/chatLogMirror.mjs`；`chat/session/partConfig.mjs`；`group/routes/groups.mjs` |
| 检查点 / 锚点 | `chat/dag/append.mjs`；`chat/dag/wal.mjs`；`chat/dag/materialize.mjs`；`chat/dag/eventTypes.mjs`（`chat/` = `src/public/parts/shells/chat/src/`） |
| 测试框架闸门 | `src/scripts/test/kernel/module_check.mjs`；`kernel/runtime.mjs`；`deno/serial.mjs`；`hub/clients/unit_lease.mjs` |
| 资源画像 / 准入 | `src/scripts/test/core/proc_sample.mjs`；`core/resources.mjs`；`core/baseline.mjs`；`core/concurrency.mjs`；`runner/scheduler.mjs` |
| 临时目录归属 | `src/scripts/test/core/temp_origin.mjs`；`core/cleanup_check.mjs`；`runner/suite_run.mjs`；`kernel/runtime.mjs` |
| 上游阻塞 | `src/scripts/test/docs/upstream-blockers.md` |

</details>
