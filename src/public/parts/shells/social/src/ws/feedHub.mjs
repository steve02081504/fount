/** @type {Map<string, Set<import('npm:ws').WebSocket>>} */
const feedSockets = new Map()

/**
 * 注册用户的 feed WebSocket 连接。
 * @param {string} username 用户
 * @param {import('npm:ws').WebSocket} socket WS
 * @returns {void}
 */
export function registerFeedSocket(username, socket) {
	const set = feedSockets.get(username) ?? new Set()
	set.add(socket)
	feedSockets.set(username, set)
	socket.on('close', () => {
		set.delete(socket)
		if (!set.size) feedSockets.delete(username)
	})
}

/**
 * 向已连接的 feed WebSocket 推送更新。
 * @param {string} username 用户
 * @param {object} payload 推送载荷
 * @returns {void}
 */
export function pushFeedUpdate(username, payload) {
	const set = feedSockets.get(username)
	if (!set) return
	const text = JSON.stringify(payload)
	for (const socket of set)
		if (socket.readyState === 1)
			socket.send(text)

}
