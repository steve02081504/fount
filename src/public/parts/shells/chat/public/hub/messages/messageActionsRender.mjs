/**
 * 【文件】public/hub/messages/messageActionsRender.mjs
 * 【职责】根据权限与消息类型生成消息行内操作按钮 HTML（回复、编辑、删除、反馈、置顶等）。
 * 【原理】输出两个区域：
 *   - hoverHtml：悬停时显示的浮动操作栏（绝对定位）；
 *   - inlineHtml：常驻显示的紧凑反馈栏（重新生成 + 点赞/点踩，仅角色消息）。
 * 【数据结构】见函数入参与返回值 JSDoc。
 * 【关联】../../src/lib/channelContent、../../src/lib/emojiSvg、../core/domUtils、messageActionsUi、messageRender
 */
import { channelMessageText } from '../../src/lib/channelContent.mjs'
import {
	hubActionBookmarkIcon,
	hubActionCopyHtmlIcon,
	hubActionCopyIcon,
	hubActionCopyTextIcon,
	hubActionDeleteIcon,
	hubActionDownloadIcon,
	hubActionEditIcon,
	hubActionPinIcon,
	hubActionRegenIcon,
	hubActionShareIcon,
	hubActionThreadIcon,
	hubActionThumbDownIcon,
	hubActionThumbUpIcon,
	hubActionTimelineNextIcon,
	hubActionTimelinePrevIcon,
	hubActionUnpinIcon,
} from '../../src/lib/emojiSvg.mjs'
import { escapeHtml } from '../core/domUtils.mjs'

import { actionButton, menuActionItem, renderActionsBar } from './messageActionsUi.mjs'
import { isChannelMessageGenerating } from './messageRender.mjs'

/**
 * 是否为本节点发出的角色消息。
 * @param {object} message 消息行
 * @param {object} opts 查看者上下文
 * @returns {boolean} 是否己方角色
 */
function isOwnCharMessage(message, opts) {
	if (!message?.charId) return false
	if (message.isRemote) return false
	const localCharIds = opts.localCharIds?.length
		? opts.localCharIds
		: opts.localCharId
			? [opts.localCharId]
			: []
	if (localCharIds.includes(message.charId)) return true
	const viewer = String(opts.viewerPubKeyHash || '').trim().toLowerCase()
	const sender = String(message.authorPubKeyHash || '').trim().toLowerCase()
	return !!(viewer && sender && viewer === sender)
}

/**
 * 是否允许删除该消息。
 * @param {object} message 消息行
 * @param {object} opts 权限上下文
 * @returns {boolean} 可删除
 */
function canDeleteMessage(message, opts) {
	if (!message?.eventId) return false
	if (isOwnCharMessage(message, opts)) return true
	if (message.charId && opts.canManageMessages) return true
	if (!message.charId) {
		const viewer = String(opts.viewerPubKeyHash || '').toLowerCase()
		const sender = String(message.authorPubKeyHash || '').toLowerCase()
		if (viewer && sender && viewer === sender) return true
	}
	return false
}

/**
 * 渲染本机角色消息的常驻内联反馈按钮（重新生成 + 👍/👎）。
 * @param {string} eventId 已转义事件 id
 * @param {string} charId 已转义角色 id
 * @param {string} feedbackUpClass 点赞高亮 class
 * @param {string} feedbackDownClass 点踩高亮 class
 * @param {boolean} showRegen 是否显示重新生成按钮
 * @returns {string} 内联反馈 HTML
 */
function renderOwnCharFeedbackInline(eventId, charId, feedbackUpClass, feedbackDownClass, showRegen) {
	const parts = []
	if (showRegen)
		parts.push(actionButton({
			action: 'regen',
			attrs: `data-event-id="${eventId}" data-char-id="${charId}"`,
			icon: hubActionRegenIcon,
			i18nKey: 'chat.hub.messageActionRegen',
		}))
	parts.push(
		actionButton({
			action: 'feedback-up',
			attrs: `data-event-id="${eventId}"`,
			icon: hubActionThumbUpIcon,
			i18nKey: 'chat.hub.messageActionFeedbackUp',
			classes: feedbackUpClass,
		}),
		actionButton({
			action: 'feedback-down',
			attrs: `data-event-id="${eventId}"`,
			icon: hubActionThumbDownIcon,
			i18nKey: 'chat.hub.messageActionFeedbackDown',
			classes: feedbackDownClass,
		}),
	)
	return parts.join('')
}

