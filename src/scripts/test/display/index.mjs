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
import { paintAccepted, paintJobDone, paintJobWait, paintSuiteEnd, splitSuiteKey, suiteEndHasFailureOutput } from './paint.mjs'
import { paintScheduleUpdate } from './schedule.mjs'

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
	/** @type {string | null} */
	let jobId = null
	const done = Promise.withResolvers()
	let finished = 0
	/** @type {{ key: string, output: string }[]} */
	const failureLogs = []
	/** @type {number | null} */
	let lastAheadCount = null
	/** 上次展示的 lastCompletionMs（5% 阈值用）。 */
	let lastCompletionMs = null

	beginTestProgress()

	/**
	 * 非 watch 只画本 job；hello/accepted 之前丢掉带 jobId 的外来事件。
	 * @param {object} message 内核事件
	 * @returns {boolean} 是否属于本次显示
	 */
	function displayEventForThisView(message) {
		if (watch) return true
		if (message.type === 'accepted') return true
		if (message.jobId && jobId && message.jobId !== jobId) return false
		if (message.jobId && !jobId) return false
		return true
	}

	/**
	 * @param {object} message accepted
	 * @returns {void}
	 */
	function onAccepted(message) {
		runCount = message.runCount ?? 0
		displayMode = message.mode || displayMode
		jobId = message.jobId ?? jobId
		paintAccepted(message)
		if (message.reportPath)
			console.logI18n('fountConsole.test.reportPath', { path: message.reportPath })
	}

	/**
	 * @param {object} message log
	 * @returns {void}
	 */
	function onLog(message) {
		if (displayMode !== 'stream') {
			if (displayShouldResolve(message, { watch, displayMode, job, runCount }))
				done.resolve()
			return
		}
		if (message.stream === 'stderr') process.stderr.write(message.chunk ?? '')
		else process.stdout.write(message.chunk ?? '')
	}

	/**
	 * @param {object} message suite-start
	 * @returns {void}
	 */
	function onSuiteStart(message) {
		const expected = formatMs(message.expectedMs)
		const { manifestId, name } = splitSuiteKey(message.key)
		console.logI18n('fountConsole.test.runningSuite.base', { manifestId, name })
		console.logI18n('fountConsole.test.runningSuite.expected', { expected })
	}

	/**
	 * @param {object} message schedule-update
	 * @returns {void}
	 */
	function onScheduleUpdate(message) {
		const next = message.lastCompletionMs
		const changed = lastCompletionMs == null || next == null
			|| Math.abs(next - lastCompletionMs) / Math.max(1, lastCompletionMs) > 0.05
		if (!changed) return
		paintScheduleUpdate(message, lastCompletionMs)
		lastCompletionMs = next
	}

	/**
	 * @param {object} message suite-end
	 * @returns {void}
	 */
	function onSuiteEnd(message) {
		finished++
		if (runCount) SetTaskbarProgress(Math.min(100, Math.floor((finished / runCount) * 100)))
		if (displayMode !== 'stream' && suiteEndHasFailureOutput(message))
			failureLogs.push({ key: message.key, output: message.output })
		paintSuiteEnd(message, { stream: displayMode === 'stream' })
	}

	/**
	 * @param {object} message queue-append / queue-remove
	 * @returns {void}
	 */
	function onQueue(message) {
		if (displayMode !== 'overview') {
			if (displayShouldResolve(message, { watch, displayMode, job, runCount }))
				done.resolve()
			return
		}
		if (!watch) return
		console.logI18n(
			message.type === 'queue-append' ? 'fountConsole.test.queue.append' : 'fountConsole.test.queue.remove',
			{ label: message.key, reason: message.reason || '' },
		)
	}

	/**
	 * @param {object} message job-wait
	 * @returns {void}
	 */
	function onJobWait(message) {
		if (message.aheadCount === lastAheadCount) return
		lastAheadCount = message.aheadCount
		paintJobWait(message)
	}

	/**
	 * @param {object} message cleanup-leak
	 * @returns {void}
	 */
	function onCleanupLeak(message) {
		console.errorI18n('fountConsole.test.cleanupLeak', {
			paths: message.leaks.join('\n'),
		})
	}

	/**
	 * @param {object} message job-done
	 * @returns {void}
	 */
	function onJobDone(message) {
		exitCode = message.exitCode ?? 0
		paintJobDone({
			...message,
			failureLogs: displayMode === 'stream' ? [] : failureLogs,
		})
		if (displayShouldResolve(message, { watch, displayMode, job, runCount }))
			done.resolve()
	}

	const handlers = new Map([
		['accepted', onAccepted],
		['log', onLog],
		['suite-start', onSuiteStart],
		['suite-end', onSuiteEnd],
		['schedule-update', onScheduleUpdate],
		['queue-append', onQueue],
		['queue-remove', onQueue],
		['job-wait', onJobWait],
		['cleanup-leak', onCleanupLeak],
		['job-done', onJobDone],
	])

	ws.addEventListener('message', event => {
		const message = JSON.parse(String(event.data))
		if (!displayEventForThisView(message)) return
		const handler = handlers.get(message.type)
		if (handler) handler(message)
		else if (displayShouldResolve(message, { watch, displayMode, job, runCount }))
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
