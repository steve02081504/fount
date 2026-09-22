/**
 * 测试显示层：连内核 WS，按 1 / 多个 / 0 指定（及 watch）画终端。
 * 不要 import env.mjs（编排器堆快照路径）。
 */
import process from 'node:process'

import supportsAnsi from 'npm:supports-ansi'

import { console, geti18nForTerminal } from '../../i18n/bare.mjs'
import { ClearTaskbarProgress, SetTaskbarProgress } from '../../taskbar_progress.mjs'
import { formatDuration } from '../core/format_duration.mjs'
import { beginTestProgress, finishTestProgress } from '../core/progress.mjs'
import { testHubUrl } from '../hub/index.mjs'

import { TestDashboard } from './dashboard.mjs'
import { displayShouldResolve, resolveDisplayMode } from './mode.mjs'
import { createEventEmitter, resolveOutputMode } from './output.mjs'
import { formatFailureOutput, paintAccepted, paintJobDone, paintJobWait, paintSuiteEnd, splitSuiteKey, suiteEndHasFailureOutput } from './paint.mjs'
import { paintScheduleUpdate } from './schedule.mjs'

/**
 * @typedef {object} DisplayOptions
 * @property {boolean} [watch] 是否 watch 挂起
 * @property {object} [job] 提交给内核的 job
 * @property {number} [port] 内核端口
 * @property {'human' | 'plain' | 'json'} [output] 输出模式（缺省按 TTY 自动选择）
 */

/** 面向 agent 的进度心跳间隔（毫秒）。 */
export const HEARTBEAT_MS = 30_000

/**
 * 连接内核并显示直到该次调用该退出。
 * @param {DisplayOptions} options 选项
 * @returns {Promise<number>} 退出码
 */
