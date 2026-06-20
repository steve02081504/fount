/**
 * 无状态入群 PoW 校验辅助：从物化 state 提取 anchor、判断历史 replay。
 */

/**
 * @param {object} state 物化群 state
 * @returns {string[]} 近期 DAG tip / checkpoint root 候选
 */
export function collectJoinPowAnchors(state) {
	/** @type {string[]} */
	const anchors = []
	if (Array.isArray(state.dagTips))
		for (const tip of state.dagTips) {
			const id = String(tip || '').trim()
			if (id) anchors.push(id)
		}
	for (const key of ['consensusBranchTip', 'membersRoot', 'checkpoint_event_id']) {
		const v = state[key]
		if (v) anchors.push(String(v).trim())
	}
	return [...new Set(anchors.filter(Boolean))]
}

/**
 * @param {object} state 物化群 state
 * @param {{ sender?: string }} event member_join 事件
 * @returns {boolean} 是否为 checkpoint/历史成员 replay（跳过 PoW）
 */
export function joinPowExemptAsHistoricalReplay(state, event) {
	const senderKey = String(event.sender || '').trim().toLowerCase()
	return state.members?.[senderKey]?.status === 'active'
}
