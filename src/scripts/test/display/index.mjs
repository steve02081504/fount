/**
 * 测试显示层：连内核 WS，按 1 / 多个 / 0 指定（及 watch）画终端。
 * 不要 import env.mjs（编排器堆快照路径）。
 */
import process from 'node:process'

import { console } from '../../i18n/bare.mjs'
import { ClearTaskbarProgress, SetTaskbarProgress } from '../../taskbar_progress.mjs'
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
	/** 波次内单调的进度百分位（每次 accepted 重置）。 */
	let shownPct = null
	/** 上次写入任务栏的状态（去重用：值未变不重写 OSC，避免空闲抖动）。 */
	let lastTaskbarState = null
	/** 本波绝对完成时刻（事件 lastCompletionAt 的 epoch ms；空闲/未知为 null）。 */
	let lastCompletionAt = null
	/** 进度条起始时刻（每波 accepted 重置）。 */
	let progressStartedAt = null
	/** 进度刷新定时器（链式 setTimeout，空闲时停住，等新事件再唤醒）。 */
	let progressTimer = null

	beginTestProgress()

	/**
	 * 把任务栏进度写入（带去重：值未变化不重写 OSC，避免空闲时高频抖动）。
	 * @param {'spinner' | 'clear' | number} state 要显示的状态
	 * @returns {void}
	 */
	function writeTaskbar(state) {
		if (state === lastTaskbarState) return
		lastTaskbarState = state
		if (state === 'spinner') SetTaskbarProgress(undefined)
		else if (state === 'clear') ClearTaskbarProgress()
		else SetTaskbarProgress(state)
	}

	/**
	 * 当前波次进度百分比（以绝对完成时刻为基准）。
	 * @returns {number | null} 0..100；起点或完成目标未知时为 null
	 */
	function currentPercent() {
		if (progressStartedAt == null || lastCompletionAt == null) return null
		const target = lastCompletionAt
		if (target <= progressStartedAt) return 100
		const percentage = Math.floor(((Date.now() - progressStartedAt) / (target - progressStartedAt)) * 100)
		return Math.min(100, Math.max(0, percentage))
	}

	/**
	 * 按当前波次进度刷新任务栏；空闲（无完成目标）时保持上次百分比、不重写。
	 * @returns {void}
	 */
	function setTimeProgress() {
		if (progressStartedAt == null) return
		const percentage = currentPercent()
		if (percentage == null) {
			if (shownPct != null) writeTaskbar(shownPct)
			return
		}
		shownPct = shownPct == null ? percentage : Math.max(shownPct, percentage)
		writeTaskbar(shownPct)
	}

	/**
	 * 计算下一次刷新间隔：Max(200ms, 本波总时长×1%)。
	 * @returns {number} 毫秒
	 */
	function nextRefreshDelay() {
		if (progressStartedAt == null || lastCompletionAt == null) return 200
		const total = Math.max(1, lastCompletionAt - progressStartedAt)
		return Math.max(200, Math.round(total * 0.01))
	}

	/**
	 * 立即刷新一次并安排下一次；无完成目标（空闲）时停住，等新事件再唤醒。
	 * @returns {void}
	 */
	function scheduleProgressRefresh() {
		if (progressTimer != null) clearTimeout(progressTimer)
		setTimeProgress()
		if (progressStartedAt == null || lastCompletionAt == null) {
			progressTimer = null
			return
		}
		progressTimer = setTimeout(() => {
			progressTimer = null
			scheduleProgressRefresh()
		}, nextRefreshDelay())
	}

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
		// 每波独立基准：进度条从本波重新起步，避免跨波累计/残留旧值。
		progressStartedAt = Date.now()
		shownPct = null
		lastTaskbarState = null
		lastCompletionAt = null
		scheduleProgressRefresh()
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
		const nextCompletionAt = message.lastCompletionAt ? Date.parse(message.lastCompletionAt) : null
		const previousCompletionAt = lastCompletionAt
		// 相对 5% 或绝对 ≥500ms 之一变化才重印剩余文案，避免接近结束时高频重画。
		const changed = previousCompletionAt == null || nextCompletionAt == null
			|| Math.abs(nextCompletionAt - previousCompletionAt) / Math.max(1, previousCompletionAt) > 0.05
			|| Math.abs(nextCompletionAt - previousCompletionAt) >= 500
		lastCompletionAt = nextCompletionAt
		if (changed) paintScheduleUpdate(message, previousCompletionAt)
		// 任务栏进度始终随计时推进（单调不回退），顺道刷新一次并重置计时。
		if (progressStartedAt != null) scheduleProgressRefresh()
	}

	/**
	 * @param {object} message suite-end
	 * @returns {void}
	 */
	function onSuiteEnd(message) {
		finished++
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
	if (progressTimer != null) clearTimeout(progressTimer)
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
