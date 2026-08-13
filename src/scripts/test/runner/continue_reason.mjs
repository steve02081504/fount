/**
 * 触发原因：由计划槽位抽取，并格式化为报告 / 终端文案。
 */
import { geti18n } from '../../i18n/bare.mjs'

/**
 * @typedef {'missing_state_record' | 'imperfect_failed' | 'imperfect_noisy' | 'imperfect_blocked' | 'imperfect_dependent' | 'stale_content' | 'trigger_hash_drift' | 'explicit_selected' | 'dependency_required' | 'skip_because'} GoalEvidenceKind
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

/** @typedef {GoalEvidenceKind} ContinueReasonKind */
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

/**
 * 把原因表编成可 JSON 的数组。
 * @param {Map<string, ContinueReason> | undefined} map 原因表
 * @returns {Array<ContinueReason & { key: string }>} 序列化
 */
export function serializeContinueReasons(map) {
	if (!map?.size) return []
	return [...map.entries()].map(([key, reason]) => ({ key, ...reason }))
}

/**
 * @param {ContinueReasonKind | string} kind 原因类型
 * @param {{ strict?: boolean }} [opts] strict 时未知 kind 抛错
 * @returns {string} 可读标签
 */
export function formatReasonKindLabel(kind, { strict = false } = {}) {
	switch (kind) {
		case 'imperfect_failed':
			return geti18n('fountConsole.test.report.reason.imperfect.failed')
		case 'imperfect_noisy':
			return geti18n('fountConsole.test.report.reason.imperfect.noisy')
		case 'imperfect_blocked':
			return geti18n('fountConsole.test.report.reason.imperfect.blocked')
		case 'imperfect_dependent':
			return geti18n('fountConsole.test.report.reason.imperfect.dependent')
		case 'missing_state_record':
			return geti18n('fountConsole.test.report.reason.missingRecord')
		case 'stale_content':
			return geti18n('fountConsole.test.report.reason.staleContent')
		case 'trigger_hash_drift':
			return geti18n('fountConsole.test.report.reason.triggerHashDrift')
		case 'explicit_selected':
			return geti18n('fountConsole.test.report.reason.explicitSelected')
		case 'dependency_required':
			return geti18n('fountConsole.test.report.reason.dependencyRequired')
		case 'skip_because':
			return geti18n('fountConsole.test.report.reason.skipBecause')
	}
	if (strict)
		throw new Error(`unknown continue reason kind: ${kind}`)
	return kind
}

/**
 * @param {ContinueReason} reason 续跑原因
 * @returns {string} 可读原因标签
 */
export function formatContinueReasonLabel(reason) {
	return formatReasonKindLabel(reason.kind, { strict: true })
}
