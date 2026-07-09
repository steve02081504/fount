/** 测试进程标记：须在导入 server/i18n 之前 side-effect import。 */
import process from 'node:process'
import v8 from 'node:v8'

import { unset_shutdown_listener } from 'npm:on-shutdown'

import { heapSnapshotDir } from './core/paths.mjs'
import { REPO_ROOT } from './core/repo_root.mjs'
import { installNearOomHeapSnapshot } from './heap_snapshot_watch.mjs'

process.env.FOUNT_TEST ??= '1'

/** 测试统一锁定 zh-CN，保证报告与 i18n 字符串断言稳定（bare.mjs 以 LANG 为首选，子进程继承 process.env）。 */
process.env.LANG = 'zh-CN'

/** deno panic 时输出完整 Rust 栈帧；子进程 spawn 时继承 process.env。 */
process.env.RUST_BACKTRACE ??= 'full'

/** 测试节点 worker 自带堆上限；orchestrator / live driver 用 heap_size_limit 或 FOUNT_TEST_ORCHESTRATOR_HEAP_MB。 */
if (!process.env.FOUNT_TEST_NODE_WORKER) {
	for (const event of ['uncaughtException', 'unhandledRejection', 'error']) {
		unset_shutdown_listener(event)
		process.on(event, err => console.error(`${event}:`, err))
	}
	const rawMb = process.env.FOUNT_TEST_ORCHESTRATOR_HEAP_MB
	installNearOomHeapSnapshot({
		/** @returns {number} 堆上限字节 */
		resolveLimitBytes: () => {
			const parsed = Number(rawMb)
			if (Number.isFinite(parsed) && parsed > 0) return parsed * 1024 * 1024
			return v8.getHeapStatistics().heap_size_limit
		},
		destDir: heapSnapshotDir(REPO_ROOT),
		label: 'orchestrator',
	})
}
