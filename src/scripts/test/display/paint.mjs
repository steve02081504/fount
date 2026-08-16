/**
 * 把内核 accepted / job-done 事件画成终端文案（旧 runner 的操作员输出）。
 */
import process from 'node:process'

import { console, geti18n } from '../../i18n/bare.mjs'
import { formatDuration } from '../core/format_duration.mjs'
import { stripNoiseMarkers } from '../core/output_filter.mjs'
import { formatContinueReasonLabel } from '../runner/continue_reason.mjs'

/**
 * @param {string} key suite 键
 * @returns {{ manifestId: string, name: string }} 拆分
 */
export function splitSuiteKey(key) {
	const colon = String(key).indexOf(':')
	if (colon < 0) return { manifestId: key, name: key }
	return { manifestId: key.slice(0, colon), name: key.slice(colon + 1) }
}

/**
 * 失败/噪声输出是否该打到终端。
 * @param {object} msg suite-end
 * @returns {boolean} 是否该打印
 */
export function suiteEndHasFailureOutput(msg) {
	if (msg.reused || msg.blockedBy?.length) return false
	if (!msg.output) return false
	return !msg.passed || (msg.noiseHits?.length ?? 0) > 0
}

/**
 * @param {string} output 套件输出尾部
 * @returns {void}
 */
function writeFailureOutput(output) {
	const text = stripNoiseMarkers(output)
	if (!text) return
	process.stdout.write(text.endsWith('\n') ? text : `${text}\n`)
}

/**
 * @param {object} msg 含 remainingMs / unknownCount 的事件
 * @returns {string} 可读剩余
 */
export function formatRemainingLabel(msg) {
	const ms = msg.remainingMs
	const unknown = msg.unknownCount ?? 0
	if (unknown > 0 && (ms == null || !Number.isFinite(ms)))
		return geti18n('fountConsole.test.display.remainingOnlyUnknown', { count: unknown })
	if (ms == null || !Number.isFinite(ms)) return '?'
	if (unknown > 0)
		return geti18n('fountConsole.test.display.remainingUnknown', {
			remaining: formatDuration(ms),
			count: unknown,
		})
	return formatDuration(ms)
}

/**
 * 打印 accepted 的错误分支。
 * @param {object} message 内核 accepted 载荷
 * @returns {boolean} 是否已处理
 */
function paintAcceptedError(message) {
	if (message.error === 'deadTriggers') {
		for (const deadTrigger of message.deadTriggers ?? [])
			console.errorI18n('fountConsole.test.triggerNoMatch', {
				scope: deadTrigger.subtestName
					? `${deadTrigger.manifestId}:${deadTrigger.suiteName}:${deadTrigger.subtestName}`
					: `${deadTrigger.manifestId}:${deadTrigger.suiteName}`,
				pattern: deadTrigger.pattern,
			})
		console.errorI18n('fountConsole.test.triggerNoMatchSummary', { count: (message.deadTriggers ?? []).length })
		return true
	}
	if (message.error === 'unknownManifest') {
		console.errorI18n('fountConsole.test.unknown.manifestId', { ids: (message.unmatched ?? []).join(', ') })
		console.errorI18n('fountConsole.test.available', { ids: (message.knownIds ?? []).join(', ') })
		return true
	}
	if (message.error === 'unknownSuite') {
		console.errorI18n('fountConsole.test.unknown.suiteSelector', { ids: (message.unknownSuites ?? []).join(', ') })
		console.errorI18n('fountConsole.test.available', { ids: (message.available ?? []).join(', ') })
		return true
	}
	if (message.error === 'subtestFilter') {
		for (const filterError of message.filterErrors ?? []) {
			const names = (filterError.missing ?? []).join(', ')
			if (filterError.kind === 'subtest')
				console.errorI18n('fountConsole.test.unknown.subtestFilter', { suite: filterError.suiteId, names })
			else if (filterError.kind === 'file')
				console.errorI18n('fountConsole.test.unknown.fileFilter', { suite: filterError.suiteId, names })
			else
				console.errorI18n('fountConsole.test.unsupportedSubtestFilter', { suite: filterError.suiteId, names })
		}
		return true
	}
	if (message.error === 'noMatchingSuites') {
		console.logI18n('fountConsole.test.noMatchingSuites')
		console.errorI18n('fountConsole.test.available', { ids: (message.available ?? []).join(', ') })
		return true
	}
	if (message.error === 'noisyOnly') {
		console.logI18n('fountConsole.test.noisyOnlyRemain', {
			count: (message.noisyKeys ?? []).length,
			suites: (message.noisyKeys ?? []).join(', '),
		})
		return true
	}
	return false
}

/**
 * 打印选择模式摘要。
 * @param {object} message 内核 accepted 载荷
 * @returns {void}
 */
