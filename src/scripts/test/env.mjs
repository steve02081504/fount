/** 测试进程标记：须在导入 server/i18n 之前 side-effect import。 */
import process from 'node:process'

import { unset_shutdown_listener } from 'npm:on-shutdown'

import { heapSnapshotDir } from './core/paths.mjs'
import { REPO_ROOT } from './core/repo_root.mjs'
import { installNearOomHeapSnapshot } from './heap_snapshot.mjs'

process.env.FOUNT_TEST ??= '1'

/** 测试统一锁定 zh-CN，保证报告与 i18n 字符串断言稳定（bare.mjs 以 LANG 为首选，子进程继承 process.env）。 */
process.env.LANG = 'zh-CN'

/** deno panic 时输出完整 Rust 栈帧；子进程 spawn 须经 childEnv() 显式传递。 */
process.env.RUST_BACKTRACE = 'full'

/**
 * 测试子进程环境：继承当前 process.env 并强制 RUST_BACKTRACE=full。
 * @param {Record<string, string>} [extra] 额外变量
 * @returns {Record<string, string>} spawn env
 */
export function childEnv(extra = {}) {
	return { ...process.env, RUST_BACKTRACE: 'full', ...extra }
}

/** 近 OOM 堆快照：worker 写 CWD、父进程 collect；orchestrator 直接搬迁到 heapsnapshots/。 */
if (process.env.FOUNT_TEST_NODE_WORKER)
	installNearOomHeapSnapshot({})
else {
	for (const event of ['uncaughtException', 'unhandledRejection', 'error']) {
		unset_shutdown_listener(event)
		process.on(event, err => console.error(`${event}:`, err))
	}
	installNearOomHeapSnapshot({
		destDir: heapSnapshotDir(REPO_ROOT),
		label: 'orchestrator',
	})
}
