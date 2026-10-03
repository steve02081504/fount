/**
 * 从物化 overlay 聚合当前页消息的反应计票。
 * @param {object} state 物化群状态
 * @param {string} channelId 频道 ID
 * @param {string[]} messageEventIds 当前页 message eventId
 * @returns {Record<string, Record<string, { voters: string[] }>>} targetEventId → emoji → 投票者
 */
export function aggregateReactionsForMessages(state, channelId, messageEventIds) {
	const reactions = state?.messageOverlay?.reactions
	if (!(reactions instanceof Map) || !reactions.size || !messageEventIds?.length) return {}
	const senderIndex = state.messageSenderIndex || {}
	const targetSet = new Set(messageEventIds.filter(Boolean))
	/** @type {Record<string, Record<string, { voters: string[] }>>} */
	const out = {}
	for (const [key, voters] of reactions) {
		const sepIdx = key.indexOf(':')
		if (sepIdx <= 0) continue
		const targetId = key.slice(0, sepIdx)
		const emoji = key.slice(sepIdx + 1)
		if (!emoji || !voters?.size || !targetSet.has(targetId)) continue
		const indexed = senderIndex[targetId]
		// 无真实频道的消息不得匹配任何频道（不伪造 'default'）。
		if (!indexed?.channelId || indexed.channelId !== channelId) continue
		if (!out[targetId]) out[targetId] = {}
		out[targetId][emoji] = { voters: [...voters] }
	}
	return out
}
