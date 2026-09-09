/**
 * 【文件】public/hub/messages/actions/clipboard.mjs
 * 【职责】复制 / 下载 / 分享类消息操作。
 */
import { showToastI18n } from '../../../../../../scripts/features/toast.mjs'
import { store } from '../../core/state.mjs'
import { generateMessageStandaloneHtml } from '../exportHtml.mjs'
import { getMessageText } from '../render/text.mjs'
import { createGist } from '/parts/shells:gist/src/endpoints.mjs'

/**
 * 复制消息分享链接到剪贴板。
 * @param {HTMLElement} button 被点击按钮
 * @param {object} actions 操作上下文
 * @returns {Promise<boolean>} 是否已处理
 */
export async function handleCopyShareLink(button, actions) {
	const { groupId, channelId } = actions
	const eventId = button.dataset.eventId?.trim()
	if (!groupId || !channelId || !eventId) return true
	try {
		const { formatMessageRunUri, wrapProtocolHttpsUrl } = await import('../../../shared/runUri.mjs')
		const shareUrl = wrapProtocolHttpsUrl(formatMessageRunUri(groupId, channelId, eventId))
		await navigator.clipboard.writeText(shareUrl)
		showToastI18n('success', 'chat.hub.copyShareLink')
	}
	catch (error) {
		console.error('copy share link failed', error)
	}
	return true
}

/**
 * 把消息导出为 gist 并跳转查看页。
 * @param {object} channelMessage 消息
 * @param {HTMLElement | null} row 消息行
 * @param {string} eventId 事件 id
 * @returns {Promise<void>} 导出完成
 */
async function exportMessageToGist(channelMessage, row, eventId) {
	const markdown = getMessageText(channelMessage) || row?.querySelector('.message-content')?.textContent?.trim() || ''
	const groupId = store.context.currentGroupId
	const channelId = store.context.currentChannelId
	const author = channelMessage?.charId ?? channelMessage?.authorPubKeyHash ?? channelMessage?.sender ?? ''
	const gist = await createGist({
		markdown,
		title: markdown.split('\n').find(Boolean)?.trim().slice(0, 40) || 'gist',
		securityLevel: 'trusted',
		source: {
			type: 'chat',
			ref: { groupId, channelId, eventId, author },
			exportedAt: Date.now(),
		},
	})
	location.href = '/parts/shells:gist/view?id=' + encodeURIComponent(gist.id)
}

/**
 * 处理复制、分享、下载类按钮点击。
 * @param {HTMLElement} button 被点击按钮
 * @param {HTMLElement | null} row 消息行
 * @param {object} channelMessage 上下文消息
 * @param {string} action data-action 值
 * @returns {Promise<boolean>} 是否已处理
 */
export async function handleClipboardAction(button, row, channelMessage, action) {
	if (action === 'copy-md') {
		const text = getMessageText(channelMessage) || row?.querySelector('.message-content')?.textContent?.trim() || ''
		try {
			await navigator.clipboard.writeText(text)
		}
		catch (error) {
			console.error(error)
		}
		return true
	}
	if (action === 'copy-text') {
		const contentElement = row?.querySelector('.message-content')
		try {
			await navigator.clipboard.writeText(contentElement?.textContent?.trim() || getMessageText(channelMessage))
		}
		catch (error) {
			console.error(error)
		}
		return true
	}
	if (action === 'copy-html') {
		try {
			const html = await generateMessageStandaloneHtml(channelMessage, row)
			await navigator.clipboard.writeText(html)
		}
		catch (error) {
			console.error(error)
		}
		return true
	}
	if (action === 'download' || action === 'share') {
		try {
			const eventId = button.dataset.eventId?.trim() || String(channelMessage?.eventId || '')
			showToastI18n('info', 'chat.gist_source_plugins.creating')
			await exportMessageToGist(channelMessage, row, eventId)
		}
		catch (error) {
			console.error(error)
		}
		return true
	}
	return false
}