export async function runTestDisplay({ watch = false, job, port, output } = {}) {
	const url = `${testHubUrl(port).replace(/^http/, 'ws')}/ws/viewer`
	const ws = new WebSocket(url)
	await new Promise((resolve, reject) => {
		ws.addEventListener('open', resolve, { once: true })
		ws.addEventListener('error', () => reject(new Error(`cannot connect test kernel at ${url}`)), { once: true })
	})

	/** 输出模式：human=TTY 仪表盘；plain/json=面向 agent 的离散事件。 */
	const outputMode = resolveOutputMode({ requested: output })
	const human = outputMode === 'human'
	/** 非 human 模式的事件发射器；human 直走 paint*。 */
	const emit = human ? null : createEventEmitter(outputMode)
	let exitCode = 0
	let runCount = 0
	let displayMode = resolveDisplayMode({ watch, job })
	/** 包管理器式仪表盘：仅 human + TTY + ANSI 且非 stream 模式启用。 */
	const dashboard = new TestDashboard({ enabled: human && Boolean(process.stdout.isTTY && supportsAnsi) })
	/** @type {string | null} */
	let jobId = null
	const done = Promise.withResolvers()
	let finished = 0
	let passedCount = 0
	let failedCount = 0
	/** 本波首个 suite-start 时刻（心跳耗时基准）。 */
	let waveStartedAt = null
	/** 当前在跑 suite 键（心跳展示）。 */
	const runningKeys = new Set()
	/** 面向 agent 的进度心跳计时器。 */
	let heartbeatTimer = null
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
	 * 结束本次显示：先撤仪表盘（擦状态区、恢复光标）再 resolve。
	 * @returns {void}
	 */
	function resolveDone() {
		if (heartbeatTimer != null) {
			clearInterval(heartbeatTimer)
			heartbeatTimer = null
		}
		dashboard.end()
		done.resolve()
	}

	/**
	 * 启动面向 agent 的进度心跳（plain/json 下每 {@link HEARTBEAT_MS} 一条，仅在有套件在跑时）。
	 * 让 agent 知道"还在跑"，而不必消费 ETA 抖动。
	 * @returns {void}
	 */
	function startHeartbeat() {
		if (human || heartbeatTimer != null) return
		heartbeatTimer = setInterval(() => {
			if (!runningKeys.size || waveStartedAt == null) return
			emit({ type: 'progress', running: [...runningKeys], elapsedMs: Date.now() - waveStartedAt })
		}, HEARTBEAT_MS)
	}

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
		if (human)
			paintAccepted(message)
		else {
			// 错误细节（deadTriggers / 可用 id 等）仍走 paintAccepted 的 i18n 明细，再补一条可解析行。
			if (message.error) paintAccepted(message)
			emit({
				type: 'accepted',
				error: message.error ?? null,
				code: message.code ?? 0,
				selectionMode: message.selectionMode ?? null,
				goalCount: message.goalCount ?? 0,
				total: message.total ?? 0,
				runCount: message.runCount ?? 0,
				reuseCount: message.reuseCount ?? 0,
				blockedCount: message.blockedCount ?? 0,
				skippedCount: message.skippedCount ?? 0,
			})
		}
		if (message.reportPath)
			console.logI18n('fountConsole.test.reportPath', { path: message.reportPath })
		// 有真跑的非 stream 展示才上仪表盘（错误/空波次直接走 job-done）。
		const beginDashboard = dashboard.enabled && displayMode !== 'stream' && !message.error && message.runCount > 0
		if (beginDashboard)
			dashboard.begin()
		// 每波独立基准：进度条从本波重新起步，避免跨波累计/残留旧值。
		progressStartedAt = Date.now()
		shownPct = null
		lastTaskbarState = null
		lastCompletionAt = null
		waveStartedAt = Date.now()
		runningKeys.clear()
		startHeartbeat()
		scheduleProgressRefresh()
	}

	/**
	 * @param {object} message log
	 * @returns {void}
	 */
	function onLog(message) {
		if (displayMode !== 'stream') {
			if (displayShouldResolve(message, { watch, displayMode, job, runCount }))
				resolveDone()
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
		runningKeys.add(message.key)
		if (dashboard.active) {
			dashboard.onSuiteStart(message)
			return
		}
		if (!human) {
			emit({ type: 'suite-start', key: message.key, expectedMs: message.expectedMs })
			return
		}
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
		// plain/json 不消费 ETA：进度由心跳覆盖，避免非单调 ETA 抖动刷屏。
		if (!human) return
		const nextCompletionAt = message.lastCompletionAt ? Date.parse(message.lastCompletionAt) : null
		const previousCompletionAt = lastCompletionAt
		// 双方都未知（空档/未就绪）视为未变化：旧逻辑把 `prev == null || next == null` 当变化，
		// 导致未知阶段每一帧都重印。
		const changed = (previousCompletionAt != null || nextCompletionAt != null)
			&& (previousCompletionAt == null || nextCompletionAt == null
				|| Math.abs(nextCompletionAt - previousCompletionAt) / Math.max(1, previousCompletionAt) > 0.05
				|| Math.abs(nextCompletionAt - previousCompletionAt) >= 500)
		lastCompletionAt = nextCompletionAt
		if (dashboard.active) {
			dashboard.onScheduleUpdate(message)
			// 任务栏进度始终随计时推进（单调不回退），顺道刷新一次并重置计时。
			if (progressStartedAt != null) scheduleProgressRefresh()
			return
		}
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
		runningKeys.delete(message.key)
		const countedRun = !message.reused && !message.blockedBy?.length && !message.skippedBy?.length
		if (countedRun && message.passed) passedCount++
		else if (countedRun) failedCount++
		if (displayMode !== 'stream' && suiteEndHasFailureOutput(message))
			failureLogs.push({ key: message.key, output: message.output })
		if (dashboard.active) {
			dashboard.onSuiteEnd(message)
			return
		}
		if (!human) {
			emit({
				type: 'suite-end',
				key: message.key,
				passed: message.passed === true,
				reused: message.reused === true,
				blockedBy: message.blockedBy ?? null,
				durationMs: message.durationMs ?? null,
			})
			return
		}
		paintSuiteEnd(message, { stream: displayMode === 'stream' })
	}

	/**
	 * @param {object} message queue-append / queue-remove
	 * @returns {void}
	 */
	function onQueue(message) {
		if (displayMode !== 'overview') {
			if (displayShouldResolve(message, { watch, displayMode, job, runCount }))
				resolveDone()
			return
		}
		if (dashboard.active) {
			dashboard.onQueue(message)
			return
		}
		if (!human || !watch) return
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
		if (dashboard.active) {
			dashboard.onJobWait(message)
			return
		}
		if (!human) {
			emit({ type: 'job-wait', aheadCount: message.aheadCount })
			return
		}
		paintJobWait(message)
	}

	/**
	 * @param {object} message cleanup-leak
	 * @returns {void}
	 */
	function onCleanupLeak(message) {
		if (dashboard.active) {
			dashboard.commitLine(geti18nForTerminal('fountConsole.test.cleanupLeak', {
				paths: message.leaks.join('\n'),
			}))
			return
		}
		if (!human) {
			emit({ type: 'cleanup-leak', leaks: message.leaks })
			return
		}
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
		// 先撤仪表盘，失败日志回放回到普通滚动区。
		dashboard.end()
		if (heartbeatTimer != null) {
			clearInterval(heartbeatTimer)
			heartbeatTimer = null
		}
		const failures = displayMode === 'stream' ? [] : failureLogs
		if (human)
			paintJobDone({ ...message, failureLogs: failures })
		else {
			emit({
				type: 'job-done',
				exitCode,
				reportPath: message.reportPath ?? null,
				passed: passedCount,
				failed: failedCount,
				durationMs: waveStartedAt == null ? null : Date.now() - waveStartedAt,
				failures: failures.map(failure => ({ key: failure.key, output: failure.output })),
			})
			for (const failure of failures) {
				if (!failure.output) continue
				process.stdout.write(`—— ${failure.key} tail ——\n`)
				process.stdout.write(formatFailureOutput(failure.output))
			}
		}
		if (displayShouldResolve(message, { watch, displayMode, job, runCount }))
			resolveDone()
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
			resolveDone()
	})

	ws.addEventListener('close', () => resolveDone())
	/** Ctrl+C / kill 时断开 WS。 */
	const onSig = () => {
		ws.close()
		resolveDone()
	}
	process.on('SIGINT', onSig)
	process.on('SIGTERM', onSig)

	ws.send(JSON.stringify({ type: 'hello', watch, job: watch ? undefined : job }))
	// watch 无 accepted：连接即挂上仪表盘。
	if (watch && dashboard.enabled) dashboard.begin()
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
