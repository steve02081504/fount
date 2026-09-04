# chat 频道级私域状态本地化（chat_scoped_char_memory / workdir 不上链）

状态：已实施（用户拍板：旧数据不特意兼容/迁移；退群/解群/删频道 GC）

## 现状

- `chat_scoped_char_memory` 的读写路径：
  - 读：`src/parts/shells/chat/src/chat/session/chatRequest.mjs` — `chat_scoped_char_memory: timeSlice.chars_memories[charname] ??= {}`（引用注入 request）。
  - 写：角色模板就地 mutate 该对象 → 落入 `LastTimeSlice.chars_memories`（`models.mjs timeSlice_t`）。
  - 持久化 / 上链：`chatLogAppend` 将带 `extension.timeSlice` 的消息条目 append 进 DAG（`chars_memories` 旁挂在同一 `timeSlice` 对象内）→ `persistedTimeSnapshot`（`getGroupRuntime` 缓存的 `chatMetadata` → `toData()`）与 DAG 事件里的 timeSlice 均随消息事件 **复制到联邦链**。
- `workdir`（`chatReplyRequest_t.workdir`）本 session 刚引入，chat 引擎目前从不设置；只有 code shell 手构请求时填。
- bridge（平台 bot）路径：`bridge/session.mjs` 的 `charMemories[charname]` 本就是进程内存，不上链——不受影响。

## 目标

- `chat_scoped_char_memory` 与 `workdir` 按 **(charname, groupId, channelId)** 键控，存**本地文件**（不上链、不联邦复制）。
- 每 char 每频道一份；跨远端访问由各节点本地解析（与 subfount 隔离语义一致）。

## 实施方案（待确认后动手）

1. 新文件 `chat/session/scopedMemory.mjs`：
   - `key(username, groupId, channelId, charname)` → 单键 JSON 文件（`{userDict}/shells/chat/scoped_state/{groupHash}/{channelId}/{charname}.json`，复用 EVFS 本地存储或 `userEntityShellData`）。
   - `getScopedMemory(username, groupId, channelId, charname)` / `saveScopedMemory(..., value)` / `getScopedWorkdir(...)` / `saveScopedWorkdir(...)`。
2. `chatRequest.mjs`：
   - `chat_scoped_char_memory` 改为 `await getScopedMemory(username, groupId, channelId, request.char_id)`（缺省 `{}`）。旧值迁移：本地无值而 `timeSlice.chars_memories[charname]` 有 → 首次读后搬到本地并回写 timeSlice 为 `{}`（或保留只读到 saveCompletes 后清除）。
   - `workdir` 同理从 `getScopedWorkdir` 读取（频道级设置项，Hub/UI 可改写）。
3. 写回点 `triggerReply.mjs`：生成 `finally` 中快照 `request.chat_scoped_char_memory` / `request.workdir`（就地 mutate 的共享引用）写本地——请求构建者创建传入、char 经插件 mutate、引擎快照，无 HTTP 端点。
4. `models.mjs timeSlice_t`：`toJSON/toData/fromJSON/copy` 均剥离 `chars_memories`（hydrate 同步剔除）；实测见 `test/pure/time_slice_memory.test.mjs`。
5. GC：`deleteChannel` → `clearScopedState`；整群删副本时群目录整体删除覆盖。
6. 测试：chat pure（timeSlice 剥离）+ chat / code / ImportHandlers 回归。

## 待用户拍板（已拍）

- 写回点选 triggerReply 单点（推荐，覆盖 abort）→ 已采纳。
- 旧数据迁移策略：首读搬迁 vs 保留链上只读 → 均不做（不兼容、不迁移）。
- 语义（用户定稿）：memory / workdir 由请求构建者（shell）创建传入 → char 传给插件就地 mutate 字段 → 生成结束 chat 引擎快照写回本地；**无 HTTP 端点**，内部结构与用户无关，chat 只负责快照与管理。