function paintSelectionSummary(message) {
	if (message.selectionMode === 'continue')
		console.logI18n('fountConsole.test.continueDefault', {
			count: message.goalCount,
			imperfect: message.imperfectCount ?? 0,
			outdated: message.outdatedCount ?? 0,
		})
	else if (message.selectionMode === 'imperfect')
		console.logI18n('fountConsole.test.continueImperfect', { count: message.goalCount })
	else if (message.selectionMode === 'outdated')
		console.logI18n('fountConsole.test.outdatedSelected', { count: message.goalCount })
	if (['imperfect', 'outdated', 'continue', 'explicit', 'all', 'skip_because'].includes(message.selectionMode)) {
		console.logI18n('fountConsole.test.selectedSuites', { selected: message.goalCount, total: message.total })
		console.logI18n('fountConsole.test.planSlotSummary', {
			run: message.runCount,
			reuse: message.reuseCount,
			blocked: message.blockedCount,
			skipped: message.skippedCount ?? 0,
		})
	}
}

/**
 * 打印续跑原因。
 * @param {object} message 内核 accepted 载荷
 * @returns {void}
 */
function paintContinueReasons(message) {
	for (const row of message.continueReasons ?? [])
		console.logI18n('fountConsole.test.display.reason', {
			label: row.key,
			reason: formatContinueReasonLabel(row),
		})
}

/**
 * 打印剩余时间 / 无真跑提示。
 * @param {object} message 内核 accepted 载荷
 * @returns {void}
 */
function paintWaveEstimate(message) {
	if (message.runCount || message.unknownCount || message.remainingMs != null)
		console.logI18n('fountConsole.test.display.remaining', { remaining: formatRemainingLabel(message) })
	if (!message.runCount && (message.reuseCount || message.blockedCount || message.skippedCount))
		console.logI18n('fountConsole.test.noRealRunPlanned', {
			reused: message.reuseCount,
			blocked: message.blockedCount,
			skipped: message.skippedCount ?? 0,
		})
}

/**
 * 打印空波次 / 选择摘要 / 续跑原因 / ETA。
 * @param {object} message 内核 accepted 载荷
 * @returns {void}
 */
function paintAcceptedWave(message) {
	if (message.empty || (message.empty == null && !message.error && !message.runCount && !message.selectionMode && (message.code ?? 0) === 0)) {
		console.logI18n('fountConsole.test.nothingToContinue')
		return
	}
	paintSelectionSummary(message)
	paintContinueReasons(message)
	paintWaveEstimate(message)
}

/**
 * 打印空波次 / 选择错误 / 波次头。
 * @param {object} message 内核 accepted 载荷
 * @returns {void}
 */
export function paintAccepted(message) {
	if (paintAcceptedError(message)) return
	paintAcceptedWave(message)
}

/**
 * 打印 suite-end（状态与剩余时间；失败输出延到 job-done）。
 * @param {object} message 内核 suite-end 载荷
 * @param {object} [options] 选项
 * @param {boolean} [options.stream=false] 是否已实时打过子进程输出
 * @returns {void}
 */
export function paintSuiteEnd(message, { stream = false } = {}) {
	if (message.blockedBy?.length)
		console.logI18n('fountConsole.test.blocked', { label: message.key, deps: message.blockedBy.join(', ') })
	else if (message.skippedBy?.length)
		console.logI18n('fountConsole.test.skippedTree', { label: message.key, deps: message.skippedBy.join(', ') })
	else if (message.reused) {
		const { manifestId, name } = splitSuiteKey(message.key)
		console.logI18n('fountConsole.test.reusedSuite', { manifestId, name, status: message.status })
	}
	else if (message.missedReady)
		console.logI18n('fountConsole.test.moduleCheck.missedReady', { label: message.key })
	else if (message.skipBecause?.length)
		console.logI18n(message.passed ? 'fountConsole.test.skipBecause.pass' : 'fountConsole.test.skipBecause.fail', {
			label: message.key,
			url: (message.passed ? message.skipBecause : message.skipBecauseClosed ?? message.skipBecause).join(' '),
		})
	else if (!message.passed)
		console.logI18n('fountConsole.test.failed', { label: message.key })
	else if (message.noiseHits?.length)
		console.logI18n('fountConsole.test.passedWithNoise', { label: message.key })
	else
		console.logI18n('fountConsole.test.passed', { label: message.key })
	if (!stream && !message.reused && !message.blockedBy?.length && !message.skippedBy?.length)
		console.logI18n('fountConsole.test.display.remaining', { remaining: formatRemainingLabel(message) })
}

/**
 * 打印本 job 仍在等调度（前方占用来自其他 job / FS 队列）。
 * @param {object} message 内核 job-wait 载荷
 * @returns {void}
 */
export function paintJobWait(message) {
	console.logI18n('fountConsole.test.display.queued', { count: message.aheadCount ?? 0 })
}

/**
 * 打印 job 收尾（报告路径、全复用提示、失败日志回放）。
 * @param {object} message 内核 job-done 载荷
 * @returns {void}
 */
export function paintJobDone(message) {
	if (message.allReusedHint)
		console.logI18n('fountConsole.test.allReusedHint')
	if (message.nothingToContinue)
		console.logI18n('fountConsole.test.nothingToContinue')
	if (message.reportPath) {
		console.logI18n('fountConsole.test.reportPathFinal', { path: message.reportPath })
		console.logI18n('fountConsole.test.statePathFinal', { path: 'data/test/state/main.md' })
	}
	for (const row of message.failureLogs ?? []) {
		console.logI18n('fountConsole.test.display.failureLog', { label: row.key })
		writeFailureOutput(row.output)
	}
}
