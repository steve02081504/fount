/**
 * 全库 suite 裁决：内容新鲜度只算一次，green/noisy/red/unknown。
 */
import { digestFileHashes } from './changed.mjs'
import { collectTriggerEvidence, suiteKey, suiteTriggersHit } from './state.mjs'

/**
 * @typedef {'green' | 'noisy' | 'red' | 'unknown'} VerdictKind
 * @typedef {import('./manifest.mjs').SuiteDef} SuiteDef
 * @typedef {import('./state.mjs').SuiteStateEntry} SuiteStateEntry
 * @typedef {import('./state.mjs').TestState} TestState
 */

/**
 * @typedef {object} Verdict
 * @property {VerdictKind} kind
 * @property {boolean} fresh 内容是否仍与上次真实运行一致
 * @property {string | null} triggerHash 当前 trigger 相关未提交内容 digest
 */

/**
 * @param {SuiteDef} suite suite
 * @param {SuiteStateEntry | undefined} entry 现状条目
 * @param {string[]} committedChanged 自 entry.commitHash 的 commit 变更
 * @param {Map<string, string>} uncommittedHashes 未提交内容 digest 表
 * @returns {boolean} 内容是否新鲜
 */
export function isContentFresh(suite, entry, committedChanged, uncommittedHashes) {
	if (!entry || entry.status === 'blocked') return false
	if (suiteTriggersHit(suite, committedChanged)) return false
	const triggerHash = digestFileHashes(
		uncommittedHashes,
		collectTriggerEvidence(suite, [...uncommittedHashes.keys()]).matchedPaths,
	)
	return (entry.triggerHash ?? null) === (triggerHash ?? null)
}

/**
 * @param {SuiteDef} suite suite
 * @param {SuiteStateEntry | undefined} entry 现状条目
 * @param {string[]} committedChanged 自 entry.commitHash 的 commit 变更
 * @param {Map<string, string>} uncommittedHashes 未提交内容 digest 表
 * @returns {Verdict} 裁决
 */
export function judgeSuite(suite, entry, committedChanged, uncommittedHashes) {
	const triggerHash = digestFileHashes(
		uncommittedHashes,
		collectTriggerEvidence(suite, [...uncommittedHashes.keys()]).matchedPaths,
	)
	const fresh = isContentFresh(suite, entry, committedChanged, uncommittedHashes)
	if (!entry || entry.status === 'blocked' || !fresh)
		return { kind: 'unknown', fresh: false, triggerHash }
	if (entry.status === 'passed') return { kind: 'green', fresh: true, triggerHash }
	if (entry.status === 'noisy') return { kind: 'noisy', fresh: true, triggerHash }
	return { kind: 'red', fresh: true, triggerHash }
}

/**
 * @param {SuiteDef[]} allSuites 全部 suite
 * @param {TestState} state 现状库
 * @param {Map<string, string[]>} committedChangedByKey 各 suite 自记录 commit 以来的变更
 * @param {Map<string, string>} uncommittedHashes 未提交内容 digest 表
 * @returns {Map<string, Verdict>} suite 键 -> 裁决
 */
export function buildVerdicts(allSuites, state, committedChangedByKey, uncommittedHashes) {
	return new Map(allSuites.map(suite => {
		const key = suiteKey(suite.manifestId, suite.name)
		return [key, judgeSuite(
			suite,
			state.suites[key],
			committedChangedByKey.get(key) ?? [],
			uncommittedHashes,
		)]
	}))
}

/**
 * 上游依赖是否放行下游：green 或 noisy。
 * @param {Verdict | undefined} verdict 裁决
 * @returns {boolean} green 或 noisy 时允许下游运行
 */
export function verdictAllowsDownstream(verdict) {
	return verdict?.kind === 'green' || verdict?.kind === 'noisy'
}

/**
 * 复用上次真实结果：有真实结果且内容新鲜。
 * @param {Verdict | undefined} verdict 裁决
 * @param {boolean} force 是否强制真跑
 * @returns {boolean} 非 force 且上次真实结果仍新鲜时可复用
 */
export function verdictReusable(verdict, force) {
	if (force || !verdict?.fresh) return false
	return verdict.kind === 'green' || verdict.kind === 'noisy' || verdict.kind === 'red'
}
