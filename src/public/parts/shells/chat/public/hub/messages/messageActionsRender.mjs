/**
 * 【文件】public/hub/messages/messageActionsRender.mjs
 * 【职责】根据权限与消息类型生成消息行内操作按钮 HTML（回复、编辑、删除、反馈、置顶等）。
 * 【原理】输出两个区域：
 *   - hoverHtml：悬停时显示的浮动操作栏（绝对定位）；
 *   - inlineHtml：常驻显示的紧凑反馈栏（重新生成 + 点赞/点踩，仅角色消息）。
 * 【数据结构】见函数入参与返回值 JSDoc。
 * 【关联】../../src/lib/channelContent、../../src/lib/emojiSvg、../core/domUtils、messageActionsUi、render/text
 */
import { channelMessageText } from '../../shared/channelContent.mjs'
import {
	hubActionBookmarkIcon,
	hubActionCopyHtmlIcon,
	hubActionCopyIcon,
	hubActionCopyLinkIcon,
	hubActionCopyTextIcon,
	hubActionDeleteIcon,
	hubActionDownloadIcon,
	hubActionEditIcon,
	hubActionForwardIcon,
	hubActionPinIcon,
	hubActionRegenIcon,
	hubActionReplyIcon,
	hubActionShareIcon,
	hubActionThreadIcon,
	hubActionThumbDownIcon,
	hubActionThumbUpIcon,
	hubActionTranslateIcon,
	hubActionUnpinIcon,
} from '../../src/lib/emojiSvg.mjs'
import { isDagEventId } from '../../src/lib/eventId.mjs'
import { escapeHtml } from '/scripts/lib/escapeHtml.mjs'
import { resolveEntityHashForAuthorKey } from '../core/domUtils.mjs'

import { actionButton, menuActionItem, menuSubmenu, renderActionsBar } from './messageActionsUi.mjs'
import { isChannelMessageGenerating } from './render/text.mjs'

/**
 * 解析消息作者成员行声明的 ownerEntityHash。
 * @param {object} message 消息行
 * @param {object} options 查看者上下文（含 groupMembers / viewerEntityHash）
 * @returns {string | null} owner entityHash
 */
function authorOwnerEntityHash(message, options) {
	const authorEntity = resolveEntityHashForAuthorKey(message.charId || message.authorPubKeyHash)
		|| resolveEntityHashForAuthorKey(message.authorPubKeyHash)
	const sender = String(message.authorPubKeyHash || '').trim().toLowerCase()
	for (const member of options.groupMembers || []) {
		const memberEntity = String(member?.entityHash || '').trim().toLowerCase()
		const memberKey = String(member?.memberKey || member?.pubKeyHash || '').trim().toLowerCase()
		if ((authorEntity && memberEntity === authorEntity) || (sender && memberKey === sender)) {
			const owner = String(member?.ownerEntityHash || '').trim().toLowerCase()
			return owner || null
		}
	}
	return null
}

/**
 * 当前观看者是否为消息作者所属主人（人类与 agent 同构）。
 * @param {object} message 消息行
 * @param {object} options 查看者上下文
 * @returns {boolean} 是否可管理
 */
function isManagedByViewer(message, options) {
	const owner = authorOwnerEntityHash(message, options)
	const viewerEntity = String(options.viewerEntityHash || '').trim().toLowerCase()
	return !!(owner && viewerEntity && owner === viewerEntity)
}

/**
 * 是否为本节点发出的角色消息（含所属 agent，哪怕 isRemote）。
 * @param {object} message 消息行
 * @param {object} options 查看者上下文
 * @returns {boolean} 是否己方角色
 */
function isOwnCharMessage(message, options) {
	if (!message?.charId) return false
	if (isManagedByViewer(message, options)) return true
	if (message.isRemote) return false
	const localCharIds = options.localCharIds?.length
		? options.localCharIds
		: options.localCharId
			? [options.localCharId]
			: []
	if (localCharIds.includes(message.charId)) return true
	const viewer = String(options.viewerPubKeyHash || '').trim().toLowerCase()
	const sender = String(message.authorPubKeyHash || '').trim().toLowerCase()
	return !!(viewer && sender && viewer === sender)
}

