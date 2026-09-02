/**
 * 测试内核进程入口：独占 hub 口；EADDRINUSE 则立刻以 0 退出。
 */
import 'fount/scripts/test/env.mjs'

import process from 'node:process'

import { TEST_HUB_PORT } from '../hub/index.mjs'

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

try {
	const handle = await startTestKernel({
		port,
		autoExit: process.env.FOUNT_TEST_KERNEL_NO_EXIT !== '1',
		watchFs: process.env.FOUNT_TEST_KERNEL_WATCH_FS !== '0',
		idleExitGraceMs,
		onPhase: markPhase,
	})
	markPhase('startReady')
	if (phaseFile) {
		const { writeFileSync } = await import('node:fs')
		writeFileSync(phaseFile, JSON.stringify({ timeOrigin: performance.timeOrigin, phases }), 'utf8')
	}
	await handle.closed
	process.exit(0)
}
catch (error) {
	if (error?.code === 'EADDRINUSE')
		process.exit(0)
	console.error(error)
	process.exit(1)
}
