/**
 * 全库 suite 裁决：内容新鲜度只算一次，green/noisy/red/unknown。
 * 有子测试时逐子测试裁决后聚合。
 */
import { digestFileHashes } from './changed.mjs'
import { matchGlob } from './glob.mjs'
import { collectTriggerEvidence, suiteKey, suiteTriggersHit } from './state.mjs'
import { filterTriggerRelevantFiles } from './trigger_filter.mjs'

/**
 * @typedef {'green' | 'noisy' | 'red' | 'unknown'} VerdictKind
 * @typedef {import('./manifest.mjs').SuiteDef} SuiteDef
 * @typedef {import('./manifest.mjs').SubtestDef} SubtestDef
 * @typedef {import('./state.mjs').SuiteStateEntry} SuiteStateEntry
 * @typedef {import('./state.mjs').SubtestStateEntry} SubtestStateEntry
 * @typedef {import('./state.mjs').TestState} TestState
 */

/**
 * @typedef {object} Verdict
 * @property {VerdictKind} kind
 * @property {boolean} fresh 内容是否仍与上次真实运行一致
 * @property {string | null} triggerHash 当前 suite 共享 trigger 相关未提交内容 digest
 * @property {Record<string, Verdict>} [subtests] 子测试裁决
 * @property {string[]} [subtestsToRun] 需真跑的子测试名（red + unknown + noisy）
 */

/**
 * 给定 trigger 模式列表是否命中变更文件。
 * @param {string[]} triggers trigger globs
 * @param {string[]} changedFiles 变更文件
 * @param {import('./trigger_filter.mjs').TriggerFilter} [triggerFilter] 过滤
 * @returns {boolean} 是否命中
 */
function triggersHit(triggers, changedFiles, triggerFilter) {
	if (!changedFiles.length || !triggers.length) return false
	const relevant = filterTriggerRelevantFiles(changedFiles, triggerFilter)
	return triggers.some(pat => relevant.some(file => matchGlob(pat, file)))
}

/**
 * 对指定 trigger 模式计算未提交 digest。
 * @param {string[]} triggers trigger globs
 * @param {Map<string, string>} uncommittedHashes 未提交 digest 表
 * @param {import('./trigger_filter.mjs').TriggerFilter} [triggerFilter] 过滤
 * @returns {string | null} digest
 */
function triggerHashFor(triggers, uncommittedHashes, triggerFilter) {
	const relevant = filterTriggerRelevantFiles([...uncommittedHashes.keys()], triggerFilter)
	const matched = relevant.filter(file => triggers.some(pat => matchGlob(pat, file)))
	return digestFileHashes(uncommittedHashes, matched)
}

/**
 * 脏工作区 → 干净时旧 triggerHash 残留不算过期（由 reuse/refresh 对齐）。
 * @param {string | null | undefined} entryHash 记录指纹
 * @param {string | null | undefined} currentHash 当前指纹
 * @returns {boolean} 是否因指纹不一致而过期
 */
export function isTriggerHashStale(entryHash, currentHash) {
	const from = entryHash ?? null
	const to = currentHash ?? null
	if (from === to) return false
	if (from != null && to == null) return false
	return true
}

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
	return !isTriggerHashStale(entry.triggerHash, triggerHash)
}

/**
 * 裁决单个子测试。
 * @param {SuiteDef} suite 所属 suite
 * @param {SubtestDef} subtest 子测试
 * @param {SubtestStateEntry | undefined} entry 子测试状态
 * @param {boolean} sharedStale suite 共享 trigger 是否已过期
 * @param {string[]} committedChanged 自该子测试 commit 以来的变更
 * @param {Map<string, string>} uncommittedHashes 未提交 digest
 * @returns {Verdict} 子测试裁决
 */
export function judgeSubtest(suite, subtest, entry, sharedStale, committedChanged, uncommittedHashes) {
	const combined = [...suite.triggers, ...subtest.triggers]
	const triggerHash = triggerHashFor(combined, uncommittedHashes, suite.triggerFilter)
	const stale = sharedStale
		|| !entry
		|| entry.status === 'blocked'
		|| triggersHit(combined, committedChanged, suite.triggerFilter)
		|| isTriggerHashStale(entry.triggerHash, triggerHash)
	if (stale)
		return { kind: 'unknown', fresh: false, triggerHash }
	if (entry.status === 'passed') return { kind: 'green', fresh: true, triggerHash }
	if (entry.status === 'noisy') return { kind: 'noisy', fresh: true, triggerHash }
	return { kind: 'red', fresh: true, triggerHash }
}