/**
 * 是否允许删除该消息。
 * @param {object} message 消息行
 * @param {object} options 权限上下文
 * @returns {boolean} 可删除
 */
function canDeleteMessage(message, options) {
	if (!message?.eventId) return false
	if (isOwnCharMessage(message, options)) return true
	if (isManagedByViewer(message, options)) return true
	if (message.charId && options.canManageMessages) return true
	if (!message.charId) {
		const viewer = String(options.viewerPubKeyHash || '').toLowerCase()
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
 * 复制二级菜单（Markdown / 纯文本 / HTML）。
 * @param {string} eventId 已转义事件 id
 * @returns {string} 子菜单 HTML
 */
function copySubmenu(eventId) {
	const items = [
		menuActionItem('copy-md', `data-event-id="${eventId}"`, hubActionCopyIcon, 'chat.hub.menuMD'),
		menuActionItem('copy-text', `data-event-id="${eventId}"`, hubActionCopyTextIcon, 'chat.hub.menuTXT'),
		menuActionItem('copy-html', `data-event-id="${eventId}"`, hubActionCopyHtmlIcon, 'chat.hub.menuHTML'),
	].join('')
	return menuSubmenu('chat.hub.menuCopy', hubActionCopyIcon, items)
}

/**
 * 分享链接二级菜单（按有效期）。
 * @param {string} eventId 已转义事件 id
 * @returns {string} 子菜单 HTML
 */
function shareSubmenu(eventId) {
	const items = ['1h', '12h', '24h', '72h'].map(time =>
		menuActionItem('share', `data-event-id="${eventId}" data-time="${time}"`, hubActionShareIcon, `chat.hub.menuShare.${time}`),
	).join('')
	return menuSubmenu('chat.hub.menuShareGroup', hubActionShareIcon, items)
}

/**
 * 构建消息下拉菜单项：复制/分享/转发/下载（可选删除）。
 * @param {string} eventId 已转义事件 id
 * @param {{ canDelete?: boolean }} options 选项
 * @returns {string} 菜单 `<li>` HTML
 */
function buildMenuItems(eventId, { canDelete = false } = {}) {
	const parts = [
		copySubmenu(eventId),
		shareSubmenu(eventId),
		menuActionItem('copy-share-link', `data-event-id="${eventId}"`, hubActionCopyLinkIcon, 'chat.hub.copyShareLink'),
		menuActionItem('forward', `data-event-id="${eventId}"`, hubActionForwardIcon, 'chat.hub.forward'),
		menuActionItem('download', `data-event-id="${eventId}"`, hubActionDownloadIcon, 'chat.hub.menuDownload'),
	]
	if (canDelete)
		parts.push(menuActionItem('delete', `data-event-id="${eventId}"`, hubActionDeleteIcon, 'chat.hub.menuDelete', 'text-error'))
	return parts.join('')
}

/**
 * Shift 快捷层：下载 HTML +（可删时）删除，便于按住 Shift 连删。
 * @param {string} eventId 已转义事件 id
 * @param {boolean} canDelete 是否可删
 * @returns {string} 按钮 HTML
 */
function buildShiftActions(eventId, canDelete) {
	const parts = [
		actionButton({
			action: 'download',
			attrs: `data-event-id="${eventId}"`,
			icon: hubActionDownloadIcon,
			i18nKey: 'chat.hub.menuDownload',
			classes: 'text-success',
		}),
	]
	if (canDelete)
		parts.push(actionButton({
			action: 'delete',
			attrs: `data-event-id="${eventId}"`,
			icon: hubActionDeleteIcon,
			i18nKey: 'chat.hub.menuDelete',
			classes: 'text-error',
		}))
	return parts.join('')
}

/**
 * 渲染消息操作 HTML，返回悬停浮动栏与常驻内联反馈栏两个区域。
 * @param {object} message 消息行
 * @param {object} options 权限上下文
 * @returns {Promise<{ hoverHtml: string, inlineHtml: string }>} 两个区域 HTML
 */
export async function renderMessageActionsHtml(message, options) {
	const eventId = String(message.eventId)
	if (!eventId || message.type !== 'message') return { hoverHtml: '', inlineHtml: '' }

	const ownChar = isOwnCharMessage(message, options)
	const generating = isChannelMessageGenerating(message)
	if (generating) return { hoverHtml: '', inlineHtml: '' }

	const feedbackType = message.extension?.feedback?.type
	const pinnedIds = Array.isArray(options.pinnedEventIds) ? options.pinnedEventIds : []
	const isPinned = pinnedIds.includes(eventId)
	const alwaysVisible = !!options.alwaysVisibleActions && !!(message.charId || ownChar)
	const escapedEventId = escapeHtml(eventId)
	// 乐观 pending:* 尚无 DAG id，不渲染会写链的操作（避免 targetId 校验失败）
	const dagReady = isDagEventId(eventId)

	// ===== 常驻内联反馈栏（仅本机角色消息在双人对话中显示） =====
	let inlineHtml = ''
	if (dagReady && alwaysVisible && ownChar) {
		const feedbackHtml = renderOwnCharFeedbackInline(
			escapedEventId,
			escapeHtml(String(message.charId || '')),
			feedbackType === 'up' ? 'text-success' : '',
			feedbackType === 'down' ? 'text-error' : '',
			!!options.isLastMessage,
		)
		inlineHtml = `<div class="message-inline-feedback flex items-center gap-0.5">${feedbackHtml}</div>`
	}

	// ===== 悬停浮动栏 =====
	// 常驻图标：回复、子线程、书签、置顶、编辑、翻译；复制/分享/下载/删除收进二级菜单；Shift 层为下载/删除
	const hoverInlineParts = []
	const canDelete = dagReady && canDeleteMessage(message, options)

	if (dagReady)
		hoverInlineParts.push(actionButton({
			action: 'reply',
			attrs: `data-event-id="${escapedEventId}"`,
			icon: hubActionReplyIcon,
			i18nKey: 'chat.hub.replyInline',
		}))

	if (dagReady && options.canCreateThreads)
		hoverInlineParts.push(actionButton({
			action: 'thread',
			attrs: `data-event-id="${escapedEventId}"`,
			icon: hubActionThreadIcon,
			i18nKey: 'chat.hub.replyInThread',
		}))

	if (dagReady && !message.isRemote) {
		hoverInlineParts.push(actionButton({
			action: 'bookmark',
			attrs: `data-event-id="${escapedEventId}"`,
			icon: hubActionBookmarkIcon,
			i18nKey: 'chat.hub.messageActionBookmark',
		}))
		if (options.canPinMessages)
			hoverInlineParts.push(actionButton({
				action: 'pin',
				attrs: `data-event-id="${escapedEventId}" data-pinned="${isPinned ? '1' : '0'}"`,
				icon: isPinned ? hubActionUnpinIcon : hubActionPinIcon,
				i18nKey: isPinned ? 'chat.hub.messageActionUnpin' : 'chat.hub.messageActionPin',
			}))
	}

	const canEdit = dagReady && (ownChar || isManagedByViewer(message, options)
		|| (!message.isRemote && canDelete && !message.charId))
		&& !!channelMessageText(message.content)
	if (canEdit)
		hoverInlineParts.push(actionButton({
			action: 'edit',
			attrs: `data-event-id="${escapedEventId}"`,
			icon: hubActionEditIcon,
			i18nKey: 'chat.hub.messageActionEdit',
		}))

	// 翻译按钮（仅有文本内容时显示；不依赖 DAG id）
	if (channelMessageText(message.content))
		hoverInlineParts.push(actionButton({
			action: 'translate',
			attrs: `data-event-id="${escapedEventId}"`,
			icon: hubActionTranslateIcon,
			i18nKey: 'chat.hub.translate',
		}))

	const menuItems = dagReady ? buildMenuItems(escapedEventId, { canDelete }) : ''
	const shiftHtml = dagReady ? buildShiftActions(escapedEventId, canDelete) : ''

	const hoverHtml = await renderActionsBar(
		hoverInlineParts.join(''),
		menuItems,
		shiftHtml,
		{ alwaysVisible: false },
	)

	return { hoverHtml, inlineHtml }
}
