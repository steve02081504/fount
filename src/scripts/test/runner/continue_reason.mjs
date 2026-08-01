/**
 * 触发原因：由计划槽位 goalEvidence / provenance 格式化为报告文案。
 */

/**
 * @typedef {'missing_state_record' | 'imperfect_failed' | 'imperfect_noisy' | 'imperfect_blocked' | 'imperfect_dependent' | 'stale_content' | 'trigger_hash_drift' | 'explicit_selected' | 'dependency_required'} GoalEvidenceKind
 */

/**
 * 目标纳入证据（续跑 / 报告用）。
 * @typedef {object} GoalEvidence
 * @property {GoalEvidenceKind} kind 证据类型
 * @property {string | null} [fromCommit] 记录侧 HEAD
 * @property {string} [toCommit] 当前 HEAD
 * @property {string | null} [fromUncommittedHash] 记录侧未提交 digest
 * @property {string | null} [toUncommittedHash] 当前未提交 digest
 * @property {string[]} [matchedTriggers] 命中的 trigger glob
 * @property {string[]} [matchedTriggerSets] 命中的 triggerSet 名
 * @property {string[]} [matchedPaths] 命中的变更路径
 * @property {boolean} [triggerHashDrift] trigger 内容指纹是否漂移
 * @property {string[]} [blockedBy] 阻塞来源 suite 键
 * @property {string | null} [parentKey] imperfect 一层下游的父键
 * @property {string} [requiredBy] 依赖拉入的直接纳入方
 */

/** @typedef {GoalEvidence} ContinueReason */

/**
 * 从计划槽位提取触发原因。
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
 * 由运行计划构建 suite 键 → 触发原因表。
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
