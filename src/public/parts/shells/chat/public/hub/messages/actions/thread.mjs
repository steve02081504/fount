/**
 * 【文件】public/hub/messages/actions/thread.mjs
 * 【职责】打开消息线程抽屉。
 */
import { openThread } from '../../threadDrawer.mjs'
import { getMessageText } from '../render/text.mjs'

/**
 * @param {HTMLElement} button 被点击按钮
 * @param {HTMLElement | null} row 消息行
 * @param {object} channelMessage 上下文消息
 * @param {object} actions 操作上下文
 * @returns {boolean} 是否已处理
 */
export function handleThread(button, row, channelMessage, actions) {
	const { groupId, channelId } = actions
	const eventId = button.dataset.eventId
	if (!eventId || !groupId || !channelId) return false
	const title = getMessageText(channelMessage).slice(0, 40)
		|| row?.querySelector('.message-content')?.textContent?.trim().slice(0, 40)
		|| ''
	void openThread(groupId, channelId, eventId, title)
	return true
}
