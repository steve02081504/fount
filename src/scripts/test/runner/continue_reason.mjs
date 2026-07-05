import { collectTriggerEvidence, isSuiteOutdated, suiteKey } from '../core/state.mjs'

/**
 * @typedef {import('../core/manifest.mjs').SuiteDef} SuiteDef
 * @typedef {import('../core/state.mjs').SuiteStateEntry} SuiteStateEntry
 * @typedef {import('../core/state.mjs').TestState} TestState
 */

/**
 * @typedef {object} ContinueReason
 * @property {'pending_from_previous_report' | 'imperfect_failed' | 'imperfect_noisy' | 'imperfect_blocked' | 'missing_state_record' | 'outdated_trigger_hit' | 'dependency_required'} kind
 * @property {string | null} [fromCommit]
 * @property {string} [toCommit]
 * @property {string | null} [fromUncommittedHash]
 * @property {string | null} [toUncommittedHash]
 * @property {string[]} [matchedTriggers]
 * @property {string[]} [matchedPaths]
 * @property {string[]} [blockedBy]
 * @property {string} [requiredBy]
 */

/**
 * @returns {ContinueReason} 上次报告 pending 续跑
 */
export function pendingContinueReason() {
	return { kind: 'pending_from_previous_report' }
}

/**
 * @param {SuiteDef} suite suite
 * @param {SuiteStateEntry | undefined} entry 现状条目
 * @param {string} commitHash 当前 HEAD
 * @param {string | null} uncommittedHash 当前未提交 digest
 * @param {string[]} changedFiles 自记录以来的变更
 * @returns {ContinueReason} 不完美 suite 的续跑原因
 */
export function buildImperfectContinueReason(suite, entry, commitHash, uncommittedHash, changedFiles) {
	const outdated = isSuiteOutdated(suite, entry, changedFiles)

	if (!entry)
		return { kind: 'missing_state_record', toCommit: commitHash, toUncommittedHash: uncommittedHash }

	if (entry.status === 'failed')
		return {
			kind: 'imperfect_failed',
			fromCommit: entry.commitHash,
			toCommit: commitHash,
			fromUncommittedHash: entry.uncommittedHash ?? null,
			toUncommittedHash: uncommittedHash,
		}

	if (entry.status === 'noisy')
		return {
			kind: 'imperfect_noisy',
			fromCommit: entry.commitHash,
			toCommit: commitHash,
			fromUncommittedHash: entry.uncommittedHash ?? null,
			toUncommittedHash: uncommittedHash,
		}

	if (entry.status === 'blocked')
		return {
			kind: 'imperfect_blocked',
			blockedBy: entry.blockedBy,
			fromCommit: entry.commitHash,
			toCommit: commitHash,
			fromUncommittedHash: entry.uncommittedHash ?? null,
			toUncommittedHash: uncommittedHash,
		}

	if (outdated) {
		const evidence = collectTriggerEvidence(suite, changedFiles)
		return {
			kind: 'outdated_trigger_hit',
			fromCommit: entry.commitHash,
			toCommit: commitHash,
			fromUncommittedHash: entry.uncommittedHash ?? null,
			toUncommittedHash: uncommittedHash,
			...evidence,
		}
	}

	throw new Error(`buildImperfectContinueReason: ${suite.manifestId}/${suite.name} is not imperfect`)
}

/**
 * @param {SuiteDef[]} suites suite 列表
 * @param {TestState} state 现状库
 * @param {string} commitHash HEAD
 * @param {string | null} uncommittedHash 未提交 digest
 * @param {Map<string, string[]>} changedSinceRecordByKey 变更映射
 * @returns {Map<string, ContinueReason>} suite 键 -> 续跑原因
 */
export function buildContinueReasonsForSuites(suites, state, commitHash, uncommittedHash, changedSinceRecordByKey) {
	/** @type {Map<string, ContinueReason>} */
	const map = new Map()
	for (const suite of suites) {
		const key = suiteKey(suite.manifestId, suite.name)
		const changedFiles = changedSinceRecordByKey.get(key) ?? []
		map.set(key, buildImperfectContinueReason(
			suite,
			state.suites[key],
			commitHash,
			uncommittedHash,
			changedFiles,
		))
	}
	return map
}

/**
 * @param {string} [requiredBy] 依赖方 suite 键
 * @returns {ContinueReason} 依赖扩展纳入
 */
export function dependencyContinueReason(requiredBy) {
	return { kind: 'dependency_required', requiredBy: requiredBy ?? '—' }
}
