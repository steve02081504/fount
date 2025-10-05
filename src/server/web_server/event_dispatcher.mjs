import { console } from '../../scripts/i18n.mjs'
import { currentGitCommit } from '../server.mjs'

// Stores active WebSocket connections for each user.
// { username: Set<WebSocket> }
const userConnections = new Map()

/**
 * Registers a WebSocket connection for a user.
 * @param {string} username - The username.
 * @param {import('npm:ws')} ws - The WebSocket instance.
 */
export function register(username, ws) {
	if (!userConnections.has(username)) userConnections.set(username, new Set())

	const connections = userConnections.get(username)
	connections.add(ws)

	// Send current commit ID on connect
	if (ws.readyState === ws.OPEN)
		ws.send(JSON.stringify({ type: 'server-reconnected', data: { commitId: currentGitCommit } }))

	ws.on('close', () => {
		unregister(username, ws)
	})
}

/**
 * Unregisters a WebSocket connection for a user.
 * @param {string} username - The username.
 * @param {import('npm:ws')} ws - The WebSocket instance.
 */
export function unregister(username, ws) {
	const connections = userConnections.get(username)
	if (connections) {
		connections.delete(ws)
		if (!connections.size)
			userConnections.delete(username)
	}
}

/**
 * Sends a structured message to a set of WebSocket connections.
 * @param {Set<import('npm:ws')>} connections
 * @param {string} type
 * @param {any} data
 */
function sendMessageToConnections(connections, type, data) {
	if (connections && connections.size > 0) {
		const payload = JSON.stringify({ type, data })
		for (const ws of connections)
			if (ws.readyState === ws.OPEN) try {
				ws.send(payload)
			} catch (e) { console.error(e) }
		return true
	}
	return false
}

/**
 * Sends a message to all connected clients for a specific user.
 * @param {string} username - The username to send to.
 * @param {string} type - The message type.
 * @param {any} data - The message data.
 */
export function sendEventToUser(username, type, data) {
	const connections = userConnections.get(username)
	const success = sendMessageToConnections(connections, type, data)
	if (!success) console.log(`[Notify] No active connections found for user: ${username}`)
	return success
}

/**
 * Broadcasts a message to all connected clients of all users.
 * @param {string} type
 * @param {any} data
 */
export function sendEventToAll(type, data) {
	console.log(`[Notify] Broadcasting message of type '${type}' to all users.`)
	let anySent = false
	for (const connections of userConnections.values())
		if (sendMessageToConnections(connections, type, data))
			anySent = true

	if (!anySent)
		console.log('[Notify] No active connections found to broadcast to.')
}


/**
 * Sends a notification to all connected clients for a specific user.
 * @param {string} username - The username to notify.
 * @param {string} title - The notification title.
 * @param {NotificationOptions} options - The notification options.
 * @param {string | null} targetUrl
 */
export function sendNotification(username, title, options, targetUrl = null) {
	return sendEventToUser(username, 'notification', { title, options, targetUrl })
}
