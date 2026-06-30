/**
 * 【文件】public/hub/messages/messageActionsHandlers.mjs
 * 【职责】频道消息行操作的事件委托：编辑保存、删除、反馈、置顶、投票、信任作者等点击处理。
 * 【原理】在 `#hub-messages` 上绑定 `data-action`，弹出确认框、内联编辑区与 Toast 反馈；操作成功后局部更新 DOM 或触发 `loadMessages`/增量刷新；与 `messageActionsRender` 按钮定义配合。
 * 【数据结构】hubStore（core/state）及本模块函数入参/返回值；详见 JSDoc。
 * 【关联】../../../../../scripts/i18n、../../../../../scripts/markdown、../../../../../scripts/toast、../../src/api/groupApi、../../src/share、../threadDrawer、messageActionsState、messageActionsUi。
 */
import { renderMarkdownAsStandAloneHtmlString } from '../../../../../scripts/features/markdown/index.mjs'
import { showToastI18n } from '../../../../../scripts/features/toast.mjs'
import { confirmI18n } from '../../../../../scripts/i18n/index.mjs'
import {
	addChatBookmark,
	deleteChannelMessage,
	editChannelMessage,
	getGroupState,
	modifyChannelTimeline,
	pinMessage,
	unpinMessage,
	setChannelMessageFeedback,
	triggerChannelReply,
} from '../../src/api/groupApi.mjs'
import { createShareLink } from '../../src/share.mjs'
import { hubStore } from '../core/state.mjs'
import { refreshPinsBookmarks } from '../pinsBookmarks.mjs'
import { openThread } from '../threadDrawer.mjs'

import {
	activeFeedbackEdits,
	enqueueDeletion,
	findContextMessage,
	getChannelMessageActionsContext,
	showFeedbackReasonInput,
} from './messageActionsState.mjs'
import {
	appendEditArea,
	bindMessageEditArea,
	editChannelBodyHtml,
	removeWithFade,
	shouldConfirmDelete,
} from './messageActionsUi.mjs'
import { getMessageEditText, getMessageText } from './messageRender.mjs'

const ACTION_BTN_SELECTOR = '.hub-message-action[data-action]'

/**
 * 处理频道 DAG 消息的操作（停止、反馈、时间线、书签等）。
 * @param {HTMLElement} button 被点击按钮
 * @param {HTMLElement | null} row 消息行
 * @param {object} channelMessage 上下文消息
 * @param {object} actions 操作上下文
 * @returns {Promise<boolean>} 是否已处理
 */
