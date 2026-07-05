/**
 * 群 Hub WebSocket：DAG/频道事件与 VOLATILE `stream_chunk`（slices diff）流式预览。
 */
import { showToastI18n } from '../../../../scripts/features/toast.mjs'
import { getGroupState } from '../src/api/groupApi.mjs'
import { setActiveWebSocket, stopGeneration } from '../src/groupWsClient.mjs'
import { streamDisplayText } from '../src/streamDisplay.mjs'
import { applySlices } from '../src/streamSlices.mjs'
import { StreamRenderer } from '../src/ui/StreamRenderer.mjs'
import { buildChatGroupWebSocketUrl } from '../src/wsUrl.mjs'

import { hubStore } from './core/state.mjs'
import { renderHubChannelSidebar } from './groupNav.mjs'
import { maybeNotifyHubMessage } from './hubNotifications.mjs'
import { messageIdSelector } from './messages/messageShared.mjs'
import { getActiveThreadChannelId } from './threadDrawer.mjs'

/** @type {WebSocket | null} */
let groupWebSocket = null
/** @type {string | null} */
let connectedGroupId = null
/** @type {string | null} */
let activeChannelId = null

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

/** @type {(streamId?: string) => Promise<void>} */
let onStreamEnd = async () => { }

/** @type {() => Promise<void>} */
let onChannelRefresh = async () => { }

/** @type {() => Promise<void>} */
let onThreadChannelRefresh = async () => { }

/** @type {(targetId: string) => Promise<void>} */
let onMessageEdit = async () => { }

/** @type {(targetId: string) => Promise<void>} */
let onMessageDelete = async () => { }

/** @type {(() => void) | null} */
let onGenerationActiveChange = null

/**
 * @param {(streamId?: string) => Promise<void>} handler 流结束回调
 * @returns {void}
 */
export function setGroupStreamEndHandler(handler) {
	onStreamEnd = handler ?? (async () => { })
}

/**
 * @param {() => void} handler 频道增量刷新
 * @returns {void}
 */
export function setGroupChannelRefreshHandler(handler) {
	onChannelRefresh = handler ?? (async () => { })
}

/**
 * @param {() => Promise<void>} handler 子线程频道刷新
 * @returns {void}
 */
export function setGroupThreadChannelRefreshHandler(handler) {
	onThreadChannelRefresh = handler ?? (async () => { })
}

/**
 * @param {(targetId: string) => Promise<void>} handler message_edit 终稿刷新
 * @returns {void}
 */
export function setGroupMessageEditHandler(handler) {
	onMessageEdit = handler ?? (async () => { })
}

/**
 * @param {(targetId: string) => Promise<void>} handler message_delete 移除展示行
 * @returns {void}
 */
export function setGroupMessageDeleteHandler(handler) {
	onMessageDelete = handler ?? (async () => { })
}

/**
 * @param {(() => void) | null} handler 流式活跃状态变化
 * @returns {void}
 */
export function setGenerationActiveChangeHandler(handler) {
	onGenerationActiveChange = handler ?? null
}

/** @returns {void} 通知生成中 UI */
function notifyGenerationActiveChange() {
	onGenerationActiveChange?.()
}

