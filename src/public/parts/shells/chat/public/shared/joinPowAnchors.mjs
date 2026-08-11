/**
 * 从物化群 state 提取入群 PoW anchor（前后端共用）。
 * @param {object} state 物化群 state
 * @returns {string[]} 近期 DAG tip / checkpoint root 候选
 */
export function collectJoinPowAnchors(state) {
	/** @type {string[]} */
	const anchors = []
	const tips = Array.isArray(state?.dagTips) ? state.dagTips : []
	for (const tip of tips)
		if (tip) anchors.push(tip)
	for (const key of ['consensusBranchTip', 'membersRoot', 'checkpoint_event_id']) {
		const v = state?.[key]
		if (v) anchors.push(v)
	}
	return [...new Set(anchors.filter(Boolean))]
}
