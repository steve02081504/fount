import { console } from '../../scripts/i18n.mjs'

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

	userConnections.get(username).add(ws)
	console.log(`[Notify] WebSocket connection registered for user: ${username}. Total connections: ${userConnections.get(username).size}`)

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
		console.log(`[Notify] WebSocket connection unregistered for user: ${username}. Remaining connections: ${connections.size}`)
		if (connections.size === 0) {
			userConnections.delete(username)
			console.log(`[Notify] No more connections for user: ${username}. Deleting user entry.`)
		}
	}
}

/**
 * Sends a notification to all connected clients for a specific user.
 * @param {string} username - The username to notify.
 * @param {string} title - The notification title.
 * @param {NotificationOptions} options - The notification options.
 */
export function sendNotification(username, title, options) {
	const connections = userConnections.get(username)
	if (connections && connections.size > 0) {
		const payload = JSON.stringify({ title, options })
		console.log(`[Notify] Broadcasting notification to ${connections.size} clients for user: ${username}`)
		for (const ws of connections)
			if (ws.readyState === ws.OPEN)
				ws.send(payload)
		return true
	}
	console.log(`[Notify] No active connections found for user: ${username}`)
	return false
}
