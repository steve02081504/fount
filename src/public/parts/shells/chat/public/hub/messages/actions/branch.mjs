/**
 * 【文件】public/hub/messages/actions/branch.mjs
 * 【职责】时间线步进与重新生成。
 */
import { showToastI18n } from '../../../../../../scripts/features/toast.mjs'
import { deleteChannelMessage, modifyBranch, triggerChannelReply } from '../../../src/api/groupChannel.mjs'

/**
 * @param {HTMLElement} button 被点击按钮
 * @param {object} actions 操作上下文
 * @returns {Promise<boolean>} 是否已处理
 */
export async function handleTimeline(button, actions) {
	const { groupId, channelId, reload } = actions
	if (!groupId || !channelId) return false
	const delta = Number(button.dataset.delta)
	if (!Number.isFinite(delta)) return true
	button.disabled = true
	try {
		await modifyBranch(groupId, channelId, delta)
		await reload?.()
	}
	catch (error) {
		showToastI18n('error', 'chat.hub.messageActionFailed', { error: error?.message || String(error) })
	}
	finally { button.disabled = false }
	return true
}

/**
 * @param {HTMLElement} button 被点击按钮
 * @param {object} actions 操作上下文
 * @returns {Promise<boolean>} 是否已处理
 */
export async function handleRegen(button, actions) {
	const { groupId, channelId, reload } = actions
	if (!groupId || !channelId) return false
	const eventId = button.dataset.eventId?.trim()
	button.disabled = true
	try {
		await modifyBranch(groupId, channelId, undefined, { latest: true })
		if (eventId)
			await deleteChannelMessage(groupId, channelId, eventId)
		const charId = button.dataset.charId?.trim()
		await triggerChannelReply(groupId, channelId, charId || undefined)
		await reload?.()
	}
	catch (error) {
		showToastI18n('error', 'chat.hub.messageActionFailed', { error: error?.message || String(error) })
	}
	finally { button.disabled = false }
	return true
}
