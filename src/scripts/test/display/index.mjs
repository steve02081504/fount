/**
 * 测试显示层：连内核 WS，按 1 / 多个 / 0 指定（及 watch）画终端。
 * 不要 import env.mjs（编排器堆快照路径）。
 */
import process from 'node:process'

import { console } from '../../i18n/bare.mjs'
import { SetTaskbarProgress } from '../../taskbar_progress.mjs'
import { formatDuration } from '../core/format_duration.mjs'
import { beginTestProgress, finishTestProgress } from '../core/progress.mjs'
import { testHubUrl } from '../hub/index.mjs'

import { displayShouldResolve, resolveDisplayMode } from './mode.mjs'
import { formatRemainingLabel, paintAccepted, paintJobDone, paintSuiteEnd, splitSuiteKey, suiteEndHasFailureOutput } from './paint.mjs'

/**
 * @typedef {object} DisplayOptions
 * @property {boolean} [watch] 是否 watch 挂起
 * @property {object} [job] 提交给内核的 job
 * @property {number} [port] 内核端口
 */

/**
 * 连接内核并显示直到该次调用该退出。
 * @param {DisplayOptions} options 选项
 * @returns {Promise<number>} 退出码
 */
export async function runTestDisplay({ watch = false, job, port } = {}) {
	const url = `${testHubUrl(port).replace(/^http/, 'ws')}/ws/viewer`
	const ws = new WebSocket(url)
	await new Promise((resolve, reject) => {
		ws.addEventListener('open', resolve, { once: true })
		ws.addEventListener('error', () => reject(new Error(`cannot connect test kernel at ${url}`)), { once: true })
	})

	let exitCode = 0
	let runCount = 0
	let displayMode = resolveDisplayMode({ watch, job })
	const done = Promise.withResolvers()
	let finished = 0
	/** @type {{ key: string, output: string }[]} */
	const failureLogs = []

	beginTestProgress()

	ws.addEventListener('message', event => {
		const msg = JSON.parse(String(event.data))
		if (msg.type === 'accepted') {
			runCount = msg.runCount ?? 0
			displayMode = msg.mode || displayMode
			paintAccepted(msg)
			if (msg.reportPath)
				console.logI18n('fountConsole.test.reportPath', { path: msg.reportPath })
			return
		}
		if (msg.type === 'log' && displayMode === 'stream') {
			if (msg.stream === 'stderr') process.stderr.write(msg.chunk ?? '')
			else process.stdout.write(msg.chunk ?? '')
			return
		}
		if (msg.type === 'suite-start') {
			const expected = formatMs(msg.expectedMs)
			const remaining = formatRemainingLabel(msg)
			const { manifestId, name } = splitSuiteKey(msg.key)
			console.logI18n('fountConsole.test.runningSuite.base', { manifestId, name })
			if ((msg.unknownCount ?? 0) > 0 && (msg.remainingMs == null || !Number.isFinite(msg.remainingMs)))
				console.logI18n('fountConsole.test.display.etaUnknown', {
					expected,
					count: msg.unknownCount,
				})
			else
				console.logI18n('fountConsole.test.display.eta', { expected, remaining })
			return
		}
		if (msg.type === 'suite-end') {
			finished++
			if (runCount) SetTaskbarProgress(Math.min(100, Math.floor((finished / runCount) * 100)))
			if (suiteEndHasFailureOutput(msg))
				failureLogs.push({ key: msg.key, output: msg.output })
			paintSuiteEnd(msg, { stream: displayMode === 'stream' })
			return
		}
		if ((msg.type === 'queue-append' || msg.type === 'queue-remove') && displayMode === 'overview') {
			console.logI18n(
				msg.type === 'queue-append' ? 'fountConsole.test.queue.append' : 'fountConsole.test.queue.remove',
				{ label: msg.key, reason: msg.reason || '', remaining: formatRemainingLabel(msg) },
			)
			return
		}
		if (msg.type === 'job-done') {
			exitCode = msg.exitCode ?? 0
			paintJobDone({
				...msg,
				failureLogs: displayMode === 'stream' ? [] : failureLogs,
			})
			if (displayShouldResolve(msg, { watch, displayMode, job, runCount }))
				done.resolve()
			return
		}
		if (displayShouldResolve(msg, { watch, displayMode, job, runCount }))
			done.resolve()
	})

	ws.addEventListener('close', () => done.resolve())
	/** Ctrl+C / kill 时断开 WS。 */
	const onSig = () => {
		ws.close()
		done.resolve()
	}
	process.on('SIGINT', onSig)
	process.on('SIGTERM', onSig)

	ws.send(JSON.stringify({ type: 'hello', watch, job: watch ? undefined : job }))
	await done.promise
	process.off('SIGINT', onSig)
	process.off('SIGTERM', onSig)
	if (ws.readyState === WebSocket.OPEN) ws.close()
	finishTestProgress(exitCode)
	return exitCode
}

/**
 * @param {number | null | undefined} ms 毫秒
 * @returns {string} 可读时长
 */
function formatMs(ms) {
	if (ms == null || !Number.isFinite(ms)) return '?'
	return formatDuration(ms)
}
