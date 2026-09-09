/**
 * 【文件】public/hub/messages/messageContextMenu.mjs
 * 【职责】频道消息右键/长按上下文菜单：复制、回复、反应、置顶等快捷入口的单例弹出层。
 * 【原理】`showMessageContextMenu` 定位到消息行旁；`dismissMessageContextMenu` 关闭并移除 DOM；根据消息行 `data-event-id` 读取上下文，不生成完整气泡 HTML。
 * 【数据结构】store（core/state）及本模块函数入参/返回值；详见 JSDoc。
 * 【关联】../../../../../scripts/i18n、../../../../../scripts/markdown、../../../../../scripts/template、../../../../../scripts/toast、../../src/share、../core/state、../threadDrawer、messageActionsState。
 */
import { showToastI18n } from '../../../../../scripts/features/toast.mjs'
import { confirmI18n } from '../../../../../scripts/i18n/index.mjs'
import { isDagEventId } from '../../src/lib/eventId.mjs'
import { renderTemplate } from '../../src/templates.mjs'
import { setReplyTarget } from '../composerReply.mjs'
import { bindDismissOnDocumentInteraction } from '/scripts/components/contextMenuDismiss.mjs'
import { authorPresentationKeys } from '../core/domUtils.mjs'
import { positionContextMenu } from '/scripts/components/positionContextMenu.mjs'
import { store } from '../core/state.mjs'
import { openThread } from '../threadDrawer.mjs'
import { createGist } from '/parts/shells:gist/src/endpoints.mjs'

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
 * 把消息导出为 gist 并跳转查看页。
 * @param {object} message 消息行
 * @param {HTMLElement | null} row 消息 DOM
 * @param {object} actions 操作上下文
 * @param {string} eventId 事件 id
 * @returns {Promise<void>} 导出完成
 */
async function exportMessageToGist(message, row, actions, eventId) {
	const markdown = getMessageText(message) || row?.querySelector('.message-content')?.textContent?.trim() || ''
	const author = message.charId ?? message.authorPubKeyHash ?? message.sender ?? ''
	const gist = await createGist({
		markdown,
		title: markdown.split('\n').find(Boolean)?.trim().slice(0, 40) || 'gist',
		securityLevel: 'trusted',
		source: {
			type: 'chat',
			ref: {
				groupId: actions.groupId,
				channelId: actions.channelId,
				eventId,
				author,
			},
			exportedAt: Date.now(),
		},
	})
	location.href = '/parts/shells:gist/view?id=' + encodeURIComponent(gist.id)
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
	const showReplyRow = !!eventId && isDagEventId(eventId) && message.type === 'message'
	const showThreadRow = !!actions.groupId && !!actions.channelId && !!eventId
		&& !!store.context.currentState?.channelCaps?.[currentChannelId]?.canCreateThreads
	const showEdit = !!row.querySelector('.message-action[data-action="edit"]')
	const showDelete = !!row.querySelector('.message-action[data-action="delete"]')
	const showCopyIdRow = !!eventId

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
		void (async () => {
			try {
				showToastI18n('info', 'chat.gist_source_plugins.creating')
				await exportMessageToGist(message, row, actions, eventId)
			}
			catch (error) {
				console.error(error)
			}
			closeOnce()
		})()
	})
	menu.querySelector('[data-action="shareExternal"]')?.addEventListener('click', () => {
		void (async () => {
			try {
				showToastI18n('info', 'chat.gist_source_plugins.creating')
				await exportMessageToGist(message, row, actions, eventId)
			}
			catch (error) {
				console.error(error)
			}
			closeOnce()
		})()
	})
	menu.querySelector('[data-action="replyInline"]')?.addEventListener('click', () => {
		const { displayName } = authorPresentationKeys(message.charId ?? message.authorPubKeyHash ?? message.sender ?? '?')
		setReplyTarget({
			eventId,
			senderName: message.content?.name || displayName,
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
