import { join } from 'node:path'

import { collectChangesSinceRecord } from '../core/changed.mjs'
import { expandImperfectDependents } from '../core/dependencies.mjs'
import { parseTestSubtestsEnv } from '../core/protocol.mjs'
import {
	isPassSkipBlock,
	skipBecauseAsForSuite,
	skipTreeDescendantKeys,
} from '../core/skip_because.mjs'
import { collectStaleTriggerEvidence, suiteKey } from '../core/state.mjs'

/**
 * @typedef {import('../core/manifest.mjs').SuiteDef} SuiteDef
 * @typedef {import('../core/state.mjs').TestState} TestState
 * @typedef {import('../core/verdict.mjs').Verdict} Verdict
 * @typedef {import('./continue_reason.mjs').GoalEvidence} GoalEvidence
 */

/**
 * CLI 已解析的 manifest 分组（含 suite / subtest 选择器）。
 * @typedef {{ manifestIds: string[], suiteSelectors: string[], subtestSelectors: Record<string, string[]> }} ResolvedGroup
 */

/**
 * 从分组收集显式子测试过滤（suite 键 → 名列表）。
 * CLI `manifest:suite:subtest` 优先；若 CLI 只选了 suite 未写子测试，则合并环境变量
 * `FOUNT_TEST_SUBTESTS`（仅作用于显式 suiteSelectors，不影响 dependsOn 拉入的依赖套件）。
 * @param {ResolvedGroup[]} groups 已解析分组
 * @param {SuiteDef[]} filtered 过滤后的 suite
 * @param {string[]} [ambientSubtests] 环境变量解析出的子测试名（默认读 `FOUNT_TEST_SUBTESTS`）
 * @returns {Map<string, string[]>} 子测试过滤
 */
export function collectSubtestFilterByKey(groups, filtered, ambientSubtests = parseTestSubtestsEnv()) {
	/** @type {Map<string, string[]>} */
	const subtestFilterByKey = new Map()
	for (const group of groups)
		for (const [suiteName, subtests] of Object.entries(group.subtestSelectors ?? {})) {
			if (!subtests.length) continue
			for (const suite of filtered) {
				if (!group.manifestIds.includes(suite.manifestId)) continue
				if (suite.name !== suiteName && suite.id !== suiteName) continue
				const key = suiteKey(suite.manifestId, suite.name)
				subtestFilterByKey.set(key, [...new Set([...subtestFilterByKey.get(key) ?? [], ...subtests])])
			}
		}

	if (!ambientSubtests.length) return subtestFilterByKey

	for (const group of groups)
		for (const suiteName of group.suiteSelectors ?? []) {
			if (group.subtestSelectors?.[suiteName]?.length) continue
			for (const suite of filtered) {
				if (!group.manifestIds.includes(suite.manifestId)) continue
				if (suite.name !== suiteName && suite.id !== suiteName) continue
				if (!suite.subtests?.length) continue
				const key = suiteKey(suite.manifestId, suite.name)
				if (subtestFilterByKey.has(key)) continue
				subtestFilterByKey.set(key, [...ambientSubtests])
			}
		}

	return subtestFilterByKey
}
/**
 * 波次目标选择结果。
 * @typedef {object} GoalSelection
 * @property {'run' | 'exit'} action 执行或退出
 * @property {number} [code] exit 时的退出码
 * @property {Set<string>} [goalKeys] 目标 suite 键
 * @property {Map<string, GoalEvidence>} [goalEvidenceByKey] 目标证据
 * @property {Map<string, Map<string, string[] | undefined>>} [failedFirstByManifest] manifest → suite → 失败文件（FOUNT_TEST_FIRST）
 * @property {Map<string, string[]>} [subtestFilterByKey] suite 键 → 显式子测试过滤
 * @property {'imperfect' | 'outdated' | 'explicit' | 'all' | 'continue' | 'skip_because'} [mode] 波次模式
 * @property {Set<string>} [imperfectKeys] 默认波次中的 imperfect 目标
 */

/**
 * 从现状库收集各 manifest 的失败优先文件表（FOUNT_TEST_FIRST）。
 * @param {TestState} state 现状库
 * @param {string[] | undefined} manifestIds manifest 范围
 * @returns {Map<string, Map<string, string[] | undefined>>} manifest -> suite -> 失败文件
 */
