import { primaryLocale } from '../../../../../scripts/i18n/index.mjs'
import { sendGroupMessage } from '../../src/api/groupChannel.mjs'
import { clearComposerExtras, getContentWarning, getSensitiveMedia } from '../composerExtras.mjs'
import { clearSelectedFiles, selectedFiles } from '../composerFiles.mjs'
import { clearReplyTarget, getReplyTarget } from '../composerReply.mjs'
import { store } from '../core/state.mjs'
import { waitForGroupWebSocketOpen } from '../stream/index.mjs'

import { syncChannelActionsContext } from './messageContext.mjs'
import { getMessagesContainer } from './messageScroll.mjs'
import { clearHubEmptyPlaceholder, mergeIncrementalChannelBatch, refreshChannelView, updateLastMessageId } from './messageShared.mjs'
import {
	decorateRenderedMessages,
	initChannelVirtualList,
} from './messageVirtualList.mjs'

/**
 * @param {object} event 已发送事件
 * @returns {object} 频道消息行
 */
function channelRowFromPostedEvent(event) {
	const eventId = event?.id
	const viewerPubKeyHash = String(store.context.currentState?.viewerMemberPubKeyHash || '').trim().toLowerCase()
	const authorPubKeyHash = String(event.sender || '').trim().toLowerCase()
	return {
		eventId,
		type: 'message',
		content: event.content,
		sender: event.sender,
		charId: event.charId || null,
		timestamp: event.hlc?.wall ?? Date.now(),
		authorPubKeyHash,
		isRemote: !!(authorPubKeyHash && viewerPubKeyHash && authorPubKeyHash !== viewerPubKeyHash),
	}
}

/**
 * @param {object} contentObj 富内容对象
 * @param {string} tempId 临时 pending eventId
 * @returns {object} 乐观 pending 行
 */
function pendingRowFromComposer(contentObj, tempId) {
	const viewerPubKeyHash = store.context.currentState?.viewerMemberPubKeyHash || null
	return {
		eventId: tempId,
		pending: true,
		deliveryStatus: 'pending',
		type: 'message',
		content: contentObj,
		sender: viewerPubKeyHash,
		authorPubKeyHash: viewerPubKeyHash,
		timestamp: Date.now(),
		isRemote: false,
	}
}

/**
 * @param {object} contentObj 富内容对象
 * @param {string} tempId 临时 pending eventId
 * @returns {Promise<void>}
 */
async function insertPendingRow(contentObj, tempId) {
	store.messages.composerPendingId = tempId
	const row = pendingRowFromComposer(contentObj, tempId)
	const container = getMessagesContainer()
	if (!container) return
	store.messages.channelMessagesSource = mergeIncrementalChannelBatch(store.messages.channelMessagesSource, [row])
	refreshChannelView()
	syncChannelActionsContext()
	clearHubEmptyPlaceholder(container)
	if (!store.messages.channelMessagePipeline) initChannelVirtualList(container)
	const visible = store.messages.channelMessages.find(m => String(m.eventId) === tempId)
	if (visible) await store.messages.channelMessagePipeline.appendItem(visible, true)
	decorateRenderedMessages(container, true)
}

/**
 * @param {string} tempId 临时 pending eventId
 * @param {object} event 服务端确认事件
 * @returns {Promise<void>}
 */
async function confirmPendingRow(tempId, event) {
	store.messages.composerPendingId = null
	const realRow = { ...channelRowFromPostedEvent(event), deliveryStatus: 'sent' }
	const container = getMessagesContainer()
	store.messages.channelMessagesSource = mergeIncrementalChannelBatch(
		store.messages.channelMessagesSource.filter(m => String(m.eventId) !== tempId),
		[realRow],
	)
	refreshChannelView()
	if (store.messages.channelMessagePipeline)
		await store.messages.channelMessagePipeline.refresh()
	syncChannelActionsContext()
	updateLastMessageId()
	if (container) decorateRenderedMessages(container, false)
}

/**
 * @param {string} tempId 临时 pending eventId
 * @param {string} content 文本内容
 * @param {File[]} [files] 附件列表
 * @returns {Promise<void>}
 */
async function failPendingRow(tempId, content, files = []) {
	const idx = store.messages.channelMessagesSource.findIndex(m => String(m.eventId) === tempId)
	if (idx >= 0)
		store.messages.channelMessagesSource[idx] = {
			...store.messages.channelMessagesSource[idx],
			sendFailed: true,
			pending: true,
		}

	store.messages.failedPendingPayloads.set(tempId, { content, files: [...files] })
	refreshChannelView()
	const container = getMessagesContainer()
	if (store.messages.channelMessagePipeline)
		await store.messages.channelMessagePipeline.refresh()
	syncChannelActionsContext()
	if (container) decorateRenderedMessages(container, false)
}

