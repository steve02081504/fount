/**
 * 把内核 accepted / job-done 事件画成终端文案（旧 runner 的操作员输出）。
 */
import { console, geti18n } from '../../i18n/bare.mjs'
import { formatDuration } from '../core/format_duration.mjs'
import { formatContinueReasonLabel } from '../runner/continue_reason.mjs'

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
 * 打印空波次 / 选择错误 / 波次头。
 * @param {object} msg 内核 accepted 载荷
 * @returns {void}
 */
export function paintAccepted(msg) {
	if (msg.error === 'deadTriggers') {
		for (const dead of msg.deadTriggers ?? [])
			console.errorI18n('fountConsole.test.triggerNoMatch', {
				scope: dead.subtestName
					? `${dead.manifestId}:${dead.suiteName}:${dead.subtestName}`
					: `${dead.manifestId}:${dead.suiteName}`,
				pattern: dead.pattern,
			})
		console.errorI18n('fountConsole.test.triggerNoMatchSummary', { count: (msg.deadTriggers ?? []).length })
		return
	}
	if (msg.error === 'unknownManifest') {
		console.errorI18n('fountConsole.test.unknown.manifestId', { ids: (msg.unmatched ?? []).join(', ') })
		console.errorI18n('fountConsole.test.available', { ids: (msg.knownIds ?? []).join(', ') })
		return
	}
	if (msg.error === 'unknownSuite') {
		console.errorI18n('fountConsole.test.unknown.suiteSelector', { ids: (msg.unknownSuites ?? []).join(', ') })
		console.errorI18n('fountConsole.test.available', { ids: (msg.available ?? []).join(', ') })
		return
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
		return
	}
	if (msg.error === 'noMatchingSuites') {
		console.logI18n('fountConsole.test.noMatchingSuites')
		console.errorI18n('fountConsole.test.available', { ids: (msg.available ?? []).join(', ') })
		return
	}
	if (msg.error === 'noisyOnly') {
		console.logI18n('fountConsole.test.noisyOnlyRemain', {
			count: (msg.noisyKeys ?? []).length,
			suites: (msg.noisyKeys ?? []).join(', '),
		})
		return
	}
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
		})
	}
	for (const row of msg.continueReasons ?? [])
		console.logI18n('fountConsole.test.display.reason', {
			label: row.key,
			reason: formatContinueReasonLabel(row),
		})
	if (msg.runCount || msg.unknownCount || msg.remainingMs != null)
		console.logI18n('fountConsole.test.display.remaining', { remaining: formatRemainingLabel(msg) })
	if (!msg.runCount && (msg.reuseCount || msg.blockedCount))
		console.logI18n('fountConsole.test.noRealRunPlanned', {
			reused: msg.reuseCount,
			blocked: msg.blockedCount,
		})
}

/**
 * 打印 job 收尾（报告路径、全复用提示）。
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
}
