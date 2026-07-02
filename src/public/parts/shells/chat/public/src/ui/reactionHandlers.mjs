/**
 * 【文件】public/src/ui/reactionHandlers.mjs
 * 【职责】群消息表情回应 toggle：POST/DELETE 频道 reaction API 并 handleUIError。
 * 【原理】createReactionHandlers({ groupId, channelId }) 返回 toggleReaction；groupPath 拼 REST。
 * 【数据结构】targetEventId、emoji、remove 布尔、targetPubKeyHash 可选。
 * 【关联】groupClient.mjs、channelDisplay.mjs、errors.mjs。
 */
import { groupPath } from '../api/groupClient.mjs'

import { handleUIError } from './errors.mjs'

/**
 * 创建群消息表情回应处理函数集。
 * @param {{ groupId: string, channelId: string }} channelScope 频道作用域
 * @returns {{ toggleReaction: (targetEventId: string, emoji: string, remove: boolean, targetPubKeyHash?: string) => Promise<void> }} 表情回应处理函数集
 */
export function createReactionHandlers(channelScope) {
	const { groupId, channelId } = channelScope

	/**
	 * 切换对某条消息的表情回应（添加或撤销；管理员可指定 `targetPubKeyHash`）。
	 * @param {string} targetEventId 目标消息事件 ID
	 * @param {string} emoji 表情字符
	 * @param {boolean} remove 是否撤销
	 * @param {string} [targetPubKeyHash] 被代签移除的成员 pubKeyHash
	 * @returns {Promise<void>}
	 */
	const toggleReaction = async (targetEventId, emoji, remove, targetPubKeyHash) => {
		try {
			const url = `/api/parts/shells:chat/groups/${groupPath(groupId, 'channels', channelId, 'reactions')}`
			if (remove) {
				const response = await fetch(url, {
					method: 'DELETE',
					headers: { 'Content-Type': 'application/json' },
					credentials: 'include',
					body: JSON.stringify({
						targetEventId,
						emoji,
						...targetPubKeyHash ? { targetPubKeyHash } : {},
					}),
				})
				if (!response.ok)
					return handleUIError(new Error(`toggleReaction HTTP ${response.status}`), 'chat.hub.reactionFailed')
			}
			else {
				const response = await fetch(url, {
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					credentials: 'include',
					body: JSON.stringify({ targetEventId, emoji }),
				})
				if (!response.ok)
					handleUIError(new Error(`toggleReaction HTTP ${response.status}`), 'chat.hub.reactionFailed')
			}
		}
		catch (error) {
			handleUIError(error, 'chat.hub.reactionFailed')
		}
	}

	return { toggleReaction }
}