export function buildFailedFirstByManifest(state, manifestIds) {
	/** @type {Map<string, Map<string, string[] | undefined>>} */
	const byManifest = new Map()
	for (const [key, entry] of Object.entries(state.suites)) {
		if (!['failed', 'noisy'].includes(entry.status)) continue
		const colon = key.indexOf(':')
		if (colon < 0) continue
		const manifestId = key.slice(0, colon)
		if (manifestIds?.length && !manifestIds.includes(manifestId)) continue
		const name = key.slice(colon + 1)
		const map = byManifest.get(manifestId) ?? new Map()
		map.set(name, entry.failedFiles?.length ? entry.failedFiles : undefined)
		byManifest.set(manifestId, map)
	}
	return byManifest
}

/**
 * 构建各 suite（及子测试）自记录 commit 以来的变更文件表。
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
		if (suite.gitRoot) {
			const abs = join(repoRoot, suite.gitRoot)
			const files = await collectChangesSinceRecord(abs, entry?.commitHash ?? null, [])
			map.set(key, files.map(file => `${suite.gitRoot}/${file}`.replace(/\\/g, '/')))
		}
		else if (suite.gitRoot === null)
			map.set(key, [])
		else
			map.set(key, await collectChangesSinceRecord(repoRoot, entry?.commitHash ?? null, []))
		if (!suite.subtests?.length) return
		await Promise.all(suite.subtests.map(async subtest => {
			const stCommit = entry?.subtests?.[subtest.name]?.commitHash ?? entry?.commitHash ?? null
			if (suite.gitRoot) {
				const abs = join(repoRoot, suite.gitRoot)
				const files = await collectChangesSinceRecord(abs, stCommit, [])
				map.set(`${key}#${subtest.name}`, files.map(file => `${suite.gitRoot}/${file}`.replace(/\\/g, '/')))
			}
			else if (suite.gitRoot === null)
				map.set(`${key}#${subtest.name}`, [])
			else
				map.set(`${key}#${subtest.name}`, await collectChangesSinceRecord(repoRoot, stCommit, []))
		}))
	}))
	return map
}

/**
 * 是否可作为「下游一层展开」的根：失败/阻塞/缺失/red。
 * fresh noisy 进 imperfect 真跑，但不拖下游（noisy 已放行下游且下游多半已绿）。
 * @param {Verdict | undefined} verdict 裁决
 * @param {import('../core/state.mjs').SuiteStateEntry | undefined} entry 现状
 * @param {import('../core/manifest.mjs').SuiteDef | undefined} suite suite
 * @param {Map<string, import('../core/manifest.mjs').SuiteDef>} byKey suite 表
 * @param {Map<string, import('../core/skip_because.mjs').IssueClosedState>} [issueStates] 已探测的 issue 状态
 * @returns {boolean} 是否展开下游
 */
function isHardImperfectRoot(verdict, entry, suite, byKey, issueStates) {
	if (skipBecauseAsForSuite(suite)) return false
	if (isPassSkipBlock(entry, byKey, issueStates)) return false
	if (!entry) return true
	if (entry.status === 'failed' || entry.status === 'blocked') return true
	return verdict?.kind === 'red'
}

/**
 * 收集 imperfect 波次根目标键（不含下游扩展）。
 * @param {Map<string, Verdict>} verdicts 裁决表
 * @param {TestState} state 现状库
 * @param {SuiteDef[]} [allSuites] 全部 suite（skip_because 判定）
 * @param {Map<string, import('../core/skip_because.mjs').IssueClosedState>} [issueStates] 已探测的 issue 状态
 * @returns {Set<string>} imperfect 目标键（含 fresh noisy；不含 stale passed / outdated unknown）
 */
export function goalImperfectKeys(verdicts, state, allSuites = [], issueStates) {
	const byKey = new Map(allSuites.map(suite => [suiteKey(suite.manifestId, suite.name), suite]))
	const skipTree = skipTreeDescendantKeys(allSuites)
	/** @type {Set<string>} */
	const keys = new Set()
	for (const [key, verdict] of verdicts) {
		if (skipTree.has(key)) continue
		const suite = byKey.get(key)
		const entry = state.suites[key]
		if (!entry) {
			keys.add(key)
			continue
		}
		if (skipBecauseAsForSuite(suite)) continue
		if (isPassSkipBlock(entry, byKey, issueStates)) continue
		// hard fail 一律进 imperfect（即使裁决误判 green/noisy 也不能漏）
		if (entry.status === 'failed' || entry.status === 'blocked') {
			keys.add(key)
			continue
		}
		if (verdict.kind === 'green') continue
		// 内容过期 → outdated 波
		if (verdict.kind === 'unknown') continue
		if (verdict.kind === 'noisy' && verdict.fresh) keys.add(key)
		else if (verdict.kind === 'red') keys.add(key)
	}
	return keys
}

