import { collectChangesSinceRecord } from '../core/changed.mjs'
import { expandImperfectDependents } from '../core/dependencies.mjs'
import { collectStaleTriggerEvidence, suiteKey } from '../core/state.mjs'

/**
 * @typedef {import('../core/manifest.mjs').SuiteDef} SuiteDef
 * @typedef {import('../core/state.mjs').TestState} TestState
 * @typedef {import('../core/verdict.mjs').Verdict} Verdict
 * @typedef {import('./continue_reason.mjs').GoalEvidence} GoalEvidence
 */

/**
 * @typedef {object} GoalSelection
 * @property {'run' | 'exit'} action
 * @property {number} [code]
 * @property {Set<string>} [goalKeys]
 * @property {Map<string, GoalEvidence>} [goalEvidenceByKey]
 * @property {Map<string, Map<string, string[] | undefined>>} [failedFirstByManifest] manifest → suite → 失败文件（FOUNT_TEST_FIRST）
 * @property {Map<string, string[]>} [subtestFilterByKey] suite 键 → 显式子测试过滤
 * @property {'imperfect' | 'outdated' | 'explicit' | 'all'} [mode]
 */

/**
 * @param {TestState} state 现状库
 * @param {string[] | undefined} manifestIds manifest 范围
 * @returns {Map<string, Map<string, string[] | undefined>>} manifest -> suite -> 失败文件
 */
export function buildFailedFirstByManifest(state, manifestIds) {
	/** @type {Map<string, Map<string, string[] | undefined>>} */
	const byManifest = new Map()
	for (const [key, entry] of Object.entries(state.suites)) {
		if (!['failed', 'noisy'].includes(entry.status)) continue
		const slash = key.indexOf('/')
		const manifestId = key.slice(0, slash)
		if (manifestIds?.length && !manifestIds.includes(manifestId)) continue
		const name = key.slice(slash + 1)
		const map = byManifest.get(manifestId) ?? new Map()
		map.set(name, entry.failedFiles?.length ? entry.failedFiles : undefined)
		byManifest.set(manifestId, map)
	}
	return byManifest
}

/**
 * @param {string} repoRoot 仓库根
 * @param {SuiteDef[]} allSuites 全部 suite
 * @param {TestState} state 现状库
 * @returns {Promise<Map<string, string[]>>} suite 键（及 `key#subtest`）-> 自记录 commit 以来变更文件
 */
export async function buildCommittedChangedByKey(repoRoot, allSuites, state) {
	/** @type {Map<string, string[]>} */
	const map = new Map()
	await Promise.all(allSuites.map(async suite => {
		const key = suiteKey(suite.manifestId, suite.name)
		const entry = state.suites[key]
		map.set(key, await collectChangesSinceRecord(repoRoot, entry?.commitHash ?? null, []))
		if (!suite.subtests?.length) return
		await Promise.all(suite.subtests.map(async subtest => {
			const stCommit = entry?.subtests?.[subtest.name]?.commitHash ?? entry?.commitHash ?? null
			map.set(`${key}#${subtest.name}`, await collectChangesSinceRecord(repoRoot, stCommit, []))
		}))
	}))
	return map
}

/**
 * @param {Map<string, Verdict>} verdicts 裁决表
 * @param {TestState} state 现状库
 * @returns {Set<string>} imperfect 目标键（不含 stale passed）
 */
export function goalImperfectKeys(verdicts, state) {
	/** @type {Set<string>} */
	const keys = new Set()
	for (const [key, verdict] of verdicts) {
		if (verdict.kind === 'green') continue
		const entry = state.suites[key]
		if (!entry) {
			keys.add(key)
			continue
		}
		// 内容过期的 passed 留给 outdated 波次
		if (verdict.kind === 'unknown' && entry.status === 'passed')
			continue
		if (verdict.kind === 'red' || verdict.kind === 'noisy')
			keys.add(key)
		else if (entry.status === 'failed' || entry.status === 'noisy' || entry.status === 'blocked')
			keys.add(key)
	}
	return keys
}

/**
 * @param {Map<string, Verdict>} verdicts 裁决表
 * @param {TestState} state 现状库
 * @param {SuiteDef[]} allSuites 全部 suite
 * @returns {Set<string>} imperfect + 一层下游
 */
export function goalContinue(verdicts, state, allSuites) {
	return expandImperfectDependents(goalImperfectKeys(verdicts, state), allSuites)
}

/**
 * @param {Map<string, Verdict>} verdicts 裁决表
 * @param {SuiteDef[]} scope 过滤范围
 * @returns {Set<string>} outdated 目标键
 */
export function goalOutdated(verdicts, scope) {
	const scopeKeys = new Set(scope.map(s => suiteKey(s.manifestId, s.name)))
	return new Set([...verdicts.entries()]
		.filter(([key, verdict]) => scopeKeys.has(key) && verdict.kind === 'unknown')
		.map(([key]) => key))
}

/**
 * @param {SuiteDef[]} suites 显式选中 suite
 * @returns {{ goalKeys: Set<string>, goalEvidenceByKey: Map<string, GoalEvidence> }} 目标键与显式证据
 */
export function goalExplicit(suites) {
	const goalKeys = new Set(suites.map(s => suiteKey(s.manifestId, s.name)))
	const goalEvidenceByKey = new Map([...goalKeys].map(key => [key, { kind: 'explicit_selected' }]))
	return { goalKeys, goalEvidenceByKey }
}

/**
 * 构造 imperfect 波次选择。
 * @param {object} params 参数
 * @param {Map<string, Verdict>} params.verdicts 裁决表
 * @param {TestState} params.state 现状库
 * @param {SuiteDef[]} params.allSuites 全部 suite
 * @param {SuiteDef[]} params.scope 范围
 * @param {string} params.commitHash HEAD
 * @param {string | null} params.uncommittedHash 未提交 digest
 * @returns {GoalSelection} 选择结果
 */
