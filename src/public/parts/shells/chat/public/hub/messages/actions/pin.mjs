/**
 * 【文件】public/hub/messages/actions/pin.mjs
 * 【职责】频道消息置顶 / 取消置顶。
 */
import { showToastI18n } from '../../../../../../scripts/features/toast.mjs'
import { pinMessage, unpinMessage } from '../../../src/api/groupChannel.mjs'
import { getGroupState } from '../../../src/api/groupCore.mjs'
import { isDagEventId } from '../../../src/lib/eventId.mjs'
import { store } from '../../core/state.mjs'

/**
 * @param {HTMLElement} button 被点击按钮
 * @param {object} actions 操作上下文
 * @returns {Promise<boolean>} 是否已处理
 */
export async function handlePin(button, actions) {
	const { groupId, channelId, reload } = actions
	const eventId = button.dataset.eventId
		|| button.closest('.message')?.getAttribute('data-message-id')
	if (!isDagEventId(eventId) || !groupId || !channelId) return false
	const unpin = button.dataset.pinned === '1'
	button.disabled = true
	try {
		if (unpin) await unpinMessage(groupId, channelId, eventId)
		else await pinMessage(groupId, channelId, eventId)
		store.context.currentState = await getGroupState(groupId)
		await reload?.()
	}
	catch (error) {
		showToastI18n('error', 'chat.hub.messageActionFailed', { error: error?.message || String(error) })
	}
	finally { button.disabled = false }
	return true
}
