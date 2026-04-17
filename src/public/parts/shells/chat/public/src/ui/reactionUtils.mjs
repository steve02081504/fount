import { handleUIError, normalizeError } from '../utils.mjs'

/**
 * 创建群消息表情回应处理函数集。
 * @param {{ groupId: string, channelId: string }} ctx 上下文
 * @returns {{ toggleReaction: Function }} 表情回应处理函数集
 */
export function createReactionHandlers(ctx) {
	const { groupId, channelId } = ctx

	/**
	 * 切换对某条消息的表情回应（添加或撤销）。
	 * @param {string} targetEventId 目标消息事件 ID
	 * @param {string} emoji 表情字符
	 * @param {boolean} remove 是否撤销
	 * @returns {Promise<void>}
	 */
	const toggleReaction = async (targetEventId, emoji, remove) => {
		try {
			const r = await fetch(
				`/api/parts/shells:chat/groups/${encodeURIComponent(groupId)}/channels/chat/${encodeURIComponent(channelId)}/reactions`,
				{
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({ targetEventId, emoji, remove: remove || undefined, sender: 'local' }),
				},
			)
			if (!r.ok)
				handleUIError(new Error(`toggleReaction HTTP ${r.status}`), 'chat.group.reactionFailed', 'toggleReaction')
		}
		catch (e) {
			handleUIError(normalizeError(e), 'chat.group.reactionFailed', 'toggleReaction')
		}
	}

	return { toggleReaction }
}
