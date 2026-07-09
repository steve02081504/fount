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
 * @param {Set<string>} goalKeys 用户目标键
 * @param {Map<string, Verdict>} verdicts 裁决表
 * @param {Map<string, SuiteDef>} byKey 全部 suite
 * @param {SuiteDef[]} allSuites 全部 suite（拓扑 tie-break）
 * @param {Map<string, GoalEvidence>} [goalEvidenceByKey] 目标证据
 * @param {boolean} [force] 强制真跑目标
 * @returns {RunPlan} 运行计划
 */
export function buildPlan(goalKeys, verdicts, byKey, allSuites, goalEvidenceByKey = new Map(), force = false) {
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
		const base = {
			key,
			suite,
			goal: isGoal,
			goalEvidence: goalEvidenceByKey.get(key),
			requiredBy: provenance.get(key) ?? null,
		}

		const blockedBy = listBlockingDeps(key, planned, verdicts, byKey)
		if (blockedBy.length) {
			planned.set(key, { ...base, action: 'blocked', blockedBy })
			continue
		}

		if (verdictReusable(verdict, force && isGoal)) {
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
