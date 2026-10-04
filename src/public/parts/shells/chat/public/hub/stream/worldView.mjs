/**
 * 【文件】public/hub/stream/worldView.mjs
 * 【职责】WS `world_set`：本机世界绑定变化后重读群状态与消息投影。
 */
import { handleError } from '/scripts/features/errorHandlers.mjs'
import { store } from '../core/state.mjs'

import { refreshGroupState } from './stateRefresh.mjs'

/**
 * 重读群状态；世界投影变了连消息与其他视图一起重载（原先被世界隐藏的消息也要回来）。
 * @param {string} groupId 群 ID
 * @param {string | null} changedChannelId 绑定变化的频道；`null` 为群默认世界
 * @returns {Promise<void>}
 */
async function refreshWorldView(groupId, changedChannelId) {
	if (!await refreshGroupState(groupId)) return
	if (!changedChannelId || changedChannelId === store.context.currentChannelId) {
		const { loadMessages } = await import('../messages/messages.mjs')
		await loadMessages()
	}
	const { refreshActiveThreadIfOpen } = await import('../threadDrawer.mjs')
	await refreshActiveThreadIfOpen()
}

/**
 * @param {object} wireMessage WS 载荷
 * @returns {boolean} 是否已处理
 */
export function handleWorldSetWire(wireMessage) {
	if (wireMessage.type !== 'world_set') return false
	const groupId = store.context.currentGroupId
	if (groupId) refreshWorldView(groupId, wireMessage.payload?.channelId).catch(handleError('chat.hub.load.messagesFailed'))
	return true
}
