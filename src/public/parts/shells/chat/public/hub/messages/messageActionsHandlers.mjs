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
	modifyBranch,
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
			await modifyBranch(groupId, channelId, delta)
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
				hubStore.context.currentState = await getGroupState(groupId)
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
		case 'copy-share-link':
			return handleCopyShareLink(button, actions)
		case 'forward':
			return handleForward(button, channelMessage, actions)
		case 'translate':
			return handleTranslate(button, row, channelMessage)
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
		const joinBtn = /** @type {HTMLElement} */ clickEvent.target.closest('.hub-call-join-btn')
		if (joinBtn) {
			clickEvent.stopPropagation()
			const { hubStore } = await import('../core/state.mjs')
			const groupId = hubStore.context.currentGroupId
			const channelId = hubStore.context.currentChannelId
			if (groupId && channelId) {
				const { joinChannelCall } = await import('../call.mjs')
				await joinChannelCall(groupId, channelId)
			}
			return
		}
		const actions = getChannelMessageActionsContext()
		if (!actions) return
		const retryButton = /** @type {HTMLElement} */ clickEvent.target.closest('[data-retry-send]')
		if (retryButton?.dataset.retrySend) {
			clickEvent.stopPropagation()
			const tempId = retryButton.dataset.retrySend
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
 * 复制消息分享链接到剪贴板。
 * @param {HTMLElement} button 被点击按钮
 * @param {object} actions 操作上下文
 * @returns {Promise<boolean>} 是否已处理
 */
async function handleCopyShareLink(button, actions) {
	const { groupId, channelId } = actions
	const eventId = button.dataset.eventId?.trim()
	if (!groupId || !channelId || !eventId) return true
	try {
		const { formatMessageRunUri, wrapProtocolHttpsUrl } = await import('../../shared/runUri.mjs')
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
 * 弹出转发对话框，选择目标群+频道后发送。
 * @param {HTMLElement} button 被点击按钮
 * @param {object} channelMessage 原消息
 * @param {object} actions 操作上下文
 * @returns {Promise<boolean>} 是否已处理
 */
async function handleForward(button, channelMessage, actions) {
	const { groupId, channelId } = actions
	const eventId = button.dataset.eventId?.trim()
	if (!eventId) return true

	const sidebarGroups = hubStore.sidebar.groups || []
	if (!sidebarGroups.length) {
		showToastI18n('info', 'chat.hub.forwardDialog.selectGroup')
		return true
	}

	const { geti18n } = await import('../../../../../scripts/i18n/index.mjs')
	/**
	 * @param {string|{title?:string}|undefined} v i18n 值
	 * @returns {string} 字符串表示
	 */
	const g = v => typeof v === 'string' ? v : v?.title || ''
	const titleLabel = g(geti18n('chat.hub.forwardDialog.title')) || 'Forward message'
	const selectGroupLabel = g(geti18n('chat.hub.forwardDialog.selectGroup')) || 'Select group'
	const selectChannelLabel = g(geti18n('chat.hub.forwardDialog.selectChannel')) || 'Select channel'
	const confirmLabel = g(geti18n('chat.hub.forwardDialog.confirm')) || 'Forward'
	const cancelLabel = g(geti18n('chat.hub.forwardDialog.cancel')) || 'Cancel'

	const dialog = document.createElement('dialog')
	dialog.className = 'modal'
	dialog.innerHTML = `
		<div class="modal-box">
			<h3 class="font-bold text-lg mb-3">${titleLabel}</h3>
			<label class="form-control w-full mb-2">
				<span class="label-text">${selectGroupLabel}</span>
				<select id="fwd-group-select" class="select select-bordered w-full"></select>
			</label>
			<label class="form-control w-full mb-4">
				<span class="label-text">${selectChannelLabel}</span>
				<select id="fwd-channel-select" class="select select-bordered w-full"></select>
			</label>
			<div class="flex justify-end gap-2">
				<button type="button" data-cancel class="btn btn-ghost">${cancelLabel}</button>
				<button type="button" data-confirm class="btn btn-primary">${confirmLabel}</button>
			</div>
		</div>
		<form method="dialog" class="modal-backdrop"><button></button></form>
	`
	document.body.appendChild(dialog)

	const groupSelect = dialog.querySelector('#fwd-group-select')
	const channelSelect = dialog.querySelector('#fwd-channel-select')

	// 填充群组列表
	for (const g of sidebarGroups) {
		const opt = document.createElement('option')
		opt.value = g.groupId || g.id || ''
		opt.textContent = g.groupName || g.name || opt.value
		groupSelect?.appendChild(opt)
	}

	const { getGroupState } = await import('../../src/api/groupApi.mjs')

	/** @returns {Promise<void>} 刷新频道选项 */
	const updateChannels = async () => {
		if (!channelSelect) return
		channelSelect.innerHTML = ''
		const selGroupId = groupSelect?.value
		if (!selGroupId) return
		try {
			const state = await getGroupState(selGroupId)
			const chs = state?.channels || {}
			for (const [chId, ch] of Object.entries(chs)) {
				if (ch.type && ch.type !== 'text') continue
				const opt = document.createElement('option')
				opt.value = chId
				opt.textContent = ch.name || chId
				channelSelect.appendChild(opt)
			}
		}
		catch { /* empty */ }
	}

	groupSelect?.addEventListener('change', () => { void updateChannels() })
	await updateChannels()

	dialog.querySelector('[data-cancel]')?.addEventListener('click', () => dialog.close())
	dialog.querySelector('[data-confirm]')?.addEventListener('click', async () => {
		const targetGroupId = groupSelect?.value
		const targetChannelId = channelSelect?.value
		if (!targetGroupId || !targetChannelId) return
		dialog.close()
		try {
			const { sendGroupMessage } = await import('../../src/api/groupApi.mjs')
			const text = getMessageText(channelMessage)
			const senderName = channelMessage.content?.displayName
				|| String(channelMessage.sender || '').slice(0, 8)
				|| '?'
			const { formatMessageRunUri, wrapProtocolHttpsUrl } = await import('../../shared/runUri.mjs')
			const shareUrl = groupId && channelId && eventId
				? wrapProtocolHttpsUrl(formatMessageRunUri(groupId, channelId, eventId))
				: ''
			const forwardContent = {
				type: 'text',
				content: text,
				locale: channelMessage.content?.locale || navigator.language,
				forwardedFrom: {
					groupId: groupId || '',
					channelId: channelId || '',
					eventId: eventId || '',
					senderName,
					shareUrl,
				},
			}
			await sendGroupMessage(targetGroupId, targetChannelId, forwardContent)
			showToastI18n('success', 'chat.hub.forwardDialog.success')
		}
		catch (error) {
			showToastI18n('error', 'chat.hub.forwardDialog.failed', { error: error?.message || String(error) })
		}
	})

	dialog.addEventListener('close', () => { dialog.remove() })
	dialog.showModal()
	return true
}

/**
 * 翻译消息文本，在气泡下挂载译文块。
 * @param {HTMLElement} button 被点击按钮
 * @param {HTMLElement | null} row 消息行
 * @param {object} channelMessage 消息
 * @returns {Promise<boolean>} 是否已处理
 */
async function handleTranslate(button, row, channelMessage) {
	const text = getMessageText(channelMessage)
	if (!text) return true
	button.disabled = true
	try {
		const { mountTranslationBlock, requestTranslation, resolveTargetLang } = await import('../../../../../scripts/features/translate.mjs')
		const { geti18n } = await import('../../../../../scripts/i18n/index.mjs')
		const targetLang = resolveTargetLang()
		const translated = await requestTranslation('/api/parts/shells:chat/translate', text, targetLang)
		const bubble = row?.querySelector('.hub-message-content')
		if (bubble instanceof HTMLElement) {
			const showOrigLabel = String(
				(v => typeof v === 'string' ? v : v?.title || '')(geti18n('chat.hub.translateShowOriginal')),
			) || 'Original'
			const showTransLabel = String(
				(v => typeof v === 'string' ? v : v?.title || '')(geti18n('chat.hub.translateShowTranslation')),
			) || 'Translation'
			const transLabel = String(
				(v => typeof v === 'string' ? v : v?.title || '')(geti18n('chat.hub.translateLabel')),
			) || ''
			mountTranslationBlock(bubble, {
				originalText: text,
				translatedText: translated,
				showOriginalLabel: showOrigLabel,
				showTranslationLabel: showTransLabel,
				translationLabel: transLabel,
			})
		}
	}
	catch (error) {
		showToastI18n('error', 'chat.hub.translateFailed', { error: error?.message || String(error) })
	}
	finally { button.disabled = false }
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