export function selectImperfectWave({
	verdicts,
	state,
	allSuites,
	scope,
	commitHash,
	uncommittedHash,
}) {
	const scopeKeys = new Set(scope.map(s => suiteKey(s.manifestId, s.name)))
	const imperfectKeys = new Set([...goalImperfectKeys(verdicts, state)].filter(k => scopeKeys.has(k)))
	const goalKeys = expandImperfectDependents(imperfectKeys, allSuites)
	// 下游可能超出 scope；仍纳入（依赖需要）
	if (!goalKeys.size)
		return { action: 'exit', code: 0, mode: 'imperfect' }

	/** @type {Map<string, GoalEvidence>} */
	const goalEvidenceByKey = new Map()
	for (const key of goalKeys) {
		const entry = state.suites[key]
		const drift = entry ? {
			fromCommit: entry.commitHash,
			toCommit: commitHash,
			fromUncommittedHash: entry.uncommittedHash ?? null,
			toUncommittedHash: uncommittedHash,
		} : {
			toCommit: commitHash,
			toUncommittedHash: uncommittedHash,
		}
		if (!entry) {
			goalEvidenceByKey.set(key, { kind: 'missing_state_record', ...drift })
			continue
		}
		if (imperfectKeys.has(key)) {
			if (entry.status === 'failed')
				goalEvidenceByKey.set(key, { kind: 'imperfect_failed', ...drift })
			else if (entry.status === 'noisy')
				goalEvidenceByKey.set(key, { kind: 'imperfect_noisy', ...drift })
			else if (entry.status === 'blocked')
				goalEvidenceByKey.set(key, { kind: 'imperfect_blocked', blockedBy: entry.blockedBy, ...drift })
			else
				goalEvidenceByKey.set(key, { kind: 'imperfect_failed', ...drift })
			continue
		}
		goalEvidenceByKey.set(key, {
			kind: 'imperfect_dependent',
			parentKey: [...imperfectKeys].find(hk =>
				allSuites.find(s => suiteKey(s.manifestId, s.name) === key)
					?.dependencies?.some(dep => suiteKey(dep.manifestId, dep.name) === hk)) ?? null,
			...drift,
		})
	}

	return {
		action: 'run',
		mode: 'imperfect',
		goalKeys,
		goalEvidenceByKey,
		failedFirstByManifest: buildFailedFirstByManifest(state),
	}
}

/**
 * 构造 outdated 波次选择。
 * @param {object} params 参数
 * @param {Map<string, Verdict>} params.verdicts 裁决表
 * @param {SuiteDef[]} params.scope 范围
 * @param {SuiteDef[]} [params.allSuites] 全部 suite
 * @param {Map<string, string[]>} [params.committedChangedByKey] commit 变更
 * @param {string} [params.commitHash] HEAD
 * @param {string | null} [params.uncommittedHash] 未提交 digest
 * @param {TestState} [params.state] 现状库
 * @returns {GoalSelection} 选择结果
 */
export function selectOutdatedWave({
	verdicts,
	scope,
	allSuites = [],
	committedChangedByKey = new Map(),
	commitHash,
	uncommittedHash,
	state,
}) {
	const goalKeys = goalOutdated(verdicts, scope)
	if (!goalKeys.size)
		return { action: 'exit', code: 0, mode: 'outdated' }

	const byKey = new Map(allSuites.map(s => [suiteKey(s.manifestId, s.name), s]))
	/** @type {Map<string, GoalEvidence>} */
	const evidenceByKey = new Map()
	for (const key of goalKeys) {
		const suite = byKey.get(key)
		const entry = state?.suites[key]
		const changed = committedChangedByKey.get(key) ?? []
		const triggerEvidence = suite ? collectStaleTriggerEvidence(suite, changed) : {}
		const drift = entry ? {
			fromCommit: entry.commitHash,
			toCommit: commitHash,
			fromUncommittedHash: entry.uncommittedHash ?? null,
			toUncommittedHash: uncommittedHash,
		} : {
			toCommit: commitHash,
			toUncommittedHash: uncommittedHash,
		}
		evidenceByKey.set(key, {
			kind: 'stale_content',
			...triggerEvidence,
			...drift,
		})
	}
	return {
		action: 'run',
		mode: 'outdated',
		goalKeys,
		goalEvidenceByKey: evidenceByKey,
		failedFirstByManifest: state ? buildFailedFirstByManifest(state) : new Map(),
	}
}

/**
 * 显式选择 / --all：范围内全部 suite 作为目标。
 * @param {object} params 参数
 * @param {SuiteDef[]} params.filtered 过滤后的 suite
 * @param {TestState} params.state 现状库
 * @param {string[]} [params.manifestIds] manifest 范围
 * @param {boolean} [params.runAll] 是否 --all
 * @param {Map<string, string[]>} [params.subtestFilterByKey] 子测试过滤
 * @returns {GoalSelection} 选择结果
 */
export function selectExplicitOrAll({
	filtered,
	state,
	manifestIds,
	runAll = false,
	subtestFilterByKey = new Map(),
}) {
	const { goalKeys, goalEvidenceByKey } = goalExplicit(filtered)
	if (!goalKeys.size)
		return { action: 'exit', code: 0 }
	return {
		action: 'run',
		mode: runAll ? 'all' : 'explicit',
		goalKeys,
		goalEvidenceByKey,
		failedFirstByManifest: buildFailedFirstByManifest(state, manifestIds),
		subtestFilterByKey,
	}
}
