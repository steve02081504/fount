import { onServerEvent } from '../../../../../scripts/server_events.mjs'

import {
	handleWorldSet,
	handlePersonaSet,
	handleCharAdded,
	handleCharRemoved,
	handleCharFrequencySet,
	addPartToSelect,
	removePartFromSelect,
	handlePluginAdded,
	handlePluginRemoved,
} from './ui/sidebar.mjs'
import { handleTypingStatus } from './ui/typingIndicator.mjs'
import { handleMessageAdded, handleMessageDeleted, handleMessageReplaced, handleStreamUpdate } from './ui/virtualQueue.mjs'

/** 群模式（hash #group:…）下当前活动的群组连接 */
let groupShellWebSocket = null

/**
 * 群模式切换时绑定/解绑当前群组 WebSocket。
 * @param {WebSocket | null} gws 群组 WS；卸载时为 null
 * @returns {void}
 */
export function setActiveWebSocket(gws) {
	groupShellWebSocket = gws
}

/** @type {((msg: object) => void | Promise<void>) | null} */
let inboundRpcExecutor = null

/**
 * @param {((msg: object) => void | Promise<void>) | null} fn 入站 RPC 执行器
 * @returns {void}
 */
export function setInboundRpcExecutor(fn) {
	inboundRpcExecutor = fn
}

/**
 * @param {string | null} id 本客户端在群 WS 上的 node id
 * @returns {void}
 */
export function setLocalGroupRpcClientNodeId(id) {
	void id
}

/**
 * @returns {void}
 */
export function setWsStatusIndicator() {
}

/**
 * @param {WebSocket} ws 群组 WS
 * @returns {void}
 */
export function attachGroupWebSocketErrorHandlers(ws) {
	ws.addEventListener('error', ev => {
		console.error('group WebSocket error:', ev)
	})
}

/**
 * 群 WS 广播帧 → 经典虚拟队列 / 侧栏（Hub 内嵌 AI 等仍可能依赖）。
 * @param {object} event 解析后的 JSON
 * @returns {Promise<void>}
 */
export async function handleBroadcastEvent(event) {
	const { type, payload } = event
	switch (type) {
		case 'message_added':
			await handleMessageAdded(payload)
			break
		case 'message_replaced':
			await handleMessageReplaced(payload.index, payload.entry)
			break
		case 'message_deleted':
			await handleMessageDeleted(payload.index)
			break
		case 'message_edited':
			await handleMessageReplaced(payload.index, payload.entry)
			break
		case 'persona_set':
			await handlePersonaSet(payload.personaname)
			break
		case 'world_set':
			await handleWorldSet(payload.worldname)
			break
		case 'char_added':
			await handleCharAdded(payload.charname)
			break
		case 'char_removed':
			await handleCharRemoved(payload.charname)
			break
		case 'char_frequency_set':
			await handleCharFrequencySet(payload.charname, payload.frequency)
			break
		case 'plugin_added':
			await handlePluginAdded(payload.pluginname)
			break
		case 'plugin_removed':
			await handlePluginRemoved(payload.pluginname)
			break
		case 'typing_status':
			await handleTypingStatus(payload.typingList)
			break
		case 'stream_start':
			break
		case 'stream_update':
			await handleStreamUpdate(payload)
			break
		default:
			console.warn(`Unknown broadcast event type: ${type}`)
	}
}

/**
 * 消费群 WS 上的 `rpc_call`。
 * @param {object} msg 已解析 JSON
 * @returns {Promise<boolean>} true 表示已消费
 */
export async function handleGroupWebSocketRpc(msg) {
	if (!msg || typeof msg !== 'object' || msg.type !== 'rpc_call')
		return false
	if (!inboundRpcExecutor)
		return false
	await inboundRpcExecutor(msg)
	return true
}

/**
 * 经当前已绑定的群 WebSocket 发送 JSON（无连接则仅打日志）。
 * @param {object} message 消息体
 * @returns {void}
 */
export function sendWebsocketMessage(message) {
	const target = groupShellWebSocket
	if (target && target.readyState === WebSocket.OPEN)
		target.send(JSON.stringify(message))
	else
		console.error('WebSocket is not connected.')
}

/**
 * 注册部件安装/卸载监听（无经典单聊重连）。
 * @returns {void}
 */
export function initializeWebSocket() {
	onServerEvent('part-installed', ({ parttype, partname }) => {
		addPartToSelect(parttype, partname)
	})

	onServerEvent('part-uninstalled', ({ parttype, partname }) => {
		removePartFromSelect(parttype, partname)
	})
}