/**
 * 由 imperfect 根键展开一层下游，并剔除 skip_tree。
 * @param {Set<string>} imperfectKeys imperfect 根
 * @param {Map<string, Verdict>} verdicts 裁决表
 * @param {TestState} state 现状库
 * @param {SuiteDef[]} allSuites 全部 suite
 * @param {Map<string, import('../core/skip_because.mjs').IssueClosedState>} [issueStates] 已探测的 issue 状态
 * @returns {{ byKey: Map<string, SuiteDef>, expandRoots: Set<string>, skipTree: Set<string>, goalKeys: Set<string> }} 展开结果
 */
function expandImperfectGoalKeys(imperfectKeys, verdicts, state, allSuites, issueStates) {
	const byKey = new Map(allSuites.map(suite => [suiteKey(suite.manifestId, suite.name), suite]))
	const expandRoots = new Set([...imperfectKeys].filter(key =>
		isHardImperfectRoot(verdicts.get(key), state.suites[key], byKey.get(key), byKey, issueStates)))
	const skipTree = skipTreeDescendantKeys(allSuites)
	return {
		byKey,
		expandRoots,
		skipTree,
		goalKeys: new Set([...imperfectKeys, ...expandImperfectDependents(expandRoots, allSuites)].filter(key => !skipTree.has(key))),
	}
}

/**
 * imperfect 目标 + hard-fail 根的一层下游（noisy 不拖下游）。
 * @param {Map<string, Verdict>} verdicts 裁决表
 * @param {TestState} state 现状库
 * @param {SuiteDef[]} allSuites 全部 suite
 * @param {Map<string, import('../core/skip_because.mjs').IssueClosedState>} [issueStates] 已探测的 issue 状态
 * @returns {Set<string>} 扩展后的目标键
 */
export function expandImperfectGoals(verdicts, state, allSuites, issueStates) {
	const imperfectKeys = goalImperfectKeys(verdicts, state, allSuites, issueStates)
	return expandImperfectGoalKeys(imperfectKeys, verdicts, state, allSuites, issueStates).goalKeys
}

/**
 * scope 内仍为 fresh noisy 的 suite 键（安全网：两波皆空时用于最终退出码与提示）。
 * @param {Map<string, Verdict>} verdicts 裁决表
 * @param {SuiteDef[]} scope 范围
 * @returns {string[]} fresh noisy suite 键
 */
export function listFreshNoisyKeys(verdicts, scope) {
	const scopeKeys = new Set(scope.map(s => suiteKey(s.manifestId, s.name)))
	/** @type {string[]} */
	const keys = []
	for (const [key, verdict] of verdicts) {
		if (!scopeKeys.has(key)) continue
		if (verdict.kind === 'noisy' && verdict.fresh) keys.push(key)
	}
	return keys.sort()
}

/**
 * 计算 imperfect 波次目标（含 hard-fail 一层下游扩展）。
 * @param {Map<string, Verdict>} verdicts 裁决表
 * @param {TestState} state 现状库
 * @param {SuiteDef[]} allSuites 全部 suite
 * @returns {Set<string>} imperfect + hard-fail 一层下游
 */
export function goalContinue(verdicts, state, allSuites) {
	return expandImperfectGoals(verdicts, state, allSuites)
}

/**
 * 计算 outdated（内容过期）波次目标键。
 * @param {Map<string, Verdict>} verdicts 裁决表
 * @param {SuiteDef[]} scope 过滤范围
 * @param {SuiteDef[]} [allSuites] 全部 suite（skip_tree 下游剔除）
 * @returns {Set<string>} outdated 目标键
 */
export function goalOutdated(verdicts, scope, allSuites = []) {
	const scopeKeys = new Set(scope.map(s => suiteKey(s.manifestId, s.name)))
	const skipTree = skipTreeDescendantKeys(allSuites.length ? allSuites : scope)
	return new Set([...verdicts.entries()]
		.filter(([key, verdict]) => scopeKeys.has(key) && verdict.kind === 'unknown' && !skipTree.has(key))
		.map(([key]) => key))
}

/**
 * 由显式选中的 suite 列表构造目标键与证据。
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
 * @param {Map<string, import('../core/skip_because.mjs').IssueClosedState>} [params.issueStates] 已探测的 issue 状态
 * @returns {GoalSelection} 选择结果
 */
