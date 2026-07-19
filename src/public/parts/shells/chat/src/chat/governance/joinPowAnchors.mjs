/**
 * 无状态入群 PoW 校验辅助：历史 replay 判定；anchor 提取见 shared/joinPowAnchors。
 */
export { collectJoinPowAnchors } from '../../../public/shared/joinPowAnchors.mjs'

/**
 * @param {object} state 物化群 state
 * @param {{ sender?: string }} event member_join 事件
 * @returns {boolean} 是否为 checkpoint/历史成员 replay（跳过 PoW）
 */
export function joinPowExemptAsHistoricalReplay(state, event) {
	const senderKey = String(event.sender || '').trim().toLowerCase()
	return state.members?.[senderKey]?.status === 'active'
}
