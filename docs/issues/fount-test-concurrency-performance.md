# fount test 并发、性能与输出噪音问题报告

> 面向维护者。结论来自 2026-09-22 一次「多 agent 并行 code review」会话的实测数据（opencode 会话 `ses_f3842b9a5ffec8az7EMVbhBDOj`）。
> 日常只需记住：**并行跑测试时，真正卡住你的往往不是测试本身，而是单内核共享队列 + module-check 互斥 + 每次调用都跑 `deno upgrade`；而 agent 看到的一屏 `总剩余：0 个未知时长` 只是内核调度抖动被逐行打印出来，不含任何进度信息。**
> 修复清单见文末，P0 四项即可消除绝大多数「600s 超时空转」。

## 1. 现象

会话 06:11–08:44 UTC（约 2h33m）。最后一批 6 个并行「修复」子 agent（06:42–08:44）各自调用 `fount test`：

| 子 agent | 调用数 | 阻塞累计 | >120s | 被工具超时杀掉 |
| --- | ---: | ---: | ---: | ---: |
| async-task | 6 | 29.5 min | 6 | 1 |
| sub-agent | 2 | 2.6 min | 0 | 0 |
| code-shell | 6 | 86.1 min | 5 | 0 |
| context-compress | 1 | 15.0 min | 1 | 1 |
| agent_studio | 17 | 79.3 min | 14 | 4 |
| i18n | 3 | 6.7 min | 2 | 0 |
| **合计** | **35** | **≈219 min** | 28 | **6** |

单次调用耗时相对 suite 实测基线的膨胀（基线见 `data/test/state/main.json`）：

| 调用 | suite 基线 | 实测墙钟 | 倍率 |
| --- | ---: | ---: | ---: |
| `checks:text_lf` | 36.8s | 281.8s | 7.7× |
| `checks:theme_radius` | 8.3s | 600.6s（杀）/96.7s/178.4s | 最高 72× |
| `shells/agent_studio:pure` | 10.5s | 178.4s | 17× |
| `shells/agent_studio:integration` | 8.1s | 147.1s | 18× |
| `plugins/sub-agent:pure` | 12.9s | 64.5s | 5× |

具体异常：

- agent_studio 在 07:19:50 同时发起 4 个 `checks:*`，**全部在 600.5s 被 opencode bash 超时杀掉、零输出**；同样的套件在 07:34–07:39 单独重跑 78–96s 就通过。
- `plugins/context-compress` 跑 900.6s 被杀，日志只有一行 `module-check missed ready`（`data/test/state/logs/plugins_context-compress/integration.log`）。
- 07:32:09 出现 `test kernel did not become healthy at http://127.0.0.1:8903`（96.7s 后抛出，而此时无任何测试在跑）。
- 队列持续饥饿信号：`排队等待中，前方还有 5 / 13 / 14 项`。
- 07:02 agent_studio:frontend 因 `Cannot find module .../.deno/raw-body@3.0.2/node_modules/iconv-lite/lib/index.js` 失败重试（该文件现在存在）。
- `plugins/async-task:integration`（基线 33s）两次跑到 600.6s / 510.8s。

以及一屏读不懂的输出（见 §3）：

```
总剩余：0 个未知时长        ← 连刷十余行
总剩余 ≈ 0 毫秒
（资源闸门变动）
正在运行 plugins/async-task:integration，剩余 0 毫秒
总剩余 ≈ 0 毫秒
（资源预算变动）
```

## 2. 并发 / 性能根因

### RC1 — 每次 `fount test` 都跑 `deno upgrade canary`（网络 + 竞争）
`path/src/cmd/test.ps1:9` / `test.sh:18` 无条件调 `deno_upgrade canary`（`path/src/deno.ps1:24`）。
- 每次调用都做一次 GitHub 版本查询；6 个 agent 并发时就是 6 个并发 `deno upgrade`，在 Windows 上还竞争替换同一个 `E:\deno.EXE`。
- 在手机热点/慢网下，`-q` 的静默升级可能长时间无输出，直接吃掉工具的 600s；升级过程中新内核 spawn 用了正在被替换的二进制 → `did not become healthy`（RC4 放大）。
- 本次 `E:\deno.EXE` 的 mtime 为 12:35（会话开始前），所以本会话没有 100MB 下载；但版本查询的往返开销与竞争是实打实的，且一旦 canary 前进就会变成下载。