export function selectImperfectWave({
	verdicts,
	state,
	allSuites,
	scope,
	commitHash,
	uncommittedHash,
	issueStates,
}) {
	const scopeKeys = new Set(scope.map(s => suiteKey(s.manifestId, s.name)))
	const imperfectKeys = new Set([...goalImperfectKeys(verdicts, state, allSuites, issueStates)].filter(k => scopeKeys.has(k)))
	const { goalKeys } = expandImperfectGoalKeys(imperfectKeys, verdicts, state, allSuites, issueStates)
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
 * @param {string[]} [params.uncommittedFiles] 未提交路径
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
	uncommittedFiles = [],
	commitHash,
	uncommittedHash,
	state,
}) {
	const goalKeys = goalOutdated(verdicts, scope, allSuites)
	if (!goalKeys.size)
		return { action: 'exit', code: 0, mode: 'outdated' }

	const byKey = new Map(allSuites.map(s => [suiteKey(s.manifestId, s.name), s]))
	/** @type {Map<string, GoalEvidence>} */
	const evidenceByKey = new Map()
	for (const key of goalKeys) {
		const suite = byKey.get(key)
		const entry = state?.suites[key]
		const changed = [...new Set([
			...committedChangedByKey.get(key) ?? [],
			...uncommittedFiles,
		])]
		const triggerEvidence = suite
			? collectStaleTriggerEvidence(suite, changed, {
				entry,
				currentTriggerHash: verdicts.get(key)?.triggerHash ?? null,
			})
			: {}
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
			kind: triggerEvidence.triggerHashDrift ? 'trigger_hash_drift' : 'stale_content',
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

/**
 * 默认续跑：imperfect ∪ outdated，每个 suite 只规划一次。
 * @param {object} params 参数
 * @param {Map<string, Verdict>} params.verdicts 裁决表
 * @param {TestState} params.state 现状库
 * @param {SuiteDef[]} params.allSuites 全部 suite
 * @param {SuiteDef[]} params.scope 范围
 * @param {Map<string, string[]>} [params.committedChangedByKey] commit 变更
 * @param {string[]} [params.uncommittedFiles] 未提交路径
 * @param {string} params.commitHash HEAD
 * @param {string | null} params.uncommittedHash 未提交 digest
 * @param {Map<string, import('../core/skip_because.mjs').IssueClosedState>} [params.issueStates] 已探测的 issue 状态
 * @returns {GoalSelection} 选择结果
 */
export function selectDefaultWave({
	verdicts,
	state,
	allSuites,
	scope,
	committedChangedByKey = new Map(),
	uncommittedFiles = [],
	commitHash,
	uncommittedHash,
	issueStates,
}) {
	const imperfect = selectImperfectWave({
		verdicts,
		state,
		allSuites,
		scope,
		commitHash,
		uncommittedHash,
		issueStates,
	})
	const outdated = selectOutdatedWave({
		verdicts,
		scope,
		allSuites,
		committedChangedByKey,
		uncommittedFiles,
		commitHash,
		uncommittedHash,
		state,
	})
	const goalKeys = new Set([
		...imperfect.action === 'run' ? imperfect.goalKeys : [],
		...outdated.action === 'run' ? outdated.goalKeys : [],
	])
	if (!goalKeys.size)
		return { action: 'exit', code: 0, mode: 'continue' }

	/** @type {Map<string, GoalEvidence>} */
	const goalEvidenceByKey = new Map()
	if (imperfect.action === 'run')
		for (const [key, evidence] of imperfect.goalEvidenceByKey ?? [])
			goalEvidenceByKey.set(key, evidence)
	if (outdated.action === 'run')
		for (const [key, evidence] of outdated.goalEvidenceByKey ?? [])
			if (!goalEvidenceByKey.has(key))
				goalEvidenceByKey.set(key, evidence)

	const hasImperfect = imperfect.action === 'run'
	const hasOutdated = outdated.action === 'run'
	/** @type {GoalSelection['mode']} */
	const mode = hasImperfect && hasOutdated
		? 'continue'
		: hasImperfect ? 'imperfect' : 'outdated'

	return {
		action: 'run',
		mode,
		goalKeys,
		goalEvidenceByKey,
		failedFirstByManifest: buildFailedFirstByManifest(state),
		imperfectKeys: hasImperfect ? imperfect.goalKeys : new Set(),
	}
}
