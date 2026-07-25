/**
 * 【文件】public/hub/messages/render/index.mjs
 * 【职责】单条频道消息块协调：聚合正文类型渲染、外壳、反应条与列表插入后绑定。
 */
import { renderTemplateAsHtmlString } from '../../../../../../scripts/features/template.mjs'
import { bindContentReveal, wrapContentWarningHtml, wrapSensitiveMediaHtml } from '/scripts/features/contentReveal/index.mjs'
import { geti18n } from '../../../../../../scripts/i18n/index.mjs'
import { firstCustomEmojiRef } from '../../../src/customEmojis.mjs'
import { escapeHtml } from '/scripts/lib/escapeHtml.mjs'
import { isFirstMessageInAuthorGroup } from '/parts/shells:chat/shared/hashAvatar.mjs'
import {
	attributionFromHubMessage,
} from '/parts/shells:chat/shared/attribution.mjs'
import { renderAttributionWarningIconHtml } from '/parts/shells:chat/shared/entityProfileCard.mjs'
import { hubDeliveryReadIcon, hubDeliverySentIcon } from '../../../src/lib/emojiSvg.mjs'
import { buildMessagesByEventId } from '../../../src/ui/channelDisplay.mjs'
import { authorPresentationKeys, avatarColor, avatarInitial, avatarTextColor, formatTimeAttrs, timeI18nAttrFragment } from '../../core/domUtils.mjs'
import { store } from '../../core/state.mjs'
import { renderMessageActionsHtml } from '../messageActionsRender.mjs'


import {
	renderDecryptBodyHtml,
	renderGroupInviteBlock,
	renderMessageRefBlockHtml,
	renderStickerBlock,
	wireMessageRefBlocks,
} from './blocks.mjs'
import { renderCallBlock } from './call.mjs'
import { wireMessageEmbedGuards } from './embed.mjs'
import { renderMessageFileIdsHtml, wireMessageMediaPlaceholders } from './file.mjs'
import { hydrateMessageMarkdown, renderMessageMarkdownForPaint } from './markdown.mjs'
import { renderMessageReactionsHtml } from './reactions.mjs'
import {
	getMessageText,
	isChannelMessageGenerating,
	isOwnViewerMessage,
	renderMessageContent,
} from './text.mjs'
import { autoTranslateMessages } from './translation.mjs'
import { renderVoteBlock } from './vote.mjs'

/**
 * 统一渲染 Hub 消息行外壳结构。
 * @param {object} options 渲染参数
 * @param {string} options.rowClass 行 class
 * @param {string} options.rowAttrs 行属性字符串
 * @param {string} options.avatarFor 头像哈希/键
 * @param {string} options.avatarBg 头像背景色
 * @param {string} options.avatarTextColor 头像文字色
 * @param {string} options.avatarHtml 头像 HTML
 * @param {string} options.headerHtml 头部 HTML
 * @param {string} options.contentHtml 正文 HTML
 * @param {string} [options.footerHtml] 页脚 HTML
 * @param {string} [options.hoverBarHtml] 悬浮栏 HTML
 * @param {string} [options.align] chat-start|chat-end
 * @param {string} [options.bubbleClass] 气泡 class
 * @param {string} [options.bubbleAttrs] 气泡属性
 * @returns {Promise<string>} 单条消息外壳 HTML
 */
async function renderMessageRowShell({
	rowClass,
	rowAttrs,
	avatarFor,
	avatarBg,
	avatarTextColor: avatarFg,
	avatarHtml,
	headerHtml,
	contentHtml,
	footerHtml = '',
	hoverBarHtml = '',
	align = 'chat-start',
	bubbleClass = 'chat-bubble-neutral',
	bubbleAttrs = '',
}) {
	const avatarBlock = await renderTemplateAsHtmlString('hub/messages/avatar_block', {
		avatarFor,
		avatarBg: avatarBg ?? avatarColor(avatarFor),
		avatarTextColor: avatarFg ?? avatarTextColor(avatarFor),
		avatarHtml,
	})
	return renderTemplateAsHtmlString('hub/messages/message_row', {
		align,
		rowClass,
		rowAttrs,
		avatarBlock,
		headerHtml,
		bubbleClass,
		bubbleAttrs,
		contentHtml,
		footerHtml,
		hoverBarHtml,
	})
}

/**
 * 渲染投递状态小标记：发送中转圈 / 已发送单勾 / 别人已读双勾。
 * @param {'pending'|'sent'} status 投递态
 * @param {boolean} [peerRead=false] 是否有任一其他成员已读
 * @returns {string} HTML
 */