/**
 * 渲染本机角色消息悬停栏的编辑 + 菜单内容。
 * @param {string} eventId 已转义事件 id
 * @param {string} charId 已转义角色 id
 * @returns {{ inlineHover: string, menuItems: string, shiftHtml: string }} 悬停栏各区 HTML
 */
function renderOwnCharHoverParts(eventId, charId) {
	const inlineHover = actionButton({
		action: 'edit',
		attrs: `data-event-id="${eventId}"`,
		icon: hubActionEditIcon,
		i18nKey: 'chat.hub.messageActionEdit',
	})
	const menuItems = [
		menuActionItem('timeline', `data-event-id="${eventId}" data-delta="-1"`, hubActionTimelinePrevIcon, 'chat.hub.menuPrev'),
		menuActionItem('timeline', `data-event-id="${eventId}" data-delta="1"`, hubActionTimelineNextIcon, 'chat.hub.menuNext'),
		menuActionItem('copy-md', `data-event-id="${eventId}"`, hubActionCopyIcon, 'chat.hub.menuMD'),
		menuActionItem('copy-text', `data-event-id="${eventId}"`, hubActionCopyTextIcon, 'chat.hub.menuTXT'),
		menuActionItem('copy-html', `data-event-id="${eventId}"`, hubActionCopyHtmlIcon, 'chat.hub.menuHTML'),
		menuActionItem('share', `data-event-id="${eventId}" data-time="1h"`, hubActionShareIcon, 'chat.hub.menuShare.1h'),
		menuActionItem('share', `data-event-id="${eventId}" data-time="12h"`, hubActionShareIcon, 'chat.hub.menuShare.12h'),
		menuActionItem('share', `data-event-id="${eventId}" data-time="24h"`, hubActionShareIcon, 'chat.hub.menuShare.24h'),
		menuActionItem('share', `data-event-id="${eventId}" data-time="72h"`, hubActionShareIcon, 'chat.hub.menuShare.72h'),
	].join('')
	const shiftHtml = actionButton({
		action: 'download',
		attrs: `data-event-id="${eventId}"`,
		icon: hubActionDownloadIcon,
	})
	return { inlineHover, menuItems, shiftHtml }
}

/**
 * 渲染消息操作 HTML，返回悬停浮动栏与常驻内联反馈栏两个区域。
 * @param {object} message 消息行
 * @param {object} opts 权限上下文
 * @returns {Promise<{ hoverHtml: string, inlineHtml: string }>} 两个区域 HTML
 */
