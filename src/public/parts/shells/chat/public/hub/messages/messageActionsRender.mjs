/**
 * 【文件】public/hub/messages/messageActionsRender.mjs
 * 【职责】根据权限与消息类型生成消息行内操作按钮 HTML（回复、编辑、删除、反馈、置顶等）。
 * 【原理】输出嵌入气泡的 `renderMessageActionsHtml` 片段，含折叠菜单与 shift 提示区占位。与 `messageRender.renderChannelMessageBlock` 组合；导出 `isMessageGenerating` 供操作条显隐。
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
 * @param {string} eventId 已转义的事件 id
 * @param {string} charId 已转义的角色 id
 * @param {string} feedbackUpClass 点赞高亮 class
 * @param {string} feedbackDownClass 点踩高亮 class
 * @param {boolean} showRegen 是否显示重新生成
 * @returns {string} 行内按钮 HTML
 */
function renderOwnCharInline(eventId, charId, feedbackUpClass, feedbackDownClass, showRegen) {
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
			action: 'edit',
			attrs: `data-event-id="${eventId}"`,
			icon: hubActionEditIcon,
			i18nKey: 'chat.hub.messageActionEdit',
		}),
		actionButton({
			action: 'copy-md',
			attrs: `data-event-id="${eventId}"`,
			icon: hubActionCopyIcon,
			i18nKey: 'chat.hub.menuMD',
		}),
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
 * @param {string} eventId 已转义的事件 id
 * @returns {string} 菜单项 HTML
 */
function renderOwnCharMenu(eventId) {
	return [
		menuActionItem('timeline', `data-event-id="${eventId}" data-delta="-1"`, hubActionTimelinePrevIcon, 'chat.hub.menuPrev'),
		menuActionItem('timeline', `data-event-id="${eventId}" data-delta="1"`, hubActionTimelineNextIcon, 'chat.hub.menuNext'),
		menuActionItem('copy-text', `data-event-id="${eventId}"`, hubActionCopyTextIcon, 'chat.hub.menuTXT'),
		menuActionItem('copy-html', `data-event-id="${eventId}"`, hubActionCopyHtmlIcon, 'chat.hub.menuHTML'),
		menuActionItem('share', `data-event-id="${eventId}" data-time="1h"`, hubActionShareIcon, 'chat.hub.menuShare.1h'),
		menuActionItem('share', `data-event-id="${eventId}" data-time="12h"`, hubActionShareIcon, 'chat.hub.menuShare.12h'),
		menuActionItem('share', `data-event-id="${eventId}" data-time="24h"`, hubActionShareIcon, 'chat.hub.menuShare.24h'),
		menuActionItem('share', `data-event-id="${eventId}" data-time="72h"`, hubActionShareIcon, 'chat.hub.menuShare.72h'),
	].join('')
}

/**
 * @param {string} eventId 已转义的事件 id
 * @returns {string} 远程消息菜单 HTML
 */
function renderRemoteUtilMenu(eventId) {
	return [
		menuActionItem('copy-md', `data-event-id="${eventId}"`, hubActionCopyIcon, 'chat.hub.menuMD'),
		menuActionItem('copy-text', `data-event-id="${eventId}"`, hubActionCopyTextIcon, 'chat.hub.menuTXT'),
		menuActionItem('copy-html', `data-event-id="${eventId}"`, hubActionCopyHtmlIcon, 'chat.hub.menuHTML'),
		menuActionItem('share', `data-event-id="${eventId}" data-time="1h"`, hubActionShareIcon, 'chat.hub.menuShare.1h'),
		menuActionItem('share', `data-event-id="${eventId}" data-time="12h"`, hubActionShareIcon, 'chat.hub.menuShare.12h'),
		menuActionItem('share', `data-event-id="${eventId}" data-time="24h"`, hubActionShareIcon, 'chat.hub.menuShare.24h'),
		menuActionItem('share', `data-event-id="${eventId}" data-time="72h"`, hubActionShareIcon, 'chat.hub.menuShare.72h'),
	].join('')
}

/**
 * @param {string} eventId 已转义的事件 id
 * @param {boolean} showBookmark 是否显示书签
 * @param {boolean} showPin 是否显示置顶
 * @param {boolean} isPinned 是否已置顶
 * @returns {string} 书签/置顶按钮 HTML
 */
