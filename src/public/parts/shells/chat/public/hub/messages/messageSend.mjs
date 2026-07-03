import { sendGroupMessage } from '../../src/api/groupApi.mjs'
import { clearSelectedFiles, selectedFiles } from '../composerFiles.mjs'
import { hubStore } from '../core/state.mjs'
import { waitForGroupWebSocketOpen } from '../groupStream.mjs'

import { syncChannelActionsContext } from './messageContext.mjs'
import { getMessagesContainer } from './messageScroll.mjs'
import { mergeIncrementalChannelBatch, refreshChannelView, updateLastMessageId } from './messageShared.mjs'
import {
	decorateRenderedMessages,
	initChannelVirtualList,
} from './messageVirtualList.mjs'

/** @returns {Promise<void>} 重载频道消息 */
function reloadMessages() {
	return import('./messages.mjs').then(m => m.loadMessages())
}

/** @returns {void} */
function syncCtx() {
	syncChannelActionsContext(reloadMessages)
}

/**
 * @param {object} event 已发送事件
 * @returns {object} 频道消息行
 */
function channelRowFromPostedEvent(event) {
	const eventId = event?.id
	const viewerPubKeyHash = String(hubStore.context.currentState?.viewerMemberPubKeyHash || '').trim().toLowerCase()
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
 * @param {string} content 文本内容
 * @param {string} tempId 临时 pending eventId
 * @returns {object} 乐观 pending 行
 */
function pendingRowFromComposer(content, tempId) {
	const viewerPubKeyHash = hubStore.context.currentState?.viewerMemberPubKeyHash || null
	return {
		eventId: tempId,
		pending: true,
		type: 'message',
		content: { type: 'text', content },
		sender: viewerPubKeyHash,
		authorPubKeyHash: viewerPubKeyHash,
		timestamp: Date.now(),
		isRemote: false,
	}
}

/**
 * @param {string} content 文本内容
 * @param {string} tempId 临时 pending eventId
 * @returns {Promise<void>}
 */
async function insertPendingRow(content, tempId) {
	hubStore.messages.composerPendingId = tempId
	const row = pendingRowFromComposer(content, tempId)
	const container = getMessagesContainer()
	if (!container) return
	hubStore.messages.channelMessagesSource = mergeIncrementalChannelBatch(hubStore.messages.channelMessagesSource, [row])
	refreshChannelView()
	syncCtx()
	if (container.querySelector('.hub-empty')) container.innerHTML = ''
	if (!hubStore.messages.channelMessagePipeline) initChannelVirtualList(container, reloadMessages)
	const visible = hubStore.messages.channelMessages.find(m => String(m.eventId) === tempId)
	if (visible) await hubStore.messages.channelMessagePipeline.appendItem(visible, true)
	decorateRenderedMessages(container, true, reloadMessages)
}

/**
 * @param {string} tempId 临时 pending eventId
 * @param {object} event 服务端确认事件
 * @returns {Promise<void>}
 */
async function confirmPendingRow(tempId, event) {
	hubStore.messages.composerPendingId = null
	const realRow = channelRowFromPostedEvent(event)
	const container = getMessagesContainer()
	hubStore.messages.channelMessagesSource = mergeIncrementalChannelBatch(
		hubStore.messages.channelMessagesSource.filter(m => String(m.eventId) !== tempId),
		[realRow],
	)
	refreshChannelView()
	if (hubStore.messages.channelMessagePipeline)
		await hubStore.messages.channelMessagePipeline.refresh()
	syncCtx()
	updateLastMessageId()
	if (container) decorateRenderedMessages(container, false, reloadMessages)
}

/**
 * @param {string} tempId 临时 pending eventId
 * @param {string} content 文本内容
 * @param {File[]} [files] 附件列表
 * @returns {Promise<void>}
 */
async function failPendingRow(tempId, content, files = []) {
	const idx = hubStore.messages.channelMessagesSource.findIndex(m => String(m.eventId) === tempId)
	if (idx >= 0)
		hubStore.messages.channelMessagesSource[idx] = {
			...hubStore.messages.channelMessagesSource[idx],
			sendFailed: true,
			pending: true,
		}

	hubStore.messages.failedPendingPayloads.set(tempId, { content, files: [...files] })
	refreshChannelView()
	const container = getMessagesContainer()
	if (hubStore.messages.channelMessagePipeline)
		await hubStore.messages.channelMessagePipeline.refresh()
	syncCtx()
	if (container) decorateRenderedMessages(container, false, reloadMessages)
}

/** @param {string} tempId @returns {Promise<void>} */
export async function retryFailedPendingMessage(tempId) {
	const payload = hubStore.messages.failedPendingPayloads.get(tempId)
	if (!payload) return
	hubStore.messages.failedPendingPayloads.delete(tempId)
	const idx = hubStore.messages.channelMessagesSource.findIndex(m => String(m.eventId) === tempId)
	if (idx >= 0)
		hubStore.messages.channelMessagesSource[idx] = {
			...hubStore.messages.channelMessagesSource[idx],
			sendFailed: false,
			pending: true,
		}

	hubStore.messages.composerPendingId = tempId
	refreshChannelView()
	try {
		const event = await sendGroupMessage(
			hubStore.context.currentGroupId,
			hubStore.context.currentChannelId,
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

/** @param {string} content @returns {Promise<void>} */
export async function sendCurrentMessage(content) {
	const sendGroupId = hubStore.context.currentGroupId
	const sendChannelId = hubStore.context.currentChannelId
	if (!sendGroupId || !sendChannelId)
		throw new Error('no channel selected')
	await waitForGroupWebSocketOpen(sendGroupId, sendChannelId)
	const files = [...selectedFiles]
	const tempId = `pending:${crypto.randomUUID()}`
	await insertPendingRow(content, tempId)
	try {
		const event = await sendGroupMessage(sendGroupId, sendChannelId, content, files)
		if (hubStore.context.currentGroupId !== sendGroupId || hubStore.context.currentChannelId !== sendChannelId) {
			hubStore.messages.composerPendingId = null
			hubStore.messages.channelMessagesSource = hubStore.messages.channelMessagesSource.filter(m => String(m.eventId) !== tempId)
			clearSelectedFiles()
			hubStore.messages.failedPendingPayloads.delete(tempId)
			return
		}
		clearSelectedFiles()
		hubStore.messages.failedPendingPayloads.delete(tempId)
		await confirmPendingRow(tempId, event)
	}
	catch (error) {
		if (hubStore.context.currentGroupId === sendGroupId && hubStore.context.currentChannelId === sendChannelId)
			await failPendingRow(tempId, content, files)
		else {
			hubStore.messages.composerPendingId = null
			hubStore.messages.channelMessagesSource = hubStore.messages.channelMessagesSource.filter(m => String(m.eventId) !== tempId)
		}
		throw error
	}
}