export function renderDeliveryStatusHtml(status, peerRead = false) {
	if (status === 'pending') {
		const title = escapeHtml(geti18n('chat.hub.deliverySending') || '')
		return `<span class="delivery-status delivery-status--pending inline-flex items-center ms-1 leading-none align-middle text-xs opacity-40" title="${title}" aria-hidden="true"><span class="loading loading-spinner loading-xs"></span></span>`
	}
	if (peerRead) {
		const title = escapeHtml(geti18n('chat.hub.deliveryRead') || '')
		return `<span class="delivery-status delivery-status--read inline-flex items-center ms-1 leading-none align-middle text-xs opacity-70" title="${title}" aria-hidden="true">${hubDeliveryReadIcon}</span>`
	}
	if (status === 'sent') {
		const title = escapeHtml(geti18n('chat.hub.deliverySent') || '')
		return `<span class="delivery-status delivery-status--sent inline-flex items-center ms-1 leading-none align-middle text-xs opacity-40" title="${title}" aria-hidden="true">${hubDeliverySentIcon}</span>`
	}
	return ''
}

/**
 * 渲染转发消息头 HTML（「转发自 {name}」）。
 * @param {{ senderName?: string, shareUrl?: string, groupId?: string, channelId?: string, eventId?: string }} forwardedFrom 转发来源
 * @returns {string} HTML 片段
 */
function renderForwardedFromHtml(forwardedFrom) {
	const name = escapeHtml(String(forwardedFrom.senderName || ''))
	const label = geti18n('chat.hub.forwardedFrom') || 'Forwarded from'
	let href = ''
	if (forwardedFrom.shareUrl)
		href = escapeHtml(String(forwardedFrom.shareUrl))
	else if (forwardedFrom.groupId && forwardedFrom.channelId && forwardedFrom.eventId)
		href = `#group:${encodeURIComponent(forwardedFrom.groupId)}:${encodeURIComponent(forwardedFrom.channelId)};${encodeURIComponent(forwardedFrom.eventId)}`
	const nameHtml = href
		? `<a class="forwarded-from-link" href="${href}">${name}</a>`
		: `<span>${name}</span>`
	return `<div class="forwarded-from text-xs opacity-60 mb-1">${escapeHtml(label)} ${nameHtml}</div>`
}

/**
 * 渲染单条频道消息块。
 * @param {object} message 消息
 * @param {string|null} prevAuthorKey 上一条作者键（charId ?? sender）
 * @param {number} prevTime 上一条时间戳
 * @param {object[]} [allMessages] 频道全部行
 * @param {object} [renderOpts] 反应渲染选项
 * @returns {Promise<{ html: string, sender: string|null, time: number }>} 单条 HTML 与分组游标
 */
