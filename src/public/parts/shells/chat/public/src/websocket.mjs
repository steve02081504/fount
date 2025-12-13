import { onServerEvent } from '../../../../../scripts/server_events.mjs'

import { currentChatId } from './endpoints.mjs'
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

let ws = null

/**
 * Sends a message through the WebSocket.
 * @param {object} message - The message object to send.
 */
export function sendWebsocketMessage(message) {
	if (ws && ws.readyState === WebSocket.OPEN)
		ws.send(JSON.stringify(message))
	else
		console.error('WebSocket is not connected.')
}

/**
 * 连接到WebSocket。
 */
function connect() {
	if (!currentChatId) return

	const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
	const wsUrl = `${wsProtocol}//${window.location.host}/ws/shells/chat/ui/${currentChatId}`
	ws = new WebSocket(wsUrl)

	/**
	 * WebSocket收到消息时的回调。
	 * @param {MessageEvent} event - 消息事件。
	 */
	ws.onmessage = (event) => {
		try {
			const msg = JSON.parse(event.data)
			// Handle broadcast events
			handleBroadcastEvent(msg)
		}
		catch (error) {
			console.error('Error processing WebSocket message:', error)
			import('https://esm.sh/@sentry/browser').then(Sentry => Sentry.captureException(error))
		}
	}

	/**
	 * WebSocket关闭时的回调。
	 */
	ws.onclose = () => {
		const RECONNECT_DELAY = 3000
		console.log(`Chat UI WebSocket disconnected. Reconnecting in ${RECONNECT_DELAY / 1000} seconds...`)
		ws = null
		setTimeout(connect, RECONNECT_DELAY)
	}

	/**
	 * WebSocket出错时的回调。
	 * @param {Event} err - 错误事件。
	 */
	ws.onerror = (err) => {
		console.error('Chat UI WebSocket error:', err)
	}
}

/**
 * 处理广播事件。
 * @param {object} event - 事件。
 * @returns {Promise<void>}
 */
async function handleBroadcastEvent(event) {
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
			console.log('Stream started for message:', payload.messageId)
			break
		case 'stream_update':
			await handleStreamUpdate(payload)
			break
		default:
			console.warn(`Unknown broadcast event type: ${type}`)
	}
}

/**
 * 初始化WebSocket。
 */
export function initializeWebSocket() {
	if (ws) return
	connect()

	onServerEvent('part-installed', ({ parttype, partname }) => {
		addPartToSelect(parttype, partname)
	})

	onServerEvent('part-uninstalled', ({ parttype, partname }) => {
		removePartFromSelect(parttype, partname)
	})
}
