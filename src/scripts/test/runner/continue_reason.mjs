/**
 * 触发原因：由计划槽位 goalEvidence / provenance 格式化为报告文案。
 */

/**
 * @typedef {'missing_state_record' | 'imperfect_failed' | 'imperfect_noisy' | 'imperfect_blocked' | 'imperfect_dependent' | 'stale_content' | 'explicit_selected' | 'dependency_required'} GoalEvidenceKind
 */

/**
 * @typedef {object} GoalEvidence
 * @property {GoalEvidenceKind} kind
 * @property {string | null} [fromCommit]
 * @property {string} [toCommit]
 * @property {string | null} [fromUncommittedHash]
 * @property {string | null} [toUncommittedHash]
 * @property {string[]} [matchedTriggers]
 * @property {string[]} [matchedTriggerSets]
 * @property {string[]} [matchedPaths]
 * @property {string[]} [blockedBy]
 * @property {string | null} [parentKey] imperfect 一层下游的父键
 * @property {string} [requiredBy] 依赖拉入的直接纳入方
 */

/** @typedef {GoalEvidence} ContinueReason */

/**
 * @param {import('../core/plan.mjs').PlanSlot} slot 计划槽位
 * @returns {ContinueReason | undefined} 触发原因
 */
export function reasonFromPlanSlot(slot) {
	if (slot.goalEvidence)
		return slot.goalEvidence
	if (slot.requiredBy)
		return { kind: 'dependency_required', requiredBy: slot.requiredBy }
}

/**
 * @param {import('../core/plan.mjs').RunPlan} plan 运行计划
 * @returns {Map<string, ContinueReason>} suite 键 -> 原因
 */
export function buildReasonsFromPlan(plan) {
	/** @type {Map<string, ContinueReason>} */
	const map = new Map()
	for (const slot of plan.slots) {
		const reason = reasonFromPlanSlot(slot)
		if (reason) map.set(slot.key, reason)
	}
	return map
}