/** @param {string} tempId @returns {Promise<void>} */
export async function retryFailedPendingMessage(tempId) {
	const payload = store.messages.failedPendingPayloads.get(tempId)
	if (!payload) return
	store.messages.failedPendingPayloads.delete(tempId)
	const idx = store.messages.channelMessagesSource.findIndex(m => String(m.eventId) === tempId)
	if (idx >= 0)
		store.messages.channelMessagesSource[idx] = {
			...store.messages.channelMessagesSource[idx],
			sendFailed: false,
			pending: true,
		}

	store.messages.composerPendingId = tempId
	refreshChannelView()
	try {
		const event = await sendGroupMessage(
			store.context.currentGroupId,
			store.context.currentChannelId,
			payload.content,
			payload.files?.length ? payload.files : undefined,
		)
		await confirmPendingRow(tempId, event)
	}
	catch (error) {
		await failPendingRow(tempId, payload.content, payload.files)
		throw error
	}
}

/**
 * 构建发送用富内容对象（含 CW/sensitive/locale/replyTo）。
 * @param {string} text 文本内容
 * @returns {object} content object
 */
function buildComposerContent(text) {
	const contentObj = { type: 'text', content: text, locale: primaryLocale() }
	const cw = getContentWarning()
	if (cw) contentObj.content_warning = cw
	if (getSensitiveMedia()) contentObj.sensitive_media = true
	const reply = getReplyTarget()
	if (reply)
		contentObj.replyTo = {
			eventId: reply.eventId,
			senderName: reply.senderName,
			preview: reply.preview,
		}
	return contentObj
}

/**
 * 向当前频道发送已构建好的 content（乐观 pending → POST → confirm/fail）。
 * @param {object} contentObj 富内容对象
 * @param {object[]} [files] 附件（name、mime_type、buffer base64）
 * @param {{ clearComposer?: boolean }} [options] clearComposer 时成功后清空附件/CW/草稿
 * @returns {Promise<object>} 落盘后的 DAG `message` 事件
 */
export async function sendMessagePayload(contentObj, files = [], { clearComposer = false } = {}) {
	const sendGroupId = store.context.currentGroupId
	const sendChannelId = store.context.currentChannelId
	if (!sendGroupId || !sendChannelId)
		throw new Error('no channel selected')
	await waitForGroupWebSocketOpen(sendGroupId, sendChannelId)
	const tempId = `pending:${crypto.randomUUID()}`
	await insertPendingRow(contentObj, tempId)
	try {
		const event = await sendGroupMessage(sendGroupId, sendChannelId, contentObj, files)
		if (store.context.currentGroupId !== sendGroupId || store.context.currentChannelId !== sendChannelId) {
			store.messages.composerPendingId = null
			store.messages.channelMessagesSource = store.messages.channelMessagesSource.filter(m => String(m.eventId) !== tempId)
			store.messages.failedPendingPayloads.delete(tempId)
			if (clearComposer) {
				clearSelectedFiles()
				clearComposerExtras()
			}
			return event
		}
		if (clearComposer) {
			clearSelectedFiles()
			clearComposerExtras()
			void import('../composerDraft.mjs').then(({ clearDraft }) => {
				clearDraft(sendGroupId, sendChannelId)
			})
		}
		store.messages.failedPendingPayloads.delete(tempId)
		void import('../sendQueue.mjs').then(({ dequeueOfflineMessage }) => {
			dequeueOfflineMessage(tempId)
		})
		await confirmPendingRow(tempId, event)
		return event
	}
	catch (error) {
		if (store.context.currentGroupId === sendGroupId && store.context.currentChannelId === sendChannelId) {
			await failPendingRow(tempId, contentObj, files)
			void import('../sendQueue.mjs').then(({ enqueueOfflineMessage }) => {
				enqueueOfflineMessage(tempId, sendGroupId, sendChannelId, contentObj)
			})
		}
		else {
			store.messages.composerPendingId = null
			store.messages.channelMessagesSource = store.messages.channelMessagesSource.filter(m => String(m.eventId) !== tempId)
		}
		throw error
	}
}

/**
 * 从 composer 发当前输入文本（含 CW/引用/附件，成功后清空 composer）。
 * @param {string} text 文本内容
 * @returns {Promise<object>} 落盘后的 DAG `message` 事件
 */
export async function sendCurrentMessage(text) {
	const files = [...selectedFiles]
	const contentObj = buildComposerContent(text)
	clearReplyTarget()
	return sendMessagePayload(contentObj, files, { clearComposer: true })
}