### RC2 — 单内核全局队列 + CLI 同优先级 LIFO ⇒ 跨 job 饥饿
`kernel/queues.mjs:154` `peekReady`：同优先级时取数组**最后一个**（LIFO），而 `enqueueCli` 追加到尾部（`queues.mjs:68`）。
- 所有 agent 的 CLI job 共用同一个内核队列；后到的 job 永远先被取，先到的 job 在持续有新 job 到达时被饿死。
- 这就是 4 个 `checks:*` 排队 600s、以及 `前方还有 13/14 项` 的机制来源。交互式单人使用没问题，多 agent 并行时直接失效。

### RC3 — module-check 互斥锁「持有未 ready」上限 10 分钟，一个被杀的子进程冻结所有 Deno 套件
`kernel/module_check.mjs:10` `MODULE_CHECK_HOLD_TIMEOUT_MS = 10m`；`runtime.mjs:1069/1092/1165` 负责 acquire/consume/abandon。
- 设计上「at most one Deno process in spawn→JS-ready window」（denoland/deno#35804）。当持有租约的 Deno 子进程被杀/挂住、既没 POST ready 也不退出时，闸门要等满 10 分钟才自动放行。
- `plugins/context-compress` 的 `module-check missed ready` 正是此状态；其后的 4 个 `checks:*` 600s 超时与该窗口高度吻合。
- 根因是把「spawn→ready 窗口」的上限绑成了「整个 suite 的 idle watchdog」时长。模块检查正常只要数秒，10 分钟严重过长。

### RC4 — `ensureTestKernel` 健康检查预算只有 ~5s
`kernel/ensure.mjs:82-88`：50 × 100ms，第 24 次再 spawn 一次。
- 冷启动内核（加载模块图）在机器被 Playwright 套件打满时经常 >5s，于是抛 `did not become healthy`，agent 只能重试，进一步加剧竞争。

### RC5 — 重套件本身就很重，且 agent 倾向于整 manifest 全跑
`shells/code:frontend` 预期 `15m14s`（实测 15–22 min），`ui.spec.mjs` 单文件 76KB / 49–51 个 Playwright 用例、无 `subtests` 拆分；`shells/code:integration` 预期 4m55s。
- 该 agent 一次 `fount test shells/code`（33 min）+ frontend 3 次 + integration 2 次 ≈ 86 min，占其全部阻塞时间。
- 套件没拆 subtest ⇒ 无法用 `FOUNT_TEST_SUBTESTS` / trigger 只跑改动相关用例。

### RC6 — 被中断的运行不留日志 + overview 不流式 ⇒ agent 无法区分「排队 / 在跑 / 挂死」
- `plugins/async-task:integration`、`context-compress:integration` 的 state `logPath` 为 `null`（只有失败才留日志），被 abort 的运行更是无迹可寻，事后无法复盘。
- agent 用 `... | Select-String` / `Tee-Object | Select-Object -Last N` 管道包住 `fount test`，而 overview 模式不流式输出子进程 stdout，实时仪表盘被吞掉，只能干等超时（见 `kernel.md`、`display/`）。

### RC7 — Playwright `node` worker 不受 module-check 互斥保护
资源调度文档明确「Playwright `node` is not gated」。于是当另一个 Deno 进程正在物化共享 `node_modules/.deno` 时，frontend worker 可能读到半成品（本次的 `iconv-lite` 缺失）。agent_studio:frontend 因此失败重试。

### RC8 — `RUST_BACKTRACE=1` 污染失败日志
用户环境变量 `RUST_BACKTRACE=1`（User 级）。任何 deno 失败都会追加 11 行 `aws_lc_*_jent_entropy...` backtrace（见 `logs/checks/info.log`、`ms_literal.log`），是噪音不是崩溃。根 AGENTS 只说「手动 unset」，但框架没有在派生子进程时中和它。

## 3. 输出可读性根因（`总剩余：0 个未知时长` 刷屏）

### 关键点
非 TTY（agent / 管道 / CI）下，`fount test` 退化成「内核每一次调度抖动都逐行打印一次内部 ETA 与原因」，
其中 `未知时长 0 个` / `剩余 0 毫秒` 既不是进度、也不是错误，无法据此判断在跑/排队/卡住。

### 机制（为什么不显示）

1. **内核无差别广播**：`kernel/runtime.mjs:636 #broadcastSchedule` 在任意调度变化时给**每个** viewer 发 `schedule-update` —— `gate_state_changed`、`module_check_ready`（`:299`，每个套件模块检查就绪都发）、`resource_budget_changed`（`:661`）、`suite_started`、queue 增删、watchdog 等。当内核当前无任务时投影固定为 `{running:[], lastCompletionAt:null, unknownCount:0}`（`:644`）。
2. **坏的去重守卫**：`display/index.mjs:215` 的 `changed` 判断是
   `previousCompletionAt == null || nextCompletionAt == null || 5%阈值 || ≥500ms`。
   两端都为 `null`（未知）时**恒为 true** ⇒ 每一帧都重印。