export async function renderMessageActionsHtml(message, opts) {
	const eventId = String(message.eventId)
	if (!eventId || message.type !== 'message') return { hoverHtml: '', inlineHtml: '' }

	const ownChar = !message.isRemote && isOwnCharMessage(message, opts)
	const generating = isChannelMessageGenerating(message)
	if (generating) return { hoverHtml: '', inlineHtml: '' }

	const feedbackType = message.extension?.feedback?.type
	const pinnedIds = Array.isArray(opts.pinnedEventIds) ? opts.pinnedEventIds : []
	const isPinned = pinnedIds.includes(eventId)
	const alwaysVisible = !!opts.alwaysVisibleActions && !!(message.charId || ownChar)
	const escapedEventId = escapeHtml(eventId)

	// ===== 常驻内联反馈栏（仅本机角色消息在双人对话中显示） =====
	let inlineHtml = ''
	if (alwaysVisible && ownChar) {
		const feedbackHtml = renderOwnCharFeedbackInline(
			escapedEventId,
			escapeHtml(String(message.charId || '')),
			feedbackType === 'up' ? 'text-success' : '',
			feedbackType === 'down' ? 'text-error' : '',
			!!opts.isLastMessage,
		)
		inlineHtml = `<div class="hub-message-inline-feedback flex items-center gap-0.5">${feedbackHtml}</div>`
	}

	// ===== 悬停浮动栏 =====
	const hoverInlineParts = []
	let menuItems = ''
	let shiftHtml = ''

	// 子线程回复
	if (opts.canCreateThreads)
		hoverInlineParts.push(actionButton({
			action: 'thread',
			attrs: `data-event-id="${escapedEventId}"`,
			icon: hubActionThreadIcon,
			i18nKey: 'chat.hub.replyInThread',
		}))

	// 书签 + 置顶（本地消息）
	if (!message.isRemote) {
		hoverInlineParts.push(actionButton({
			action: 'bookmark',
			attrs: `data-event-id="${escapedEventId}"`,
			icon: hubActionBookmarkIcon,
			i18nKey: 'chat.hub.messageActionBookmark',
		}))
		if (opts.canPinMessages)
			hoverInlineParts.push(actionButton({
				action: 'pin',
				attrs: `data-event-id="${escapedEventId}" data-pinned="${isPinned ? '1' : '0'}"`,
				icon: isPinned ? hubActionUnpinIcon : hubActionPinIcon,
				i18nKey: isPinned ? 'chat.hub.messageActionUnpin' : 'chat.hub.messageActionPin',
			}))
	}

	if (ownChar) {
		const { inlineHover, menuItems: ownMenu, shiftHtml: ownShift } = renderOwnCharHoverParts(
			escapedEventId,
			escapeHtml(String(message.charId || '')),
		)
		hoverInlineParts.push(inlineHover)
		menuItems = ownMenu
		const deleteBtn = canDeleteMessage(message, opts)
			? actionButton({ action: 'delete', attrs: `data-event-id="${escapedEventId}"`, icon: hubActionDeleteIcon, i18nKey: 'chat.hub.messageActionDelete' })
			: ''
		shiftHtml = ownShift + deleteBtn
	}
	else if (!message.isRemote && canDeleteMessage(message, opts)) {
		const showEdit = !message.charId && !!channelMessageText(message.content)
		if (showEdit)
			hoverInlineParts.push(actionButton({ action: 'edit', attrs: `data-event-id="${escapedEventId}"`, icon: hubActionEditIcon, i18nKey: 'chat.hub.messageActionEdit' }))
		shiftHtml = actionButton({ action: 'delete', attrs: `data-event-id="${escapedEventId}"`, icon: hubActionDeleteIcon, i18nKey: 'chat.hub.messageActionDelete' })
	}
	else if (!ownChar) {
		menuItems = [
			menuActionItem('copy-md', `data-event-id="${escapedEventId}"`, hubActionCopyIcon, 'chat.hub.menuMD'),
			menuActionItem('copy-text', `data-event-id="${escapedEventId}"`, hubActionCopyTextIcon, 'chat.hub.menuTXT'),
			menuActionItem('copy-html', `data-event-id="${escapedEventId}"`, hubActionCopyHtmlIcon, 'chat.hub.menuHTML'),
			menuActionItem('share', `data-event-id="${escapedEventId}" data-time="1h"`, hubActionShareIcon, 'chat.hub.menuShare.1h'),
			menuActionItem('share', `data-event-id="${escapedEventId}" data-time="12h"`, hubActionShareIcon, 'chat.hub.menuShare.12h'),
			menuActionItem('share', `data-event-id="${escapedEventId}" data-time="24h"`, hubActionShareIcon, 'chat.hub.menuShare.24h'),
			menuActionItem('share', `data-event-id="${escapedEventId}" data-time="72h"`, hubActionShareIcon, 'chat.hub.menuShare.72h'),
		].join('')
		shiftHtml = actionButton({ action: 'download', attrs: `data-event-id="${escapedEventId}"`, icon: hubActionDownloadIcon })
	}

	const hoverHtml = await renderActionsBar(
		hoverInlineParts.join(''),
		menuItems,
		shiftHtml,
		{ alwaysVisible: false },
	)

	return { hoverHtml, inlineHtml }
}
