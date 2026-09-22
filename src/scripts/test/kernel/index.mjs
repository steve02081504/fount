/**
 * 测试内核进程入口：独占 hub 口；EADDRINUSE 则立刻以 0 退出。
 */
import 'fount/scripts/test/env.mjs'

import process from 'node:process'

import { REPO_ROOT } from '../core/repo_root.mjs'
import { TEST_HUB_PORT } from '../hub/index.mjs'

import { maybeUpgradeDeno } from './deno_update.mjs'
import { spawnDetachedKernel } from './ensure.mjs'
import { startTestKernel } from './server.mjs'

const port = Number(process.env.FOUNT_TEST_HUB_PORT) || TEST_HUB_PORT

/** 空闲自动退出宽限（毫秒；默认 7 分钟）。 */
const idleExitMs = Number(process.env.FOUNT_TEST_KERNEL_IDLE_EXIT_MS)
const idleExitGraceMs = Number.isFinite(idleExitMs) && idleExitMs > 0 ? idleExitMs : undefined

/** 内核启动相位记录（bench 工具用；未设 env 时为零开销空操作）。 */
const phaseFile = process.env.FOUNT_TEST_BENCH_PHASES_FILE
/** @type {Record<string, number>} 相位名 → 相对 timeOrigin 毫秒 */
const phases = {}
/**
 * @param {string} name 相位名
 * @returns {void}
 */
const markPhase = name => {
	if (phaseFile) phases[name] = performance.now()
}
markPhase('mainEval')

/** Deno 升级成功后是否需要在退出前拉起新内核。 */
let restartRequested = false

try {
	const handle = await startTestKernel({
		port,
		autoExit: process.env.FOUNT_TEST_KERNEL_NO_EXIT !== '1',
		watchFs: process.env.FOUNT_TEST_KERNEL_WATCH_FS !== '0',
		idleExitGraceMs,
		/**
		 * @param {string} reason 触发原因（startup / drain）
		 * @returns {Promise<{ status: string, changed: boolean }>} 更新结果
		 */
		denoUpdater: reason => maybeUpgradeDeno({ repoRoot: REPO_ROOT, reason }),
		onPhase: markPhase,
	})
	markPhase('startReady')
	if (phaseFile) {
		const { writeFileSync } = await import('node:fs')
		writeFileSync(phaseFile, JSON.stringify({ timeOrigin: performance.timeOrigin, phases }), 'utf8')
	}
	/**
	 * Deno 升级成功（且当时空闲）→ 关掉内核，端口释放后由下方拉起新内核再退出。
	 * @returns {void}
	 */
	handle.kernel.onRestartRequested = () => {
		restartRequested = true
		void handle.close()
	}
	// 内核启动时检查一次 Deno 更新（异步、不阻塞服务）。
	void handle.kernel.checkDenoUpdate('startup')
	await handle.closed
	if (restartRequested)
		try {
			await spawnDetachedKernel(port)
		}
		catch (error) {
			console.error(`failed to restart test kernel after deno update: ${String(error?.message ?? error)}`)
		}

	process.exit(0)
}
catch (error) {
	if (error?.code === 'EADDRINUSE')
		process.exit(0)
	console.error(error)
	process.exit(1)
}