3. **把退化的 ETA 当成信息打印**：`display/schedule.mjs:15` 在 `lastCompletionMs == null` 时打印 `总剩余：${count} 个未知时长`（count 常年为 0）；0 / 负值打印 `总剩余 ≈ 0 毫秒`。每次重印还会附带 reason 行（`（资源闸门变动）` / `（资源预算变动）` / `（模块检查就绪）` 等内部术语）以及每个在跑套件一行。
4. **没有面向 agent 的输出模式**：`display/index.mjs:44` 的仪表盘（能原地重绘、不刷屏）只在 `process.stdout.isTTY && supportsAnsi` 时启用。agent / CI / 管道永远走上面这条“逐行”路径。ETA 模型本身是非单调的（`resource-scheduling.md` 明确说这是设计），对人是可接受的抖动，对 agent 就是纯噪声。

### 目标（agent 一眼抓重点）

新增输出模式 `FOUNT_TEST_OUTPUT=human|plain|json`（非 TTY 默认 `plain`；`--json` 为其快捷方式）：

- `plain`（agent 默认）：只打离散、可行动事件——
  - accepted：`[test] selected 2/2 · run 2 · reuse 0 · blocked 0 · skip 0`
  - 排队：仅 `aheadCount` 变化时 `[test] waiting behind N other jobs`
  - 套件开始：`[test] ▶ key (eta 11s)`
  - 套件结束：`[test] ✓ key (13s)` / `[test] ✗ key — tail below`
  - 心跳：最多每 30s 且内容变化时 `[test] running 2 · queued 1 · elapsed 1m20s`
  - 收尾：`[test] done exit=0 · 2 passed · 0 failed · 31s · report data/test/report.md`
  - **完全丢弃 `schedule-update` 的 ETA / reason 行。**
- `json`：每事件一行 NDJSON（`{ts,type,key,status,elapsedMs,queue,aheadCount,exitCode}`），供 agent 直接解析而不是猜中文。
- `human`：现有 TTY 仪表盘，保持不变。

无论哪种模式，先修底层去重与退化值：

- `null === null` 视为未变化，不再重印（`display/index.mjs:215`）。
- `lastCompletionMs == null && unknownCount === 0` 或 `<= 0` 时不打印（`display/schedule.mjs:15-18`）。
- reason（含 detail）仅在 TTY 仪表盘显示，不进 plain/json。
- 终局摘要与失败尾部照旧保留 —— 那才是 agent 真正要抓的重点。

## 4. 修复规划

### P0（先做，直接消除 600s 空转与刷屏）

1. **`deno upgrade` 限频 + 串行 + 可跳过**（RC1）
   - `deno_upgrade`（`path/src/deno.ps1:24` / `deno.sh:160`）在真正升级前检查 `data/installer/deno_upgraded` 的 mtime 与记录的 channel/pin：未超过 `FOUNT_TEST_DENO_UPGRADE_INTERVAL`（默认 1h）且 channel/pin 未变 → 直接返回。`mark_deno_upgraded` 写入 `channel|pin|timestamp`。
   - 用现有包锁（`Enter-FountPkgLock` / `pkg_lock_acquire`）把升级段串行化，避免并发替换二进制。
   - 新增 `FOUNT_TEST_SKIP_DENO_UPGRADE=1` 逃生阀；CI 全新 checkout 无 marker，行为不变（仍升级）。
   - 验证：`path/test/runtime_update.test.mjs` 加「未过期不升级 / 过期升级 / pin 变化升级 / 锁串行」。

2. **module-check 闸门按「spawn→ready」而非「整个 suite」计时，且子进程退出即释放**（RC3）
   - `kernel/module_check.mjs`：把 `holdTimeoutMs` 从固定 10m 改成由实测均值导出的上限（如 `max(2m, 5×meanDurationMs)`；均值已有 `meanDurationMs()`）。
   - `runner/run_command.mjs` / `suite_run.mjs`：子进程 `exit`/`close` 事件即触发 `consumeMissedReady(ticket)`，不依赖 `runSuite` 的 Promise 结算；abort 时强制杀子进程树并 resolve。
   - 释放/超时打独立 kernel 事件与日志，让「谁泄漏了闸门」可见。
   - 验证：`testkit` 加「杀子进程后闸门 <N 秒释放，后续 Deno 套件不被冻结」的 selftest。

