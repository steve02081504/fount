/**
 * 【文件】public/hub/stream/volatileSlots.mjs
 * 【职责】VOLATILE stream_chunk 预览槽：建槽、重排 flush、DOM 绑定、补拉缓冲；停止生成按钮可见性。
 */
import { streamDisplayText } from '../../src/streamDisplay.mjs'
import { applySlices } from '../../src/streamSlices.mjs'
import { StreamRenderer } from '../../src/ui/StreamRenderer.mjs'
import { store } from '../core/state.mjs'
import { scrollToBottom } from '../messages/messageScroll.mjs'
import { messageIdSelector } from '../messages/messageShared.mjs'

import { dispatchChannelIncrementalRefresh } from './channelRefresh.mjs'
import { activeChannelId } from './connectionState.mjs'
import { stopGeneration } from './outbound.mjs'

/**
 * @typedef {{
 *   tracked: { content: string, content_for_show: string, files: Array },
 *   streamRenderer: StreamRenderer | null,
 *   reorder: { expectedSeq: number, chunks: Map<number, object[]> },
 *   charname: string,
 * }} VolatileStreamSlot
 */

/** @type {Map<string, VolatileStreamSlot>} */
const volatileStreams = new Map()

/** @type {Set<string>} */
const streamIdsFetchingRow = new Set()

/** @returns {string[]} 活跃 pendingStreamId 列表 */
export function getActiveVolatileStreamIds() {
	return [...volatileStreams.keys()]
}

/**
 * 刷新停止生成按钮的可见状态。
 * @returns {void}
 */
export function refreshStopGenerationButton() {
	const stopButton = document.getElementById('stop-generation-button')
	const sendButton = document.getElementById('send-button')
	if (!(stopButton instanceof HTMLElement) || !(sendButton instanceof HTMLElement)) return
	const active = volatileStreams.size > 0
	stopButton.toggleAttribute('hidden', !active)
	sendButton.removeAttribute('hidden')
}

/**
 * @param {string} streamId pendingStreamId
 * @returns {boolean} 槽是否存在
 */
export function hasVolatileStream(streamId) {
	return volatileStreams.has(streamId)
}

/**
 * @param {string} messageId 消息 event id
 * @returns {string} 流式预览行 CSS 选择器
 */
function streamingMessageRowSelector(messageId) {
	const selector = messageIdSelector(messageId)
	return selector ? `${selector}[data-streaming]` : ''
}

/**
 * @param {string} streamId pendingStreamId
 * @param {string} [charname] 角色 id
 * @returns {VolatileStreamSlot} 流式槽
 */
function getOrCreateStreamSlot(streamId, charname = '') {
	const id = String(streamId || '').trim()
	let slot = volatileStreams.get(id)
	if (!slot) {
		slot = {
			tracked: { content: '', content_for_show: '', files: [] },
			streamRenderer: null,
			reorder: { expectedSeq: 1, chunks: new Map() },
			charname,
		}
		volatileStreams.set(id, slot)
		refreshStopGenerationButton()
	}
	else if (charname && !slot.charname)
		slot.charname = charname
	return slot
}

/** @param {VolatileStreamSlot} slot 流式槽 @returns {void} */
function flushReorderToRenderer(slot) {
	while (slot.reorder.chunks.has(slot.reorder.expectedSeq)) {
		applySlices(slot.tracked, slot.reorder.chunks.get(slot.reorder.expectedSeq))
		slot.reorder.chunks.delete(slot.reorder.expectedSeq)
		slot.reorder.expectedSeq++
	}
	if (slot.streamRenderer)
		slot.streamRenderer.setTarget(streamDisplayText(slot.tracked))
}

/**
 * @param {string} streamId pendingStreamId
 * @returns {StreamRenderer | null} 已绑定渲染器
 */
function bindStreamRenderer(streamId) {
	const slot = volatileStreams.get(streamId)
	if (!slot) return null
	const row = document.querySelector(streamingMessageRowSelector(streamId))
	const body = row?.querySelector('[data-streaming-body]')
	if (!(body instanceof HTMLElement)) return null
	const bound = slot.streamRenderer
	if (bound?.attachedTo === body && body.isConnected) return bound
	slot.streamRenderer = new StreamRenderer(body)
	if (!slot.charname)
		slot.charname = row.getAttribute('data-char-id') || ''
	flushReorderToRenderer(slot)
	return slot.streamRenderer
}

/** @param {string} streamId pendingStreamId @returns {void} */
export function removeVolatileStream(streamId) {
	if (!volatileStreams.has(streamId)) return
	volatileStreams.delete(streamId)
	refreshStopGenerationButton()
}

