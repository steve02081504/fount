/**
 * 【文件】public/hub/messages/actions/clipboard.mjs
 * 【职责】复制 / 下载 / 分享类消息操作。
 */
import { renderMarkdownAsStandAloneHtmlString } from '../../../../../../scripts/features/markdown/index.mjs'
import { showToastI18n } from '../../../../../../scripts/features/toast.mjs'
import { createShareLink } from '../../../src/share.mjs'
import { getMessageText } from '../render/text.mjs'

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
			const markdown = getMessageText(channelMessage) || row?.querySelector('.message-content')?.textContent?.trim() || ''
			const html = await renderMarkdownAsStandAloneHtmlString(markdown, {})
			const blob = new Blob([html], { type: 'text/html' })
			await navigator.clipboard.write([
				new ClipboardItem({ 'text/html': blob, 'text/plain': new Blob([markdown], { type: 'text/plain' }) }),
			])
		}
		catch (error) {
			console.error(error)
		}
		return true
	}
	if (action === 'download') {
		try {
			const markdown = getMessageText(channelMessage) || ''
			const html = await renderMarkdownAsStandAloneHtmlString(markdown, {})
			const blob = new Blob([html], { type: 'text/html' })
			const url = URL.createObjectURL(blob)
			const anchor = document.createElement('a')
			anchor.href = url
			anchor.download = `message-${button.dataset.eventId || 'export'}.html`
			anchor.click()
			URL.revokeObjectURL(url)
		}
		catch (error) {
			console.error(error)
		}
		return true
	}
	if (action === 'share') {
		try {
			showToastI18n('info', 'chat.messageView.share.uploading')
			const markdown = getMessageText(channelMessage) || ''
			const html = await renderMarkdownAsStandAloneHtmlString(markdown, {})
			const blob = new Blob([html], { type: 'text/html' })
			const link = await createShareLink(blob, `message-${button.dataset.eventId || 'export'}.html`, button.dataset.time || '24h')
			await navigator.clipboard.writeText(link)
			showToastI18n('success', 'chat.messageView.share.success', {
				provider: 'litterbox.moe',
				sponsorLink: 'https://store.catbox.moe/',
			})
		}
		catch (error) {
			console.error(error)
		}
		return true
	}
	return false
}
