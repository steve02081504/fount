import { createWsMessageHandler } from './ui/wsController.mjs'
import {
	attachGroupWebSocketErrorHandlers,
	handleBroadcastEvent as handleSessionEvent,
	handleGroupWebSocketRpc,
	setActiveWebSocket,
	setWsStatusIndicator,
	sendWebsocketMessage,
} from './websocket.mjs'

/**
 * @typedef {object} ApplyGroupHashWsPayload
 * @property {string} groupId
 * @property {string} channelId
 * @property {string} wsClientId
 * @property {object} channelState
 * @property {Function} scheduleMessagePatch
 * @property {Map<string, string>} memberAvatarCache
 * @property {Map<string, ReturnType<typeof setTimeout>>} typingUsers
 * @property {number} TYPING_TIMEOUT
 * @property {() => void} updateTypingDisplay
 * @property {() => Promise<void>} loadMessages
 * @property {() => Promise<void>} loadState
 * @property {() => Promise<void>} loadBookmarks
 * @property {(chId: string) => boolean} shouldLoadChannel
 * @property {HTMLElement} msgBox
 */

/**
 * 建立群组 WebSocket，并挂载消息分发与 RPC 处理。
 * @param {ApplyGroupHashWsPayload} payload 频道状态、加载回调、打字指示等依赖
 * @param {{ get: () => WebSocket | null, set: (ws: WebSocket | null) => void }} groupWsSlot 存取当前群组 WebSocket 的插槽（关闭旧连接、保存新连接）
 * @returns {void}
 */
export function setupGroupWebSocket(payload, groupWsSlot) {
	const {
		groupId,
		channelId,
		wsClientId,
		channelState,
		scheduleMessagePatch,
		memberAvatarCache,
		typingUsers,
		TYPING_TIMEOUT,
		updateTypingDisplay,
		loadMessages,
		loadState,
		loadBookmarks,
		shouldLoadChannel,
		msgBox,
	} = payload

	const wsProto = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
	const wsUrl = `${wsProto}//${window.location.host}/ws/parts/shells:chat/groups/${encodeURIComponent(groupId)}`
	if (groupWsSlot.get()) {
		setWsStatusIndicator(null)
		groupWsSlot.get().close()
	}
	const ws = new WebSocket(wsUrl)
	groupWsSlot.set(ws)
	attachGroupWebSocketErrorHandlers(ws)
	setWsStatusIndicator(ws)
	setActiveWebSocket(ws)
	ws.addEventListener('open', () => {
		sendWebsocketMessage({ type: 'group_ws_rpc_identity', clientNodeId: wsClientId })
	}, { once: true })

	ws.onmessage = createWsMessageHandler({
		groupId,
		channelId,
		wsClientId,
		state: channelState,
		scheduleMessagePatch,
		memberAvatarCache,
		typingUsers,
		TYPING_TIMEOUT,
		updateTypingDisplay,
		loadMessages,
		loadState,
		loadBookmarks,
		/**
		 * 从插槽读取当前群组 WebSocket（供 RPC 等读取）。
		 * @returns {WebSocket | null} 已连接实例；未连接或已清空时为 null
		 */
		getGroupWs: () => groupWsSlot.get(),
		shouldLoadChannel,
		handleGroupWebSocketRpc,
		handleSessionEvent,
		msgBox,
	})
}
