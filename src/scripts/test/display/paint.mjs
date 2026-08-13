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
 * @param {object} msg 内核 accepted 载荷
 * @returns {boolean} 是否已处理
 */
function paintAcceptedError(msg) {
	if (msg.error === 'deadTriggers') {
		for (const dead of msg.deadTriggers ?? [])
			console.errorI18n('fountConsole.test.triggerNoMatch', {
				scope: dead.subtestName
					? `${dead.manifestId}:${dead.suiteName}:${dead.subtestName}`
					: `${dead.manifestId}:${dead.suiteName}`,
				pattern: dead.pattern,
			})
		console.errorI18n('fountConsole.test.triggerNoMatchSummary', { count: (msg.deadTriggers ?? []).length })
		return true
	}
	if (msg.error === 'unknownManifest') {
		console.errorI18n('fountConsole.test.unknown.manifestId', { ids: (msg.unmatched ?? []).join(', ') })
		console.errorI18n('fountConsole.test.available', { ids: (msg.knownIds ?? []).join(', ') })
		return true
	}
	if (msg.error === 'unknownSuite') {
		console.errorI18n('fountConsole.test.unknown.suiteSelector', { ids: (msg.unknownSuites ?? []).join(', ') })
		console.errorI18n('fountConsole.test.available', { ids: (msg.available ?? []).join(', ') })
		return true
	}
	if (msg.error === 'subtestFilter') {
		for (const err of msg.filterErrors ?? []) {
			const names = (err.missing ?? []).join(', ')
			if (err.kind === 'subtest')
				console.errorI18n('fountConsole.test.unknown.subtestFilter', { suite: err.suiteId, names })
			else if (err.kind === 'file')
				console.errorI18n('fountConsole.test.unknown.fileFilter', { suite: err.suiteId, names })
			else
				console.errorI18n('fountConsole.test.unsupportedSubtestFilter', { suite: err.suiteId, names })
		}
		return true
	}
	if (msg.error === 'noMatchingSuites') {
		console.logI18n('fountConsole.test.noMatchingSuites')
		console.errorI18n('fountConsole.test.available', { ids: (msg.available ?? []).join(', ') })
		return true
	}
	if (msg.error === 'noisyOnly') {
		console.logI18n('fountConsole.test.noisyOnlyRemain', {
			count: (msg.noisyKeys ?? []).length,
			suites: (msg.noisyKeys ?? []).join(', '),
		})
		return true
	}
	return false
}

/**
 * 打印空波次 / 选择摘要 / 续跑原因 / ETA。
 * @param {object} msg 内核 accepted 载荷
 * @returns {void}
 */
function paintAcceptedWave(msg) {
	if (msg.empty || (msg.empty == null && !msg.error && !msg.runCount && !msg.selectionMode && (msg.code ?? 0) === 0)) {
		console.logI18n('fountConsole.test.nothingToContinue')
		return
	}
	if (msg.selectionMode === 'continue')
		console.logI18n('fountConsole.test.continueDefault', {
			count: msg.goalCount,
			imperfect: msg.imperfectCount ?? 0,
			outdated: msg.outdatedCount ?? 0,
		})
	else if (msg.selectionMode === 'imperfect')
		console.logI18n('fountConsole.test.continueImperfect', { count: msg.goalCount })
	else if (msg.selectionMode === 'outdated')
		console.logI18n('fountConsole.test.outdatedSelected', { count: msg.goalCount })
	if (['imperfect', 'outdated', 'continue', 'explicit', 'all', 'skip_because'].includes(msg.selectionMode)) {
		console.logI18n('fountConsole.test.selectedSuites', { selected: msg.goalCount, total: msg.total })
		console.logI18n('fountConsole.test.planSlotSummary', {
			run: msg.runCount,
			reuse: msg.reuseCount,
			blocked: msg.blockedCount,
			skipped: msg.skippedCount ?? 0,
		})
	}
	for (const row of msg.continueReasons ?? [])
		console.logI18n('fountConsole.test.display.reason', {
			label: row.key,
			reason: formatContinueReasonLabel(row),
		})
	if (msg.runCount || msg.unknownCount || msg.remainingMs != null)
		console.logI18n('fountConsole.test.display.remaining', { remaining: formatRemainingLabel(msg) })
	if (!msg.runCount && (msg.reuseCount || msg.blockedCount || msg.skippedCount))
		console.logI18n('fountConsole.test.noRealRunPlanned', {
			reused: msg.reuseCount,
			blocked: msg.blockedCount,
			skipped: msg.skippedCount ?? 0,
		})
}

/**
 * 打印空波次 / 选择错误 / 波次头。
 * @param {object} msg 内核 accepted 载荷
 * @returns {void}
 */
export function paintAccepted(msg) {
	if (paintAcceptedError(msg)) return
	paintAcceptedWave(msg)
}

/**
 * 打印 suite-end（含 overview 下的失败/噪声输出）。
 * @param {object} msg 内核 suite-end 载荷
 * @param {object} [options] 选项
 * @param {boolean} [options.stream=false] 是否已实时打过子进程输出
 * @returns {void}
 */
export function paintSuiteEnd(msg, { stream = false } = {}) {
	if (msg.blockedBy?.length)
		console.logI18n('fountConsole.test.blocked', { label: msg.key, deps: msg.blockedBy.join(', ') })
	else if (msg.skippedBy?.length)
		console.logI18n('fountConsole.test.skippedTree', { label: msg.key, deps: msg.skippedBy.join(', ') })
	else if (msg.reused) {
		const { manifestId, name } = splitSuiteKey(msg.key)
		console.logI18n('fountConsole.test.reusedSuite', { manifestId, name, status: msg.status })
	}
	else if (msg.missedReady)
		console.logI18n('fountConsole.test.moduleCheck.missedReady', { label: msg.key })
	else if (msg.skipBecause?.length)
		console.logI18n(msg.passed ? 'fountConsole.test.skipBecause.pass' : 'fountConsole.test.skipBecause.fail', {
			label: msg.key,
			url: (msg.passed ? msg.skipBecause : msg.skipBecauseClosed ?? msg.skipBecause).join(' '),
		})
	else if (!msg.passed)
		console.logI18n('fountConsole.test.failed', { label: msg.key })
	else if (msg.noiseHits?.length)
		console.logI18n('fountConsole.test.passedWithNoise', { label: msg.key })
	else
		console.logI18n('fountConsole.test.passed', { label: msg.key })
	if (!stream && suiteEndHasFailureOutput(msg))
		writeFailureOutput(msg.output)
	if (!stream && !msg.reused && !msg.blockedBy?.length && !msg.skippedBy?.length)
		console.logI18n('fountConsole.test.display.remaining', { remaining: formatRemainingLabel(msg) })
}

/**
 * 打印 job 收尾（报告路径、全复用提示、失败日志回放）。
 * @param {object} msg 内核 job-done 载荷
 * @returns {void}
 */
export function paintJobDone(msg) {
	if (msg.allReusedHint)
		console.logI18n('fountConsole.test.allReusedHint')
	if (msg.nothingToContinue)
		console.logI18n('fountConsole.test.nothingToContinue')
	if (msg.reportPath) {
		console.logI18n('fountConsole.test.reportPathFinal', { path: msg.reportPath })
		console.logI18n('fountConsole.test.statePathFinal', { path: 'data/test/state/main.md' })
	}
	for (const row of msg.failureLogs ?? []) {
		console.logI18n('fountConsole.test.display.failureLog', { label: row.key })
		writeFailureOutput(row.output)
	}
}