3. **内核队列跨 job 公平（按 job 年龄 FIFO，job 内保留 LIFO）**（RC2）
   - `kernel/queues.mjs` `peekReady`：同优先级、同 ready 时，优先 `jobId` 对应 job 最早入队的那一项（给 `QueueItem` 带 `jobEnqueuedAt`）。单 job 内维持现有 LIFO。
   - 验证：`selftest/queues.test.mjs` 断言「旧 job 的项不会被新 job 持续插队」。

4. **agent 友好输出：`FOUNT_TEST_OUTPUT=plain|json` + 去重/退化值修复**（§3）
   - `display/index.mjs`：加输出模式；非 TTY 默认 `plain`；`plain`/`json` 不消费 `schedule-update` 的 ETA/reason（改为 30s 心跳）；修正 `changed` 守卫。
   - `display/schedule.mjs`：仅在 TTY 且有实义 ETA 时打印；跳过 `null+unknownCount==0` 与 `<=0`；reason 只在仪表盘。
   - `kernel/runtime.mjs:636`：无任务 / 无变化时不广播空投影（`{running:[],lastCompletionAt:null,unknownCount:0}`），减少无谓事件。
   - 验证：管道运行 `fount test checks:theme_radius | Out-String`，断言输出不含 `未知时长` / `剩余 0 毫秒` / `资源闸门变动` 之类 token；`--json` 输出可被 `JSON.parse` 逐行解析。

### P1（消除误报与重试）

5. **`ensureTestKernel` 预算调大并区分「端口被占但不是内核」**（RC4）
   - 默认健康等待从 ~5s 提到 ~30s（可 `FOUNT_TEST_KERNEL_ENSURE_MS` 覆盖）；spawn 失败时输出子进程 stderr；探测到监听但 `/health` 非本内核时，先 kill 再 spawn，而不是盲目再 spawn。

6. **拆分 `shells/code:frontend` 并加子测试触发**（RC5）
   - 把 `ui.spec.mjs`（76KB）按主题拆成多个 spec 或在该 suite 下用 `subtests` 声明 `{ name, triggers, spec }`，让 `FOUNT_TEST_SUBTESTS` / trigger 只跑改动相关 spec。
   - 复用页 fixture、在 file 内提高并行度（当前 1 worker）；维持「system Chrome/Edge，不 `playwright install`」约束。

7. **中断/失败都写 per-run 日志 + 稳定心跳行**（RC6，与 P0-4 共用）
   - abort 时也落盘 suite 尾部输出（仿 `#withSuiteLog`）。
   - 在 `src/scripts/test/AGENTS.md` 明确「不要用 `Select-String`/`Tee` 包裹 `fount test`；要进度用 `--watch`、`FOUNT_TEST_OUTPUT=json` 或读 `data/test/state/logs/`」。

### P2（环境清理）

8. **让 Playwright node 启动与 module-check 互斥协同**（RC7）：frontend 启动前确保共享 `.deno` 稳定（或把 node worker 纳入同一闸门），并对其「module not found」错误类做一次自动重试。

9. **派生子进程时中和 `RUST_BACKTRACE`**（RC8）：在 `src/scripts/test/env.mjs` / `deno/no_dom_shim.mjs` 的 preload 里 `delete process.env.RUST_BACKTRACE`（或强制空），失败日志不再带 `aws_lc_*` backtrace。

## 5. 验收

- 并发冒烟：同时发起 4 个 `fount test checks:<x>` 与 1 个长套件，断言没有一次被 600s 工具超时杀掉（P0-2/P0-3 之后应稳定通过）。
- 单调用开销：在空闲机器上，`checks:theme_radius` 墙钟与其基线（~8s）差距 < 2×；`fount test` 不再每次触发网络升级查询（P0-1）。
- 输出整洁：管道运行单个 check，输出行数 ≤ 10，且不含 `未知时长` / `剩余 0 毫秒` / `资源闸门变动`（P0-4）；`--json` 每行可解析。
- `fount test testkit` 全绿，新增 selftest 覆盖 P0-2 / P0-3 / P0-4。
- 失败日志无 `aws_lc_*` backtrace（P2-9）。

## 6. 关联

- 资源调度 / module-check 现状：[resource-scheduling.md](../../src/scripts/test/docs/resource-scheduling.md)
- 内核 / 队列 / idle 退出 / 显示：[kernel.md](../../src/scripts/test/docs/kernel.md)
- 上游 Deno node_modules 竞态：[denoland/deno#35804](https://github.com/denoland/deno/issues/35804)