/**
 * 丢弃客户端 volatile 流式预览状态；默认不中止服务端生成（仅 UI 切走）。
 * @param {{ abortBackend?: boolean }} [options] 选项
 * @returns {void}
 */
export function resetVolatileStreamState({ abortBackend = false } = {}) {
	const activeIds = [...volatileStreams.keys()]
	if (abortBackend)
		for (const id of activeIds)
			stopGeneration({ messageId: id, dagEventId: id })

	for (const slot of volatileStreams.values())
		slot.streamRenderer = null
	volatileStreams.clear()
	streamIdsFetchingRow.clear()
	store.messages.composerPendingId = null
	refreshStopGenerationButton()
}

/**
 * 流式预览结束后：主频道增量刷新 + 末条角色消息滑动手势 + 滚底。
 * @returns {Promise<void>}
 */
async function afterStreamEnd() {
	if (store.context.currentGroupId && store.context.currentChannelId) {
		const { scheduleChannelIncrementalRefresh } = await import('../messages/messages.mjs')
		await scheduleChannelIncrementalRefresh({ immediate: true })
	}
	scrollToBottom()
}

/**
 * @param {string} streamId pendingStreamId
 * @param {{ notifyEnd?: boolean }} [options] 是否触发流结束刷新
 * @returns {void}
 */
export function dismissVolatileStreamPreview(streamId, { notifyEnd = true } = {}) {
	const id = String(streamId || '').trim()
	if (!id || !volatileStreams.has(id)) return
	removeVolatileStream(id)
	if (notifyEnd)
		void afterStreamEnd()
}

/** @param {string} streamId pendingStreamId @returns {void} */
export function finishVolatileStreamPreview(streamId) {
	const slot = volatileStreams.get(streamId)
	if (!slot) return
	const renderer = slot.streamRenderer
	slot.streamRenderer = null
	if (renderer)
		void renderer.finish().catch(error => console.error('hub stream finish:', error))
	dismissVolatileStreamPreview(streamId, { notifyEnd: true })
}

/**
 * @param {string} streamId pendingStreamId
 * @param {number} sequence chunkSeq
 * @param {object[]} slices 差异切片
 * @param {string | undefined} eventChannelId 事件频道
 * @returns {Promise<void>}
 */
export async function appendStreamSlices(streamId, sequence, slices, eventChannelId) {
	if (!document.querySelector(streamingMessageRowSelector(streamId)) && !streamIdsFetchingRow.has(streamId)) {
		streamIdsFetchingRow.add(streamId)
		dispatchChannelIncrementalRefresh(eventChannelId, activeChannelId || eventChannelId || '', { immediate: true })
	}

	const slot = getOrCreateStreamSlot(streamId)
	slot.reorder.chunks.set(sequence, slices)
	bindStreamRenderer(streamId)
	flushReorderToRenderer(slot)

	document.querySelector(streamingMessageRowSelector(streamId))
		?.querySelector('.streaming-typing')?.remove()

	const container = document.getElementById('messages')
	if (container) container.scrollTop = container.scrollHeight
}

/**
 * @param {HTMLElement} [container] 消息列表根
 * @returns {void}
 */
export function syncStreamingSlotsFromDom(container) {
	const root = container instanceof HTMLElement ? container : document.getElementById('messages')
	if (!root) return
	for (const row of root.querySelectorAll('[data-streaming][data-message-id]')) {
		const streamId = row.getAttribute('data-message-id')
		if (!streamId) continue
		streamIdsFetchingRow.delete(streamId)
		getOrCreateStreamSlot(streamId, row.getAttribute('data-char-id') || '')
		bindStreamRenderer(streamId)
	}
	for (const streamId of [...volatileStreams.keys()])
		if (!root.querySelector(streamingMessageRowSelector(streamId)))
			removeVolatileStream(streamId)
	resumeActiveStreamBuffers()
}

/** 重进频道时补拉服务端已缓冲的 stream_chunk（切走期间错过的 diff）。 */
export function resumeActiveStreamBuffers() {
	const groupId = store.context.currentGroupId
	const channelId = store.context.currentChannelId
	if (!groupId || !channelId || !volatileStreams.size) return
	for (const streamId of [...volatileStreams.keys()])
		void (async () => {
			try {
				const { getStreamBufferChunks } = await import('../../src/api/groupChannel.mjs')
				const chunks = await getStreamBufferChunks(groupId, channelId, streamId)
				for (const chunk of chunks)
					await appendStreamSlices(streamId, Number(chunk.chunkSeq ?? 0), chunk.slices || [], channelId)
			}
			catch { /* empty */ }
		})()
}