export async function renderChannelMessageBlock(message, prevAuthorKey, prevTime, allMessages = [], renderOpts = {}) {
	const generating = isChannelMessageGenerating(message)
	const sender = message.sender ?? '?'
	const time = message.hlc?.wall ?? 0
	const authorKey = message.charId ?? sender
	const isFirst = isFirstMessageInAuthorGroup(authorKey, prevAuthorKey, time, prevTime)
	const isOwn = isOwnViewerMessage(message, renderOpts)
	const align = isOwn ? 'chat-end' : 'chat-start'
	const bubbleClass = isOwn ? 'chat-bubble-primary' : 'chat-bubble-neutral'

	const authorAttr = message.authorPubKeyHash
		? ` data-author-pubkey-hash="${escapeHtml(message.authorPubKeyHash)}"`
		: ''
	const charAttr = message.charId ? ` data-char-id="${escapeHtml(String(message.charId))}"` : ''
	const snapDisplay = message.content?.displayName || message.extension?.display?.name
	const snapAvatar = message.content?.displayAvatar || message.extension?.display?.avatar
	const presentation = authorPresentationKeys(authorKey)
	const displayAuthor = snapDisplay || presentation.displayName
	const avatarKey = presentation.profileKey
	const attribution = attributionFromHubMessage(message)
	const attributionWarningHtml = renderAttributionWarningIconHtml(attribution)
	const attributionAttr = attribution.mismatch ? ' data-attribution-mismatch="1"' : ''
	const streamingAttr = generating ? ' data-streaming="1"' : ''
	const pendingAttr = message.pending ? ' data-pending="1"' : ''
	const failedAttr = message.sendFailed ? ' data-send-failed="1"' : ''
	const deliveryAttr = message.deliveryStatus ? ` data-delivery-status="${escapeHtml(message.deliveryStatus)}"` : ''
	const msgLocale = message.content?.locale ? ` data-message-locale="${escapeHtml(message.content.locale)}"` : ''
	const rowAttrs = `data-message-id="${escapeHtml(String(message.eventId))}" data-author-key="${escapeHtml(authorKey)}" data-message-type="${escapeHtml(message.type || 'message')}"${message.isRemote ? ' data-is-remote="1"' : ''}${authorAttr}${charAttr}${streamingAttr}${pendingAttr}${failedAttr}${deliveryAttr}${msgLocale}${attributionAttr}`

	const timeAttrs = formatTimeAttrs(time)
	const typingLabelHtml = generating
		? '<span class="streaming-typing inline-flex items-center gap-1 text-base-content/60 text-xs"><span class="loading loading-dots loading-xs"></span><span data-i18n="chat.hub.charTyping"></span></span>'
		: ''

	const emojiRef = firstCustomEmojiRef(getMessageText(message))
	const remoteBadge = message.isRemote
		? await renderTemplateAsHtmlString('hub/messages/remote_badge', {})
		: ''
	const trustButton = message.isRemote && message.authorPubKeyHash
		? await renderTemplateAsHtmlString('hub/messages/trust_author_button', { pubKeyHash: escapeHtml(message.authorPubKeyHash) })
		: ''
	const blockButton = message.isRemote && message.authorPubKeyHash
		? await renderTemplateAsHtmlString('hub/messages/block_author_button', { pubKeyHash: escapeHtml(message.authorPubKeyHash) })
		: ''
	const saveEmojiButton = emojiRef
		? await renderTemplateAsHtmlString('hub/messages/save_emoji_button', {
			groupId: escapeHtml(emojiRef.groupId),
			emojiId: escapeHtml(emojiRef.emojiId),
		})
		: ''

	const editedLabelHtml = message.wasEdited
		? '<span class="text-xs opacity-50 ml-1" data-i18n="chat.hub.editedLabel"></span>'
		: ''
	const headerHtml = await renderTemplateAsHtmlString('hub/messages/channel_header', {
		authorKey: escapeHtml(authorKey),
		author: escapeHtml(displayAuthor),
		attributionWarningHtml,
		editedLabelHtml,
		timeI18nAttr: timeI18nAttrFragment(timeAttrs),
		timeText: escapeHtml(timeAttrs.timeText),
		remoteBadge,
		trustButton,
		blockButton,
		saveEmojiButton,
		typingLabelHtml,
	})
	const messagesByEventId = buildMessagesByEventId(allMessages)
	const refHtml = generating ? '' : await renderMessageRefBlockHtml(message, messagesByEventId)

	let bodyHtml
	let bubbleAttrs = ''
	if (generating)
		bodyHtml = await renderTemplateAsHtmlString('hub/messages/streaming_body', {})
	else {
		const plainText = getMessageText(message)
		const decryptHtml = await renderDecryptBodyHtml(message)
		const truncBanner = message.content?.streamGenerationFailed
			? await renderTemplateAsHtmlString('hub/messages/stream_truncated', {})
			: ''
		const stickerHtml = !decryptHtml ? await renderStickerBlock(message) : null
		const groupInviteHtml = !decryptHtml && !stickerHtml ? await renderGroupInviteBlock(message) : null
		const useCall = !decryptHtml && !stickerHtml && !groupInviteHtml
			&& message.content?.type === 'call'
		const useVote = !decryptHtml && !stickerHtml && !groupInviteHtml && !useCall
			&& message.content?.type === 'vote' && allMessages.length
		const usePlainMd = !decryptHtml && !stickerHtml && !groupInviteHtml && !useVote && !useCall
			&& plainText.length > 0 && message.eventId

		const filesHtml = !decryptHtml && !stickerHtml && !groupInviteHtml && !useVote && !useCall
			? await renderMessageFileIdsHtml(message)
			: ''

		/** @type {string} */
		let bodyCore
		if (decryptHtml) bodyCore = decryptHtml
		else if (stickerHtml) bodyCore = stickerHtml
		else if (groupInviteHtml) bodyCore = groupInviteHtml
		else if (useCall) bodyCore = await renderCallBlock(message)
		else if (useVote) bodyCore = await renderVoteBlock(message, allMessages)
		else if (usePlainMd) {
			const rendered = await renderMessageMarkdownForPaint(String(message.eventId), plainText, {
				isRemote: !!message.isRemote,
				authorPubKeyHash: String(message.authorPubKeyHash || ''),
			})
			bodyCore = rendered.html
			bubbleAttrs = rendered.bubbleAttrs
		}
		else bodyCore = await renderMessageContent(plainText)

		const forwardedFrom = message.content?.forwardedFrom
		const forwardedFromHtml = forwardedFrom
			? renderForwardedFromHtml(forwardedFrom)
			: ''

		const failedBanner = message.sendFailed
			? await renderTemplateAsHtmlString('hub/messages/send_failed_banner', { eventId: escapeHtml(String(message.eventId)) })
			: ''

		let mainBody = `${forwardedFromHtml}${refHtml}${truncBanner}${bodyCore}${filesHtml}${failedBanner}`

		if (message.content?.content_warning) {
			const cwLabel = String(message.content.content_warning)
			const revealLabel = geti18n('chat.hub.revealContent') || 'Reveal'
			mainBody = wrapContentWarningHtml(mainBody, { warningLabel: cwLabel, revealLabel })
		}
		else if (message.content?.sensitive_media && (filesHtml || message.content?.fileIds?.length)) {
			const warnLabel = geti18n('chat.hub.sensitiveMedia') || ''
			const revealLabel = geti18n('chat.hub.revealMedia') || 'Reveal'
			mainBody = wrapSensitiveMediaHtml(mainBody, { warningLabel: warnLabel, revealLabel })
		}

		bodyHtml = mainBody
	}

	const reactionsHtml = generating ? '' : await renderMessageReactionsHtml(
		message,
		renderOpts.reactions || {},
		renderOpts.viewerMemberId || 'local',
		{ canAddReactions: !!renderOpts.canAddReactions && message.type === 'message' },
	)
	const actionsResult = generating ? null : await renderMessageActionsHtml(message, {
		viewerPubKeyHash: renderOpts.viewerPubKeyHash,
		localCharIds: renderOpts.localCharIds,
		localCharId: renderOpts.localCharIds?.[0] ?? renderOpts.localCharId,
		canManageMessages: renderOpts.canManageMessages,
		canPinMessages: renderOpts.canPinMessages,
		canCreateThreads: renderOpts.canCreateThreads,
		pinnedEventIds: renderOpts.pinnedEventIds,
		alwaysVisibleActions: renderOpts.alwaysVisibleActions,
		isLastMessage: renderOpts.lastMessageEventId === message.eventId,
	})
	const hoverBarHtml = actionsResult?.hoverHtml || ''
	const inlineFeedbackHtml = actionsResult?.inlineHtml || ''

	let deliveryStatusHtml = ''
	if (!generating && isOwn && !message.sendFailed) {
		const groupId = store.context.currentGroupId
		const channelId = store.context.currentChannelId
		const msgSeq = Number(message.seq)
		let peerRead = false
		if (groupId && channelId && Number.isFinite(msgSeq) && msgSeq > 0) {
			const { isMessageReadByPeer } = await import('../../memberReadMarkers.mjs')
			peerRead = isMessageReadByPeer(groupId, channelId, msgSeq)
		}
		const status = message.deliveryStatus === 'pending' || message.pending ? 'pending' : 'sent'
		deliveryStatusHtml = renderDeliveryStatusHtml(status, peerRead)
	}

	return {
		html: await renderMessageRowShell({
			rowClass: `message ${isFirst ? 'first-in-group' : ''}${message.pending ? ' message-pending' : ''}${message.sendFailed ? ' message-send-failed' : ''}`.trim(),
			align,
			bubbleClass,
			rowAttrs,
			avatarFor: avatarKey,
			avatarBg: avatarColor(avatarKey),
			avatarTextColor: avatarTextColor(avatarKey),
			avatarHtml: snapAvatar
				? `<img src="${escapeHtml(String(snapAvatar))}" class="w-full h-full object-cover rounded-full" alt="" role="presentation" />`
				: escapeHtml(avatarInitial(displayAuthor)),
			headerHtml,
			contentHtml: bodyHtml,
			bubbleAttrs,
			footerHtml: `${inlineFeedbackHtml}${reactionsHtml}${deliveryStatusHtml}`,
			hoverBarHtml,
		}),
		sender: authorKey,
		time,
	}
}

/**
 * 消息列表插入 DOM 后翻译动态 `data-i18n` 节点、绑定交互层。
 * @param {HTMLElement} container 消息列表根
 * @returns {void}
 */
export function localizeRenderedMessages(container) {
	wireMessageEmbedGuards(container)
	wireMessageRefBlocks(container)
	wireMessageMediaPlaceholders(container)
	bindContentReveal(container)
	void hydrateMessageMarkdown(container)
	void autoTranslateMessages(container)
}
