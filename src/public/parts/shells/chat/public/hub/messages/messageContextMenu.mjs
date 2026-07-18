/**
 * 【文件】public/hub/messages/messageContextMenu.mjs
 * 【职责】频道消息右键/长按上下文菜单：复制、回复、反应、置顶等快捷入口的单例弹出层。
 * 【原理】`showMessageContextMenu` 定位到消息行旁；`dismissMessageContextMenu` 关闭并移除 DOM；根据消息行 `data-event-id` 读取上下文，不生成完整气泡 HTML。
 * 【数据结构】store（core/state）及本模块函数入参/返回值；详见 JSDoc。
 * 【关联】../../../../../scripts/i18n、../../../../../scripts/markdown、../../../../../scripts/template、../../../../../scripts/toast、../../src/share、../core/state、../threadDrawer、messageActionsState。
 */
import { renderMarkdownAsStandAloneHtmlString } from '../../../../../scripts/features/markdown/index.mjs'
import {
	renderTemplate,
	usingTemplates,
} from '../../../../../scripts/features/template.mjs'
import { showToastI18n } from '../../../../../scripts/features/toast.mjs'
import { confirmI18n } from '../../../../../scripts/i18n/index.mjs'
import { createShareLink } from '../../src/share.mjs'
import { setReplyTarget } from '../composerReply.mjs'
import { bindDismissOnDocumentInteraction } from '../core/contextMenuDismiss.mjs'
import { authorPresentationKeys } from '../core/domUtils.mjs'
import { positionContextMenu } from '../core/positionContextMenu.mjs'
import { store } from '../core/state.mjs'
import { openThread } from '../threadDrawer.mjs'


import { findContextMessage, getChannelMessageActionsContext } from './messageActionsState.mjs'
import { shouldConfirmDelete } from './messageActionsUi.mjs'
import { getMessageText } from './render/text.mjs'

/** @type {HTMLElement | null} */
let openMenuElement = null

/** @returns {void} */
export function dismissMessageContextMenu() {
	if (!openMenuElement) return
	openMenuElement.hidePopover?.()
	openMenuElement.remove()
	openMenuElement = null
}

/**
 * @param {object} message 消息行
 * @param {HTMLElement | null} row 消息 DOM
 * @returns {Promise<void>}
 */
async function copyMessageText(message, row) {
	const text = getMessageText(message) || row?.querySelector('.message-content')?.textContent?.trim() || ''
	await navigator.clipboard.writeText(text)
}

/**
 * @param {object} message 消息行
 * @param {HTMLElement | null} row 消息 DOM
 * @returns {Promise<void>}
 */
async function exportMessageHtml(message, row) {
	const markdown = getMessageText(message) || row?.querySelector('.message-content')?.textContent?.trim() || ''
	const html = await renderMarkdownAsStandAloneHtmlString(markdown, {})
	const blob = new Blob([html], { type: 'text/html' })
	const url = URL.createObjectURL(blob)
	const anchor = document.createElement('a')
	anchor.href = url
	anchor.download = `message-${message.eventId || 'export'}.html`
	anchor.click()
	URL.revokeObjectURL(url)
}

/**
 * @param {MouseEvent} event 右键事件
 * @param {HTMLElement} row 消息行
 * @returns {Promise<void>}
 */
export async function showMessageContextMenu(event, row) {
	event.preventDefault()
	event.stopPropagation()
	dismissMessageContextMenu()

	const actions = getChannelMessageActionsContext(row)
	if (!actions) return
	const message = findContextMessage(row, actions)
	if (!message) return
	const eventId = String(message.eventId || row.getAttribute('data-message-id') || '')
	const plainText = getMessageText(message) || row.querySelector('.message-content')?.textContent?.trim() || ''
	const showTextActions = !!plainText.trim() && message.type === 'message'
	const { currentChannelId } = store
	const showReplyRow = !!eventId && /^[0-9a-f]{64}$/i.test(eventId) && message.type === 'message'
	const showThreadRow = !!actions.groupId && !!actions.channelId && !!eventId
		&& !!store.context.currentState?.channelCaps?.[currentChannelId]?.canCreateThreads
	const showEdit = !!row.querySelector('.message-action[data-action="edit"]')
	const showDelete = !!row.querySelector('.message-action[data-action="delete"]')
	const showCopyIdRow = !!eventId

	usingTemplates('/parts/shells:chat/src/templates')
	const menu = await renderTemplate('hub/messages/message_context_menu', {
		showTextActions,
		showReplyRow,
		showThreadRow,
		showEdit,
		showDelete,
		showCopyIdRow,
	})
	document.body.appendChild(menu)
	positionContextMenu(menu, { x: event.clientX, y: event.clientY })
	menu.showPopover?.()
	openMenuElement = menu

	const closeOnce = bindDismissOnDocumentInteraction(dismissMessageContextMenu)

	menu.querySelector('[data-action="copy"]')?.addEventListener('click', () => {
		void copyMessageText(message, row).then(closeOnce)
	})
	menu.querySelector('[data-action="exportHtml"]')?.addEventListener('click', () => {
		void exportMessageHtml(message, row).then(closeOnce)
	})
	menu.querySelector('[data-action="shareExternal"]')?.addEventListener('click', () => {
		void (async () => {
			showToastI18n('info', 'chat.messageView.share.uploading')
			const markdown = getMessageText(message) || ''
			const html = await renderMarkdownAsStandAloneHtmlString(markdown, {})
			const blob = new Blob([html], { type: 'text/html' })
			const link = await createShareLink(blob, `message-${eventId || 'export'}.html`, '24h')
			await navigator.clipboard.writeText(link)
			showToastI18n('success', 'chat.messageView.share.success', {
				provider: 'litterbox.moe',
				sponsorLink: 'https://store.catbox.moe/',
			})
			closeOnce()
		})()
	})
	menu.querySelector('[data-action="replyInline"]')?.addEventListener('click', () => {
		const { displayName } = authorPresentationKeys(message.charId ?? message.authorPubKeyHash ?? message.sender ?? '?')
		setReplyTarget({
			eventId,
			senderName: message.content?.displayName || displayName,
			preview: plainText.slice(0, 120) || '…',
		})
		closeOnce()
	})
	menu.querySelector('[data-action="openThread"]')?.addEventListener('click', () => {
		const title = plainText.slice(0, 40)
		void openThread(actions.groupId, actions.channelId, eventId, title)
		closeOnce()
	})
	menu.querySelector('[data-action="copyEventId"]')?.addEventListener('click', () => {
		void navigator.clipboard.writeText(eventId).then(closeOnce)
	})
	menu.querySelector('[data-action="edit"]')?.addEventListener('click', () => {
		row.querySelector('.message-action[data-action="edit"]')?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
		closeOnce()
	})
	menu.querySelector('[data-action="delete"]')?.addEventListener('click', () => {
		if (shouldConfirmDelete(plainText) && !confirmI18n('chat.hub.confirmDeleteLong')) return
		row.querySelector('.message-action[data-action="delete"]')?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
		closeOnce()
	})
}
