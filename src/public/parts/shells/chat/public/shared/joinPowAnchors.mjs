/**
 * 从物化群 state 提取入群 PoW anchor（前后端共用）。
 * 稳定根优先：checkpoint root / consensus branch tip / membersRoot 在 DAG tips 之前，
 * 这样调用方取 `anchors[0]` 即最不易过期的锚（tips 随新事件被引用后即从集合消失）。
 * @param {object} state 物化群 state
 * @returns {string[]} 近期 DAG tip / checkpoint root 候选
 */
export function collectJoinPowAnchors(state) {
	/** @type {string[]} */
	const anchors = []
	for (const key of ['checkpoint_event_id', 'consensusBranchTip', 'membersRoot']) {
		const anchor = state?.[key]
		if (anchor) anchors.push(anchor)
	}
	const tips = Array.isArray(state?.dagTips) ? state.dagTips : []
	for (const tip of tips)
		if (tip) anchors.push(tip)
	return [...new Set(anchors.filter(Boolean))]
}
