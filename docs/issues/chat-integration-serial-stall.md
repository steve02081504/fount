# `shells/chat:integration` 跑不完：慢 + 600 秒空闲看门狗误杀

> 2026-10-09 观察并当天修正过一次结论。只影响 `fount test` 这条路；单独跑测试文件是好的。不阻塞日常开发，改到该套件时留意即可。

## 现象

`fount test shells/chat:integration` 当天 5 次没跑完，形态是：

- 套件日志 `data/test/state/logs/shells_chat/integration.log` 停在某个文件之后不再增长；被杀的轮次分别停在 `channel_create_folded_anchor.test.mjs`、`local_plugins.test.mjs` 之后。
- 内核对它报 `terminated`：`已终止 shells/chat:integration：超过 10 分钟无 stdall 输出`，`data/test/state/main.json` 里 `terminated: true`。
- 观察窗口内 runner（`serial.mjs`）CPU 近乎不涨（10 分钟累计 < 3 秒）。**这一条曾经把我带偏**：见下。

## 修正后的结论

**runner 没死锁，是这轮太慢，被 600 秒空闲看门狗提前打死。** 第 5 次运行的完整 stdout 显示：它一路跑到 18 分 45 秒，`chat_e2e_3node` → `dag_concurrent_append` → `display_snapshot` 都是逐个 `[serial] ok`，期间 stdout 出现过 10 分钟以上的静默（`chat_e2e_3node` 起跑前那段），正好踩中看门狗；而我在静默窗口里采到的"CPU 0%"只是爆发之间的空档。

也就是说：这个套件在本机（多个 3 节点 E2E + 大量文件 fsync）本来就要 18 分钟以上，而一半以上的事件在 stdout 上成簇出现。**看门狗按"没有新 stdall"判空闲，判不出"某个测试正在跑但还不打印"。**

## 已排除

- **不是本次改动的三个新测试**：`runtime_federation` / `runtime_message_commit` / `ecdh_federated_admin` 单独跑全绿；按字母序它们在 `r` 段，而每次被杀都在 `c`/`l` 段之前。
- **不是单文件本身**：把 `test/integration/` 按字母序逐文件用 `deno test` 跑（独立进程、240s 超时），前 12 个文件全部通过，含被杀点两侧的 `channel_create_folded_anchor`、`channel_key_rotate_fold_window`、`local_plugins`、`leave_checkpoint`、`leave_cleans_group_dir`。
- 同一时间 `shells/chat:pure`、`shells/home:integration`、`checks:text_lf` 都正常跑完。

## 要注意的其他两个坑

1. **看门狗杀掉套件后 `fount test` 的 CLI 进程不会自己结束**（`main.json` 已写 `terminated: true`），会继续占着内核队列；后续 selector 会排在一轮注定失败的运行后面。排查前先确认 / 收掉它（`fount test --kernel reboot` 或结束那个 deno 进程）。
2. **收尾阶段还报了一个与本次改动无关的 temp 泄漏**，让整轮 exit=3：`cleanup leak: %TEMP%\fount-p2p-shutdown-exit-*`（名字指向 p2p shutdown 退出路径留下的临时目录）。

## 怎么取证

1. 起一轮 `fount test shells/chat:integration`，别同时压别的 serial 套件。
2. 别只看 CPU 快照：`Get-CimInstance Win32_Process` 看有没有子 `deno test` 进程，内核 `/status`（`http://127.0.0.1:8903/status`）看 `runningSuites[].elapsedMs` 是否在涨；**同时**给日志记 mtime，三者对照才能区分"慢"和"卡住"。
3. 要判定真死锁，得看到：没有子进程 + CPU 长时间不做功 + `elapsedMs` 在涨 + 日志 mtime 不动。只有前两条不构成结论（爆发式输出会骗人）。

## 不要做的事

- 不要为了让它变绿去挪 / 删测试文件、加 `sleep` 或重试——掩盖真实用时不会让套件变快。
- 不要用"再跑一次就好了"当结论，也不要照着上一版结论去找死锁：先按上面的三路对照确认这一轮到底是慢还是卡。