/**
 * 聚合子测试裁决为 suite 裁决。
 * @param {Record<string, Verdict>} subVerdicts 子测试裁决
 * @param {string | null} sharedTriggerHash suite 共享 triggerHash
 * @returns {Verdict} suite 裁决
 */
export function aggregateSubtestVerdicts(subVerdicts, sharedTriggerHash) {
	const names = Object.keys(subVerdicts)
	/** @type {string[]} */
	const subtestsToRun = []
	let anyUnknown = false
	let anyRed = false
	let anyNoisy = false
	for (const name of names) {
		const v = subVerdicts[name]
		if (v.kind === 'unknown' || v.kind === 'red' || v.kind === 'noisy')
			subtestsToRun.push(name)
		if (v.kind === 'unknown') anyUnknown = true
		else if (v.kind === 'red') anyRed = true
		else if (v.kind === 'noisy') anyNoisy = true
	}
	/** @type {VerdictKind} */
	let kind = 'green'
	if (anyUnknown) kind = 'unknown'
	else if (anyRed) kind = 'red'
	else if (anyNoisy) kind = 'noisy'
	return {
		kind,
		fresh: !anyUnknown,
		triggerHash: sharedTriggerHash,
		subtests: subVerdicts,
		subtestsToRun,
	}
}

/**
 * @param {SuiteDef} suite suite
 * @param {SuiteStateEntry | undefined} entry 现状条目
 * @param {string[]} committedChanged 自 entry.commitHash 的 commit 变更
 * @param {Map<string, string>} uncommittedHashes 未提交内容 digest 表
 * @param {Map<string, string[]>} [committedChangedByKey] 含 `key#subtest` 的变更表
 * @returns {Verdict} 裁决
 */
export function judgeSuite(suite, entry, committedChanged, uncommittedHashes, committedChangedByKey) {
	const sharedTriggerHash = digestFileHashes(
		uncommittedHashes,
		collectTriggerEvidence(suite, [...uncommittedHashes.keys()]).matchedPaths,
	)

	if (suite.subtests?.length) {
		const sharedStale = !entry
			|| entry.status === 'blocked'
			|| suiteTriggersHit(suite, committedChanged)
			|| isTriggerHashStale(entry.triggerHash, sharedTriggerHash)
		/** @type {Record<string, Verdict>} */
		const subVerdicts = {}
		const key = suiteKey(suite.manifestId, suite.name)
		for (const subtest of suite.subtests) {
			const stChanged = committedChangedByKey?.get(`${key}#${subtest.name}`) ?? committedChanged
			subVerdicts[subtest.name] = judgeSubtest(
				suite,
				subtest,
				entry?.subtests?.[subtest.name],
				sharedStale,
				stChanged,
				uncommittedHashes,
			)
		}
		return aggregateSubtestVerdicts(subVerdicts, sharedTriggerHash)
	}

	const fresh = isContentFresh(suite, entry, committedChanged, uncommittedHashes)
	if (!entry || entry.status === 'blocked' || !fresh)
		return { kind: 'unknown', fresh: false, triggerHash: sharedTriggerHash }
	if (entry.status === 'passed') return { kind: 'green', fresh: true, triggerHash: sharedTriggerHash }
	if (entry.status === 'noisy') return { kind: 'noisy', fresh: true, triggerHash: sharedTriggerHash }
	return { kind: 'red', fresh: true, triggerHash: sharedTriggerHash }
}

/**
 * @param {SuiteDef[]} allSuites 全部 suite
 * @param {TestState} state 现状库
 * @param {Map<string, string[]>} committedChangedByKey 各 suite（及 key#subtest）自记录 commit 以来的变更
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
			committedChangedByKey,
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
 * 复用上次真实结果：有真实结果且内容新鲜，且无需再跑任何子测试。
 * @param {Verdict | undefined} verdict 裁决
 * @param {boolean} force 是否强制真跑
 * @returns {boolean} 非 force 且上次真实结果仍新鲜时可复用
 */
export function verdictReusable(verdict, force) {
	if (force || !verdict?.fresh) return false
	if (verdict.subtestsToRun?.length) return false
	return verdict.kind === 'green' || verdict.kind === 'noisy' || verdict.kind === 'red'
}