function renderBookmarkPin(eventId, showBookmark, showPin, isPinned) {
	const parts = []
	if (showBookmark) 
		parts.push(actionButton({
			action: 'bookmark',
			attrs: `data-event-id="${eventId}"`,
			icon: hubActionBookmarkIcon,
			i18nKey: 'chat.hub.messageActionBookmark',
		}))
	
	if (showPin) 
		parts.push(actionButton({
			action: 'pin',
			attrs: `data-event-id="${eventId}" data-pinned="${isPinned ? '1' : '0'}"`,
			icon: isPinned ? hubActionUnpinIcon : hubActionPinIcon,
			i18nKey: isPinned ? 'chat.hub.messageActionUnpin' : 'chat.hub.messageActionPin',
		}))
	
	return parts.join('')
}

/**
 * 渲染消息操作栏 HTML。
 * @param {object} message 消息行
 * @param {object} opts 权限上下文
 * @returns {string} HTML 片段
 */
export async function renderMessageActionsHtml(message, opts) {
	const eventId = String(message.eventId)
	if (!eventId || message.type !== 'message') return ''

	const ownChar = !message.isRemote && isOwnCharMessage(message, opts)
	const generating = isChannelMessageGenerating(message)
	const feedbackType = message.extension?.feedback?.type
	const pinnedIds = Array.isArray(opts.pinnedEventIds) ? opts.pinnedEventIds : []
	const isPinned = pinnedIds.includes(eventId)
	const alwaysVisible = !!opts.alwaysVisibleActions && !!(message.charId || ownChar)
	const actionOpts = { alwaysVisible }
	const parts = []
	const escapedEventId = escapeHtml(eventId)

	if (!generating && opts.canCreateThreads && message.type === 'message') 
		parts.push(actionButton({
			action: 'thread',
			attrs: `data-event-id="${escapedEventId}"`,
			icon: hubActionThreadIcon,
			i18nKey: 'chat.hub.replyInThread',
		}))
	

	if (!message.isRemote && message.type === 'message') 
		parts.push(renderBookmarkPin(
			escapedEventId,
			true,
			!!opts.canPinMessages,
			isPinned,
		))
	

	if (ownChar && !generating) {
		const inline = renderOwnCharInline(
			escapedEventId,
			escapeHtml(String(message.charId || '')),
			feedbackType === 'up' ? 'text-success' : '',
			feedbackType === 'down' ? 'text-error' : '',
			!!opts.isLastMessage,
		)
		const menu = renderOwnCharMenu(escapedEventId)
		const shift = [
			actionButton({
				action: 'download',
				attrs: `data-event-id="${escapedEventId}"`,
				icon: hubActionDownloadIcon,
			}),
			canDeleteMessage(message, opts)
				? actionButton({
					action: 'delete',
					attrs: `data-event-id="${escapedEventId}"`,
					icon: hubActionDeleteIcon,
					i18nKey: 'chat.hub.messageActionDelete',
				})
				: '',
		].join('')
		parts.push(await renderActionsBar(inline, menu, shift, actionOpts))
	}
	else if (!message.isRemote && canDeleteMessage(message, opts) && !generating) {
		const showEdit = !message.charId && !!channelMessageText(message.content)
		const inlineHtml = showEdit
			? actionButton({
				action: 'edit',
				attrs: `data-event-id="${escapedEventId}"`,
				icon: hubActionEditIcon,
				i18nKey: 'chat.hub.messageActionEdit',
			})
			: ''
		const shift = actionButton({
			action: 'delete',
			attrs: `data-event-id="${escapedEventId}"`,
			icon: hubActionDeleteIcon,
			i18nKey: 'chat.hub.messageActionDelete',
		})
		parts.push(await renderActionsBar(inlineHtml, '', shift, actionOpts))
	}
	else if (!generating && !ownChar) {
		const utilMenu = renderRemoteUtilMenu(escapedEventId)
		const shift = actionButton({
			action: 'download',
			attrs: `data-event-id="${escapedEventId}"`,
			icon: hubActionDownloadIcon,
		})
		parts.push(await renderActionsBar('', utilMenu, shift, message.charId ? actionOpts : {}))
	}

	return parts.join('')
}
