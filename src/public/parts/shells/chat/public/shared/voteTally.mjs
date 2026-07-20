/**
 * 重放 `vote_cast` 计票（前后端共用）。
 * @param {object[]} channelMessages 频道全部事件行
 * @param {string} ballotEventId 投票消息 eventId
 * @returns {Map<string, number>} 选项文案 → 票数
 */
export function tallyVoteChoices(channelMessages, ballotEventId) {
	const choiceByVoter = new Map()
	for (const message of channelMessages) {
		if (message.type !== 'vote_cast' || message.content?.ballotId !== ballotEventId) continue
		if (message.content?.choice == null) continue
		choiceByVoter.set(String(message.sender || message.eventId), String(message.content.choice))
	}
	const counts = new Map()
	for (const choice of choiceByVoter.values())
		counts.set(choice, (counts.get(choice) || 0) + 1)
	return counts
}