async function handleChannelMessageClick(button, row, channelMessage, actions) {
	const { groupId, channelId, reload } = actions
	const { action } = button.dataset
	if (!action) return false

	if (action === 'feedback-submit' || action === 'feedback-cancel') {
		const area = button.closest('.hub-message-feedback-reason-area')
		const eventId = button.dataset.eventId || area?.dataset.eventId
		if (!eventId || !area) return true
		if (action === 'feedback-cancel') {
			activeFeedbackEdits.delete(eventId)
			void removeWithFade(area)
			return true
		}
		const type = area.dataset.feedbackType === 'down' ? 'down' : 'up'
		const reason = area.querySelector('textarea')?.value?.trim() || ''
		button.disabled = true
		try {
			await setChannelMessageFeedback(groupId, channelId, eventId, type, reason)
			activeFeedbackEdits.delete(eventId)
			await removeWithFade(area)
			await reload?.()
		}
		catch (error) {
			showToastI18n('error', 'chat.hub.messageActionFailed', { error: error?.message || String(error) })
		}
		finally { button.disabled = false }
		return true
	}

	if (action === 'timeline') {
		if (!groupId || !channelId) return false
		const delta = Number(button.dataset.delta)
		if (!Number.isFinite(delta)) return true
		button.disabled = true
		try {
			await modifyChannelTimeline(groupId, channelId, delta)
			await reload?.()
		}
		catch (error) {
			showToastI18n('error', 'chat.hub.messageActionFailed', { error: error?.message || String(error) })
		}
		finally { button.disabled = false }
		return true
	}

	if (action === 'regen') {
		if (!groupId || !channelId) return false
		const eventId = button.dataset.eventId?.trim()
		button.disabled = true
		try {
			await modifyChannelTimeline(groupId, channelId, Number.POSITIVE_INFINITY)
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

	const { eventId } = button.dataset
	if (!eventId) return false
	if (!groupId || !channelId) return false

	switch (action) {
		case 'bookmark': {
			button.disabled = true
			try {
				const rowMessageId = button.closest('.hub-message')?.getAttribute('data-message-id')
				const bookmarkedMessage = actions.messages?.find(message => String(message.eventId) === rowMessageId)
				const preview = bookmarkedMessage ? getMessageText(bookmarkedMessage).slice(0, 40) : eventId.slice(0, 12)
				await addChatBookmark({
					groupId,
					channelId,
					eventId,
					title: preview || eventId.slice(0, 12),
					href: `#group:${groupId}:${channelId}`,
				})
				void refreshPinsBookmarks()
			}
			catch (error) {
				showToastI18n('error', 'chat.hub.messageActionFailed', { error: error?.message || String(error) })
			}
			finally { button.disabled = false }
			return true
		}
		case 'pin': {
			const unpin = button.dataset.pinned === '1'
			button.disabled = true
			try {
				if (unpin) await unpinMessage(groupId, channelId, eventId)
				else await pinMessage(groupId, channelId, eventId)
				hubStore.currentState = await getGroupState(groupId)
				await reload?.()
			}
			catch (error) {
				showToastI18n('error', 'chat.hub.messageActionFailed', { error: error?.message || String(error) })
			}
			finally { button.disabled = false }
			return true
		}
		case 'edit': {
			const messageRow = button.closest('.hub-message')
			if (messageRow?.querySelector('.hub-message-edit-area')) return true
			const contextMessage = findContextMessage(messageRow, actions) || {}
			const originalText = String(
				contextMessage.content_for_edit
				?? getMessageEditText(contextMessage)
				?? messageRow?.querySelector('.hub-message-content')?.textContent
				?? '',
			)
			const initialFiles = Array.isArray(contextMessage.files)
				? contextMessage.files
				: Array.isArray(contextMessage.content?.files)
					? contextMessage.content.files
					: []
			const editWrap = await appendEditArea(messageRow, await editChannelBodyHtml(originalText, eventId))
			let charEditor = null
			/** @returns {Promise<void>} */
			const saveCharEdit = async () => {
				if (!charEditor) return
				const saveButton = editWrap?.querySelector('.hub-message-edit-save')
				if (saveButton instanceof HTMLButtonElement) saveButton.disabled = true
				try {
					await editChannelMessage(groupId, channelId, eventId, charEditor.getText())
					await removeWithFade(editWrap)
					await reload?.()
				}
				catch (error) {
					showToastI18n('error', 'chat.hub.messageActionFailed', { error: error?.message || String(error) })
				}
				finally {
					if (saveButton instanceof HTMLButtonElement) saveButton.disabled = false
				}
			}
			/** @returns {Promise<void>} */
			const cancelCharEdit = () => removeWithFade(editWrap)
			charEditor = bindMessageEditArea(editWrap, {
				initialFiles,
				onCancel: cancelCharEdit,
				onSave: saveCharEdit,
			})
			const textarea = editWrap?.querySelector('textarea')
			if (textarea instanceof HTMLTextAreaElement) {
				textarea.focus()
				textarea.setSelectionRange(textarea.value.length, textarea.value.length)
			}
			return true
		}
		case 'edit-save':
		case 'edit-cancel':
			return true
		case 'feedback-up': {
			const messageRow = /** @type {HTMLElement | null} */ button.closest('.hub-message, .hub-char-entry')
			void showFeedbackReasonInput(messageRow, eventId, 'up')
			return true
		}
		case 'feedback-down': {
			const messageRow = /** @type {HTMLElement | null} */ button.closest('.hub-message, .hub-char-entry')
			void showFeedbackReasonInput(messageRow, eventId, 'down')
			return true
		}
		case 'thread': {
			const title = getMessageText(channelMessage).slice(0, 40)
				|| row?.querySelector('.hub-message-content')?.textContent?.trim().slice(0, 40)
				|| ''
			void openThread(groupId, channelId, eventId, title)
			return true
		}
		case 'delete': {
			const text = getMessageText(channelMessage)
				|| row?.querySelector('.hub-message-content')?.textContent?.trim()
				|| ''
			if (shouldConfirmDelete(text) && !confirmI18n('chat.hub.confirmDeleteLong'))
				return true
			button.disabled = true
			enqueueDeletion(async () => {
				try {
					await deleteChannelMessage(groupId, channelId, eventId)
					await reload?.()
				}
				catch (error) {
					showToastI18n('error', 'chat.hub.messageActionFailed', { error: error?.message || String(error) })
					button.disabled = false
				}
			})
			return true
		}
		case 'copy-md':
		case 'copy-text':
		case 'copy-html':
		case 'download':
		case 'share':
			return handleClipboardActionClick(button, row, channelMessage, action)
		default:
			return false
	}
}

/**
 * 为消息列表绑定操作按钮委托（仅绑定一次）。
 * @param {HTMLElement} container `#hub-messages` 根节点
 * @returns {void}
 */
export function bindChannelMessageActions(container) {
	if (!(container instanceof HTMLElement)) return
	if (container.dataset.hubChannelActionsBound === '1') return
	container.dataset.hubChannelActionsBound = '1'
	container.addEventListener('click', async (clickEvent) => {
		const actions = getChannelMessageActionsContext()
		if (!actions) return
		const retryBtn = /** @type {HTMLElement} */ clickEvent.target.closest('[data-retry-send]')
		if (retryBtn?.dataset.retrySend) {
			clickEvent.stopPropagation()
			const tempId = retryBtn.dataset.retrySend
			try {
				const { retryFailedPendingMessage } = await import('./messages.mjs')
				await retryFailedPendingMessage(tempId)
			}
			catch (error) {
				showToastI18n('error', 'chat.hub.sendFailed', { error: error?.message || String(error) })
			}
			return
		}
		const button = /** @type {HTMLElement} */ clickEvent.target.closest(ACTION_BTN_SELECTOR)
		if (!button) return
		clickEvent.stopPropagation()

		const row = button.closest('.hub-message, .hub-char-entry')
		const channelMessage = findContextMessage(row, actions) || {}

		await handleChannelMessageClick(button, row, channelMessage, actions)
	})
}

/**
 * 处理复制、分享、下载类按钮点击。
 * @param {HTMLElement} button 被点击按钮
 * @param {HTMLElement | null} row 消息行
 * @param {object} channelMessage 上下文消息
 * @param {string} action data-action 值
 * @returns {Promise<boolean>} 是否已处理
 */
async function handleClipboardActionClick(button, row, channelMessage, action) {
	if (action === 'copy-md') {
		const text = getMessageText(channelMessage) || row?.querySelector('.hub-message-content')?.textContent?.trim() || ''
		try {
			await navigator.clipboard.writeText(text)
		}
		catch (error) {
			console.error(error)
		}
		return true
	}
	if (action === 'copy-text') {
		const contentElement = row?.querySelector('.hub-message-content')
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
			const markdown = getMessageText(channelMessage) || row?.querySelector('.hub-message-content')?.textContent?.trim() || ''
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
