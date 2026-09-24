import process from 'node:process'

import { on_shutdown } from 'npm:on-shutdown'

import { markStopping } from '../../../../../scripts/stopping.mjs'

/** 首次收到的退出信号名（普通退出为 null）。 */
let signaled = null
for (const name of ['SIGINT', 'SIGTERM', 'SIGHUP'])
	process.on(name, () => { signaled ??= name })

/**
 * 注册 code shell 的关闭屏障：先停止启动新轮次，再等待运行落盘。
 * 普通退出可自由等待；信号退出立即中断并最多等待 3 秒收尾。
 * @param {() => Iterable<{controller: AbortController, finished: Promise<void>, markInterrupted: (reason: string) => void}>} getRuns - 运行快照。
 * @returns {void}
 */
export function registerCodeShutdown(getRuns) {
	on_shutdown(async () => {
		markStopping()
		const runs = [...getRuns()]
		for (const run of runs) run.markInterrupted(signaled || 'restart')
		if (signaled) for (const run of runs) run.controller.abort()
		const settled = Promise.allSettled(runs.map(run => run.finished))
		if (!signaled) return void await settled
		let timer
		try { await Promise.race([settled, new Promise(resolve => { timer = setTimeout(resolve, 3000) })]) }
		finally { clearTimeout(timer) }
	})
}
