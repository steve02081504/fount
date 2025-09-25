import { currentChatId } from './endpoints.mjs'
import {
	updateSidebar,
	handleWorldSet,
	handlePersonaSet,
	handleCharAdded,
	handleCharRemoved,
	handleCharFrequencySet,
} from './ui/sidebar.mjs'
import { handleMessageAdded, handleMessageDeleted, handleMessageReplaced, initializeFromInitialData } from './ui/virtualQueue.mjs'

let ws = null
const pendingRequests = new Map()
let messageIdCounter = 0

function connect() {
	if (!currentChatId) return

	const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
	const wsUrl = `${wsProtocol}//${window.location.host}/ws/shells/chat/ui/${currentChatId}`
	ws = new WebSocket(wsUrl)

	ws.onopen = async () => {
		console.log(`Chat UI WebSocket connected for chat ${currentChatId}.`)
		// Request initial data upon connection
		const initialData = await sendRequest('get_initial_data')
		await initializeFromInitialData(initialData)
		await updateSidebar({
			charlist: initialData.charlist,
			worldname: initialData.worldname,
			personaname: initialData.personaname,
			frequency_data: initialData.frequency_data,
		})
	}

	ws.onmessage = (event) => {
		try {
			const msg = JSON.parse(event.data)

			if (msg.type === 'response') {
				if (pendingRequests.has(msg.id)) {
					const { resolve, reject } = pendingRequests.get(msg.id)
					if (msg.error)
						reject(new Error(msg.error))
					else
						resolve(msg.payload)

					pendingRequests.delete(msg.id)
				}
			} else
				// Handle broadcast events
				handleBroadcastEvent(msg)

		} catch (error) {
			console.error('Error processing WebSocket message:', error)
		}
	}

	ws.onclose = () => {
		const RECONNECT_DELAY = 3000;
		console.log(`Chat UI WebSocket disconnected. Reconnecting in ${RECONNECT_DELAY / 1000} seconds...`);
		ws = null;
		setTimeout(connect, RECONNECT_DELAY);
	};

	ws.onerror = (err) => {
		console.error('Chat UI WebSocket error:', err)
	}
}

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
		default:
			console.warn(`Unknown broadcast event type: ${type}`)
	}
}

export function sendRequest(command, params = {}) {
	return new Promise((resolve, reject) => {
		if (!ws || ws.readyState !== WebSocket.OPEN) {
			// Queue the request if the socket is connecting, otherwise reject.
			if (ws && ws.readyState === WebSocket.CONNECTING) {
				const onOpen = () => {
					ws.removeEventListener('open', onOpen)
					sendRequest(command, params).then(resolve, reject)
				}
				ws.addEventListener('open', onOpen)
			} else
				reject(new Error('WebSocket is not connected.'))

			return
		}

		const id = messageIdCounter++
		pendingRequests.set(id, { resolve, reject })

		// Timeout for the request
		setTimeout(() => {
			if (pendingRequests.has(id)) {
				pendingRequests.delete(id)
				reject(new Error(`Request ${id} (${command}) timed out.`))
			}
		}, 30000) // 30 seconds timeout

		ws.send(JSON.stringify({ id, command, params }))
	})
}

export function initializeWebSocket() {
	if (ws) return
	connect()
}
