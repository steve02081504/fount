/**
 * 【文件】public/hub/stream/connection.mjs
 * 【职责】群 Hub WebSocket 连接生命周期：connect / close / wait / isOpen。
 */
import { showToastI18n } from '../../../../../scripts/features/toast.mjs'
import { setActiveWebSocket } from '../../src/groupWsClient.mjs'
import { buildChatGroupWebSocketUrl } from '../../src/wsUrl.mjs'
import { hubStore } from '../core/state.mjs'

import * as conn from './connectionState.mjs'
import { handleChannelMessageWire } from './handlers/channelMessage.mjs'
import { handleDagEventWire } from './handlers/dagEvent.mjs'
import { handleVolatileStreamWire } from './handlers/streamChunk.mjs'
import { resetVolatileStreamState } from './volatileSlots.mjs'

/** @returns {boolean} 群 WS 已 OPEN */
export function isGroupWebSocketOpen() {
	return !!(conn.groupWebSocket && conn.connectedGroupId && conn.groupWebSocket.readyState === WebSocket.OPEN)
}

/** @returns {void} */
export function closeGroupWebSocket() {
	resetVolatileStreamState()
	try {
		conn.groupWebSocket?.close()
	}
	catch { /* empty */ }
	conn.setConnectionHandles(null, null, null)
	setActiveWebSocket(null)
}

/**
 * @param {string} groupId 群 ID
 * @param {string} channelId 频道 ID
 * @param {{ timeoutMs?: number }} [options] 超时
 * @returns {Promise<boolean>} 是否在超时内 OPEN
 */
export function waitForGroupWebSocketOpen(groupId, channelId, { timeoutMs = 8000 } = {}) {
	if (conn.groupWebSocket && conn.connectedGroupId === groupId && conn.groupWebSocket.readyState === WebSocket.OPEN) {
		conn.setActiveChannelId(channelId)
		return Promise.resolve(true)
	}
	connectGroupWebSocket(groupId, channelId)
	const socket = conn.groupWebSocket
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
		/** @returns {void} */
		function onOpen() { finish(true) }
		/** @returns {void} */
		function onClose() { finish(false) }
		timer = setTimeout(() => finish(socket.readyState === WebSocket.OPEN), timeoutMs)
		socket.addEventListener('open', onOpen, { once: true })
		socket.addEventListener('close', onClose, { once: true })
	})
}

/**
 * @param {object} wireMessage WS 载荷
 * @param {string} channelId 当前频道
 * @returns {void}
 */
function handleGroupHubWireMessage(wireMessage, channelId) {
	if (!wireMessage?.type) return
	if (handleChannelMessageWire(wireMessage, channelId)) return
	handleDagEventWire(wireMessage, channelId)
}

/**
 * @param {string} groupId 群 ID
 * @param {string} channelId 频道 ID
 * @returns {void}
 */
export function connectGroupWebSocket(groupId, channelId) {
	if (!groupId) return
	if (conn.groupWebSocket && conn.connectedGroupId === groupId) {
		conn.setActiveChannelId(channelId)
		const rs = conn.groupWebSocket.readyState
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
	conn.setConnectionHandles(socket, groupId, channelId)
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
		const currentChannelId = conn.activeChannelId || channelId
		handleGroupHubWireMessage(wireMessage, currentChannelId)
		void handleVolatileStreamWire(wireMessage, currentChannelId)
	})
	socket.addEventListener('close', () => {
		if (conn.groupWebSocket === socket) {
			conn.setConnectionHandles(null, null, null)
			setActiveWebSocket(null)
			resetVolatileStreamState()
		}
	})
}