/** @returns {string[]} 活跃 pendingStreamId 列表 */
export function getActiveVolatileStreamIds() {
	return [...volatileStreams.keys()]
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
		notifyGenerationActiveChange()
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

/**
 * @param {HTMLElement} [container] 消息列表根
 * @returns {void}
 */
export function syncStreamingSlotsFromDom(container) {
	const root = container instanceof HTMLElement ? container : document.getElementById('hub-messages')
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
	const groupId = hubStore.context.currentGroupId
	const channelId = hubStore.context.currentChannelId
	if (!groupId || !channelId || !volatileStreams.size) return
	for (const streamId of [...volatileStreams.keys()]) 
		void (async () => {
			try {
				const { getStreamBufferChunks } = await import('../src/api/groupApi.mjs')
				const chunks = await getStreamBufferChunks(groupId, channelId, streamId)
				for (const chunk of chunks)
					await appendStreamSlices(streamId, Number(chunk.chunkSeq ?? 0), chunk.slices || [], channelId)
			}
			catch { /* empty */ }
		})()
	
}

/**
 * @param {string | undefined} eventChannelId 事件频道
 * @param {string} mainChannelId 当前主频道
 * @returns {{ main: boolean, thread: boolean }} 是否命中
 */
function hubChannelMatch(eventChannelId, mainChannelId) {
	const threadCh = getActiveThreadChannelId()
	if (!eventChannelId)
		return { main: true, thread: false }
	return {
		main: eventChannelId === mainChannelId,
		thread: !!threadCh && eventChannelId === threadCh,
	}
}

/**
 * @param {string | undefined} eventChannelId 事件频道
 * @param {string} mainChannelId 主频道
 * @param {{ immediate?: boolean }} [options] 刷新选项
 * @returns {void}
 */
function dispatchChannelIncrementalRefresh(eventChannelId, mainChannelId, options = {}) {
	const { main, thread } = hubChannelMatch(eventChannelId, mainChannelId)
	if (main) void onChannelRefresh(options)
	if (thread) void onThreadChannelRefresh()
}

/**
 * @param {string | undefined} eventChannelId 事件频道
 * @param {string} mainChannelId 主频道
 * @returns {void}
 */
function dispatchChannelOverlayRefresh(eventChannelId, mainChannelId) {
	const { main, thread } = hubChannelMatch(eventChannelId, mainChannelId)
	if (main) void onChannelRefresh()
	if (thread) void onThreadChannelRefresh()
}

/**
 * 丢弃客户端 volatile 流式预览状态；默认不中止服务端生成（仅 UI 切走）。
 * @param {{ abortBackend?: boolean }} [options] 选项
 * @param {boolean} [options.abortBackend] 为 true 时向服务端发送 stop_generation
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
	hubStore.messages.composerPendingId = null
	notifyGenerationActiveChange()
}

/** @returns {void} */
export function closeGroupWebSocket() {
	resetVolatileStreamState()
	try {
		groupWebSocket?.close()
	}
	catch { /* empty */ }
	groupWebSocket = null
	connectedGroupId = null
	activeChannelId = null
	setActiveWebSocket(null)
}

/** @param {string} streamId pendingStreamId @returns {void} */
function removeVolatileStream(streamId) {
	if (!volatileStreams.has(streamId)) return
	volatileStreams.delete(streamId)
	notifyGenerationActiveChange()
}

/**
 * @param {string} streamId pendingStreamId
 * @param {{ notifyEnd?: boolean }} [options] 是否触发 onStreamEnd
 * @returns {void}
 */
export function dismissVolatileStreamPreview(streamId, { notifyEnd = true } = {}) {
	const id = String(streamId || '').trim()
	if (!id || !volatileStreams.has(id)) return
	removeVolatileStream(id)
	if (notifyEnd)
		void onStreamEnd(id)
}

/** @param {string} streamId pendingStreamId @returns {void} */
function finishVolatileStreamPreview(streamId) {
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
async function appendStreamSlices(streamId, sequence, slices, eventChannelId) {
	if (!document.querySelector(streamingMessageRowSelector(streamId)) && !streamIdsFetchingRow.has(streamId)) {
		streamIdsFetchingRow.add(streamId)
		dispatchChannelIncrementalRefresh(eventChannelId, activeChannelId || eventChannelId || '', { immediate: true })
	}

	const slot = getOrCreateStreamSlot(streamId)
	slot.reorder.chunks.set(sequence, slices)
	bindStreamRenderer(streamId)
	flushReorderToRenderer(slot)

	document.querySelector(streamingMessageRowSelector(streamId))
		?.querySelector('.hub-streaming-typing')?.remove()

	const container = document.getElementById('hub-messages')
	if (container) container.scrollTop = container.scrollHeight
}

const OVERLAY_DAG_TYPES = new Set([
	'message_edit', 'message_delete', 'message_feedback',
	'reaction_add', 'reaction_remove', 'pin_message', 'unpin_message',
])

const CHANNEL_STRUCTURE_DAG_TYPES = new Set([
	'channel_create', 'channel_update', 'channel_delete',
])

/**
 * @param {object} wireMessage WS 载荷
 * @param {string} channelId 当前频道
 * @returns {void}
 */
function handleGroupHubWireMessage(wireMessage, channelId) {
	if (!wireMessage?.type) return

	if (wireMessage.type === 'channel_message') {
		const incomingChannelId = wireMessage.channelId
		const { main, thread } = hubChannelMatch(incomingChannelId, channelId)
		if (!main && !thread) return
		const channelMessage = wireMessage.message
		if (channelMessage?.type === 'message_edit') {
			const targetId = String(channelMessage.content?.targetId || '').trim()
			if (targetId) {
				if (volatileStreams.has(targetId))
					finishVolatileStreamPreview(targetId)
				void onMessageEdit(targetId)
			}
			return
		}
		const content = channelMessage?.content
		if (content?.is_generating && channelMessage?.eventId) {
			dispatchChannelIncrementalRefresh(incomingChannelId, channelId, { immediate: true })
			return
		}
		if (main && channelMessage && !content?.is_generating)
			maybeNotifyHubMessage({
				groupName: hubStore.context.currentState?.groupMeta?.name || hubStore.context.currentGroupId,
				channelName: hubStore.context.currentState?.channels?.[incomingChannelId]?.name || incomingChannelId,
				message: channelMessage,
				viewerPubKeyHash: hubStore.context.currentState?.viewerMemberPubKeyHash || null,
			})

		dispatchChannelIncrementalRefresh(incomingChannelId, channelId, { immediate: true })
		return
	}

	if (wireMessage.type === 'dag_event') {
		const dagEvent = wireMessage.event
		const eventChannelId = dagEvent?.channelId
		const { main, thread } = hubChannelMatch(eventChannelId, channelId)
		if (eventChannelId && !main && !thread) return
		if (CHANNEL_STRUCTURE_DAG_TYPES.has(dagEvent?.type) && hubStore.context.currentGroupId) {
			void (async () => {
				try {
					hubStore.context.currentState = await getGroupState(hubStore.context.currentGroupId)
					await renderHubChannelSidebar(hubStore.context.currentState)
				}
				catch { /* empty */ }
			})()
			return
		}
		if (dagEvent?.type === 'message_edit') {
			const targetId = String(dagEvent.content?.targetId || '')
			if (targetId) {
				if (volatileStreams.has(targetId))
					finishVolatileStreamPreview(targetId)
				void onMessageEdit(targetId)
			}
			return
		}
		if (dagEvent?.type === 'message_delete') {
			const targetId = String(dagEvent.content?.targetId || '')
			if (targetId) {
				removeVolatileStream(targetId)
				void onMessageDelete(targetId)
			}
			return
		}
		if (OVERLAY_DAG_TYPES.has(dagEvent?.type)) {
			dispatchChannelOverlayRefresh(eventChannelId, channelId)
			return
		}
	}
}

/**
 * @param {object} wireMessage WS 载荷
 * @param {string} channelId 当前频道
 * @returns {Promise<void>}
 */
async function handleVolatileStreamWireMessage(wireMessage, channelId) {
	if (wireMessage.type === 'reputation_slash_alert') {
		const target = String(wireMessage.targetPubKeyHash || '').slice(0, 16)
		showToastI18n('warning', 'chat.hub.reputationSlashAlert', { target })
		return
	}

	if (wireMessage.channelId && wireMessage.channelId !== channelId) return
	if (wireMessage.type !== 'stream_chunk') return

	const streamId = String(wireMessage.pendingStreamId || '')
	const { slices } = wireMessage
	if (!streamId || !Array.isArray(slices) || !slices.length) return

	await appendStreamSlices(
		streamId,
		Number(wireMessage.chunkSeq ?? 0),
		slices,
		wireMessage.channelId || channelId,
	)
}

/** @returns {boolean} 群 WS 已 OPEN */
export function isGroupWebSocketOpen() {
	return !!(groupWebSocket && connectedGroupId && groupWebSocket.readyState === WebSocket.OPEN)
}

/**
 * @param {string} groupId 群 ID
 * @param {string} channelId 频道 ID
 * @param {{ timeoutMs?: number }} [options] 超时
 * @returns {Promise<boolean>} 是否在超时内 OPEN
 */
export function waitForGroupWebSocketOpen(groupId, channelId, { timeoutMs = 8000 } = {}) {
	if (groupWebSocket && connectedGroupId === groupId && groupWebSocket.readyState === WebSocket.OPEN) {
		activeChannelId = channelId
		return Promise.resolve(true)
	}
	connectGroupWebSocket(groupId, channelId)
	const socket = groupWebSocket
	if (!socket) return Promise.resolve(false)
	if (socket.readyState === WebSocket.OPEN) return Promise.resolve(true)
	return new Promise(resolve => {
		let timer
		/** @param {boolean} opened 是否已连接 @returns {void} */
		function finish(opened) {
			clearTimeout(timer)
			socket.removeEventListener('open', onOpen)
			socket.removeEventListener('close', onClose)
			resolve(opened)
		}
		/**
		 * WebSocket 连接成功回调。
		 * @returns {void}
		 */
		function onOpen() { finish(true) }
		/**
		 * WebSocket 连接关闭回调。
		 * @returns {void}
		 */
		function onClose() { finish(false) }
		timer = setTimeout(() => finish(socket.readyState === WebSocket.OPEN), timeoutMs)
		socket.addEventListener('open', onOpen, { once: true })
		socket.addEventListener('close', onClose, { once: true })
	})
}

/**
 * @param {string} groupId 群 ID
 * @param {string} channelId 频道 ID
 * @returns {void}
 */
export function connectGroupWebSocket(groupId, channelId) {
	if (!groupId) return
	if (groupWebSocket && connectedGroupId === groupId) {
		activeChannelId = channelId
		const rs = groupWebSocket.readyState
		if (rs === WebSocket.OPEN || rs === WebSocket.CONNECTING)
			return
	}
	closeGroupWebSocket()
	const ownerNodeHash = hubStore.viewer.nodeHash
	if (!ownerNodeHash) {
		showToastI18n('warning', 'chat.hub.profilePopup.noFedIdentity')
		return
	}
	const socket = new WebSocket(buildChatGroupWebSocketUrl(ownerNodeHash, groupId))
	groupWebSocket = socket
	connectedGroupId = groupId
	activeChannelId = channelId
	setActiveWebSocket(socket)
	socket.addEventListener('open', () => {
		if (hubStore.viewer.nodeHash && socket.readyState === WebSocket.OPEN)
			socket.send(JSON.stringify({
				type: 'group_ws_rpc_identity',
				clientNodeId: hubStore.viewer.nodeHash,
			}))
	})
	socket.addEventListener('message', event => {
		let wireMessage
		try {
			wireMessage = JSON.parse(event.data)
		}
		catch {
			return
		}
		if (!wireMessage?.type) return
		const currentChannelId = activeChannelId || channelId
		handleGroupHubWireMessage(wireMessage, currentChannelId)
		void handleVolatileStreamWireMessage(wireMessage, currentChannelId)
	})
	socket.addEventListener('close', () => {
		if (groupWebSocket === socket) {
			groupWebSocket = null
			connectedGroupId = null
			setActiveWebSocket(null)
			resetVolatileStreamState()
		}
	})
}
