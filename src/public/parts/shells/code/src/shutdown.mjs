import process from 'node:process'

import { on_shutdown } from 'npm:on-shutdown'

/** 信号触发的关闭必须立即中断；普通 process.exit 可等当前轮完成。 */
let signaled = false
let stopping = false
for (const name of ['SIGINT', 'SIGTERM', 'SIGHUP'])
	process.on(name, () => { signaled = name })

/** @returns {boolean} 是否停止启动新一轮 AI 调用。 */
export function isCodeStopping() { return stopping }

/**
 * 注册 code shell 的关闭屏障：先通知 agent 循环，再等待运行落盘。
 * @param {() => Iterable<{controller: AbortController, finished: Promise<void>, markInterrupted: (reason: string) => void}>} getRuns 运行快照
 * @returns {void}
 */
export function registerCodeShutdown(getRuns) {
	on_shutdown(async () => {
		stopping = true
		const runs = [...getRuns()]
		for (const run of runs) run.markInterrupted(signaled || 'restart')
		if (signaled) for (const run of runs) run.controller.abort()
		const settled = Promise.allSettled(runs.map(run => run.finished))
		if (!signaled) await settled
		else {
			let timer
			try { await Promise.race([settled, new Promise(resolve => { timer = setTimeout(resolve, 3000) })]) }
			finally { clearTimeout(timer) }
		}
	})
}
