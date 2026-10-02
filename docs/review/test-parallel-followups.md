# 多开发任务并行测试的后续事项

本次已修复：队首资源不足阻塞后续 job、预算刷新不唤醒等待者、物理内存预算漏计交换空间，以及 serial 首个 worker / heavy 单元租约的死锁与回收问题。以下项目需要较大范围的设计或上游修复。

## △ Deno 启动检查仍需短暂串行

- 日常影响：多个 agent 同时提交大量 Deno 测试时，spawn → JS-ready 阶段仍排队；测试正文已经允许并行。
- 证据：`src/scripts/test/kernel/module_check.mjs`、`hub/clients/module_check.mjs`；上游 [denoland/deno#35804](https://github.com/denoland/deno/issues/35804)。当前仓库的 `docs/upstream-blockers.md` 还记录了 ready 后懒加载依赖的竞态。
- 不是测试全文串行，也不能直接删掉互斥：共享自动生成的 `node_modules/.deno` 可能损坏。
- 后续：上游修复后验证多个 CLI 与 serial worker 同时冷启动，再统一去掉启动闸门并调整 ETA 模拟、自测和文档。若先做独立依赖目录，则需另外设计动态 URL/npm 依赖、磁盘成本和回收流程。

## △ 资源画像与实时性能仍有偏差

- 日常影响：CPU 使用历史均值/manifest 预订，内存画像使用 RSS；开启交换空间后，RSS 不包含已换出的提交量。机器处于不同负载时，预算可能偏保守或高估余量。
- 证据：`core/proc_sample.mjs` 的 `lastTreeRssBytes`、`finish()`，`core/resources.mjs`，`runner/scheduler.mjs` 的二维预算；全局 CPU 上限仍为 85%。
- 不是把整块空闲磁盘视为内存：本次只使用 OS 提供的已配置分页/交换容量，Windows 使用提交余量。
- 后续：采集提交量与瞬时全机 CPU/磁盘分页压力；区分尚未启动的资源预订和已开始任务的实测消耗，设计有滞回、有限增量的反馈准入，防止瞬时低负载造成大量超发。加入长期等待大任务的 aging，避免持续小任务填缝让大任务饥饿。

## △ 并行 job 的无标记临时目录泄漏归属仍不完整

- 已修复：`origin.txt` 增加 job ID，套件子进程通过 `FOUNT_TEST_CLEANUP_OWNER` 继承归属。job 完成时立即扫描自己的有标记目录，即使还有其它套件运行也会在该 job 的 `cleanup-leak` / `job-done` 中报告退出码 3；其它 job 的目录不会被误报，也不会因为后来 job 的 baseline 包含该路径而漏掉。
- 日常影响：无归属标记的旧目录、写标记失败的目录与 `ms-playwright` 仍只能在无其它套件运行且非嵌套并行环境时按 baseline 扫描；较早结束的 job 留下这类残留时仍可能漏报。
- 证据：`kernel/runtime.mjs` 的 `#finishJob` / `#checkCleanupLeak`，`core/cleanup_check.mjs`、`core/temp_origin.mjs`、`runner/suite_run.mjs`；`selftest/kernel_lifecycle.test.mjs` 的真实双 job 回归与 `selftest/cleanup_check.test.mjs` 的归属/基线回归。
- 不是要求对运行中套件直接扫目录并报错，那会把仍在使用的目录误报为泄漏。
- 后续：补齐没有调用来源标记的创建点，或为无标记残留设计队列排空后的延迟扫描与报告归属；不能让内嵌测试内核的 job 等待父套件结束才返回，否则会造成父子相互等待。
