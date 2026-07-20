/**
 * 目标集 + 裁决表 → 拓扑单遍运行计划（reuse / run / blocked）。
 */
import { detectDependencyCycle, topoSortSuites } from './dependencies.mjs'
import { suiteKey } from './state.mjs'
import { verdictAllowsDownstream, verdictReusable } from './verdict.mjs'

/**
 * @typedef {import('./manifest.mjs').SuiteDef} SuiteDef
 * @typedef {import('./verdict.mjs').Verdict} Verdict
 * @typedef {import('../runner/continue_reason.mjs').GoalEvidence} GoalEvidence
 */

/**
 * @typedef {'reuse' | 'run' | 'blocked'} PlanAction
 */

/**
 * @typedef {object} PlanSlot
 * @property {string} key
 * @property {SuiteDef} suite
 * @property {PlanAction} action
 * @property {string[]} [blockedBy]
 * @property {string | null} [requiredBy] 直接纳入方（依赖拉入）
 * @property {boolean} goal 是否为用户目标
 * @property {GoalEvidence} [goalEvidence] 目标证据
 * @property {string[]} [subtestsToRun] 本次需跑的子测试名（省略 = 全部）
 * @property {string[]} [fileFilters] serial suite 的 CLI 文件 stem 过滤（无注册 subtests 时）
 */

/**
 * @typedef {object} RunPlan
 * @property {PlanSlot[]} slots 拓扑有序槽位
 * @property {Set<string>} goalKeys 用户目标键
 */

/**
 * @param {PlanSlot | undefined} slot 计划槽位
 * @param {Verdict | undefined} verdict 计划外依赖裁决
 * @returns {boolean} 是否放行下游
 */
function dependencyGreen(slot, verdict) {
	if (slot) {
		if (slot.action === 'blocked') return false
		if (slot.action === 'reuse') return verdictAllowsDownstream(verdict)
		return true
	}
	return verdictAllowsDownstream(verdict)
}

/**
 * @param {string} key suite 键
 * @param {Map<string, PlanSlot>} planned 已标注槽位
 * @param {Map<string, Verdict>} verdicts 裁决表
 * @param {Map<string, SuiteDef>} byKey 全部 suite
 * @returns {string[]} 阻塞来源
 */
function listBlockingDeps(key, planned, verdicts, byKey) {
	/** @type {string[]} */
	const missing = []
	for (const dep of byKey.get(key)?.dependencies ?? []) {
		const depKey = suiteKey(dep.manifestId, dep.name)
		if (!dependencyGreen(planned.get(depKey), verdicts.get(depKey)))
			missing.push(depKey)
	}
	return missing
}

/**
 * 目标 suite 是否必须真跑（不复用）。
 * @param {boolean} isGoal 是否目标
 * @param {Verdict | undefined} verdict 裁决
 * @param {boolean} force 强制
 * @param {boolean} [hasExplicitSubtestFilter] CLI 显式子测试/文件过滤
 * @returns {boolean} 必须真跑
 */
function goalMustRun(isGoal, verdict, force, hasExplicitSubtestFilter = false) {
	if (!isGoal) return false
	if (force) return true
	if (hasExplicitSubtestFilter) return true
	if (!verdict) return true
	if (verdict.kind === 'unknown' || verdict.kind === 'red' || verdict.kind === 'noisy')
		return true
	return (verdict.subtestsToRun?.length ?? 0) > 0
}

/**
 * @param {Set<string>} goalKeys 用户目标键
 * @param {Map<string, Verdict>} verdicts 裁决表
 * @param {Map<string, SuiteDef>} byKey 全部 suite
 * @param {SuiteDef[]} allSuites 全部 suite（拓扑 tie-break）
 * @param {Map<string, GoalEvidence>} [goalEvidenceByKey] 目标证据
 * @param {boolean} [force] 强制真跑目标
 * @param {Map<string, string[]>} [subtestFilterByKey] 显式子测试过滤（suite 键 → 名列表）
 * @returns {RunPlan} 运行计划
 */
export function buildPlan(
	goalKeys,
	verdicts,
	byKey,
	allSuites,
	goalEvidenceByKey = new Map(),
	force = false,
	subtestFilterByKey = new Map(),
) {
	const needed = new Set(goalKeys)
	/** @type {Map<string, string>} */
	const provenance = new Map()
	const queue = [...goalKeys]

	while (queue.length) {
		const key = queue.shift()
		for (const dep of byKey.get(key)?.dependencies ?? []) {
			const depKey = suiteKey(dep.manifestId, dep.name)
			if (verdictAllowsDownstream(verdicts.get(depKey)) || needed.has(depKey)) continue
			needed.add(depKey)
			provenance.set(depKey, key)
			queue.push(depKey)
		}
	}

	const suites = [...needed].map(key => byKey.get(key)).filter(Boolean)
	const cycle = detectDependencyCycle(suites)
	if (cycle)
		throw new Error(`dependency cycle detected: ${cycle}`)

	const sorted = topoSortSuites(suites, allSuites)
	/** @type {Map<string, PlanSlot>} */
	const planned = new Map()

	for (const suite of sorted) {
		const key = suiteKey(suite.manifestId, suite.name)
		const verdict = verdicts.get(key)
		const isGoal = goalKeys.has(key)
		/** @type {string[] | undefined} */
		let subtestsToRun
		const filter = subtestFilterByKey.get(key)
		const hasExplicitFilter = !!filter?.length
		if (suite.subtests?.length) {
			const allNames = suite.subtests.map(st => st.name)
			// 显式 CLI 过滤：目标 suite 直接按过滤名跑（不依赖 freshness）
			const neededSubs = hasExplicitFilter && isGoal
				? allNames
				: force && isGoal
					? allNames
					: verdict?.subtestsToRun?.length
						? verdict.subtestsToRun
						: verdict?.kind === 'unknown' || verdict?.kind === 'red' || verdict?.kind === 'noisy'
							? allNames
							: []
			subtestsToRun = hasExplicitFilter
				? neededSubs.filter(name => filter.includes(name))
				: neededSubs
		}

		const base = {
			key,
			suite,
			goal: isGoal,
			goalEvidence: goalEvidenceByKey.get(key),
			requiredBy: provenance.get(key) ?? null,
			subtestsToRun,
			...hasExplicitFilter && !suite.subtests?.length ? { fileFilters: filter } : {},
		}

		const blockedBy = listBlockingDeps(key, planned, verdicts, byKey)
		if (blockedBy.length) {
			planned.set(key, { ...base, action: 'blocked', blockedBy })
			continue
		}

		// 显式子测试过滤后无交集 → 无事可做，复用
		if (suite.subtests?.length && Array.isArray(subtestsToRun) && !subtestsToRun.length && !force) {
			planned.set(key, { ...base, action: 'reuse' })
			continue
		}

		if (!goalMustRun(isGoal, verdict, force, hasExplicitFilter) && verdictReusable(verdict, false)) {
			planned.set(key, { ...base, action: 'reuse' })
			continue
		}

		planned.set(key, { ...base, action: 'run' })
	}

	return {
		slots: sorted.map(suite => planned.get(suiteKey(suite.manifestId, suite.name))),
		goalKeys,
	}
}
