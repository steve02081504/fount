const sessions = new Map()
const TTL_MS = 15 * 60 * 1000

/**
 * 丢掉过期的 pending 登录。
 * @returns {void}
 */
function sweep() {
	const now = Date.now()
	for (const [state, session] of sessions)
		if (now - session.createdAt > TTL_MS) {
			session.hook?.close?.()
			sessions.delete(state)
		}
}

/**
 * 登记一次 pending 登录。
 * @param {string} state - OAuth state。
 * @param {object} session - 会话字段。
 * @returns {object} 登记后的会话。
 */
export function putPending(state, session) {
	sweep()
	const record = { ...session, createdAt: Date.now(), status: 'pending' }
	sessions.set(state, record)
	return record
}

/**
 * 读取 pending 登录。
 * @param {string} state - OAuth state。
 * @returns {object | undefined} 会话。
 */
export function getPending(state) {
	sweep()
	return sessions.get(state)
}

/**
 * 删除 pending 登录并关闭 hook。
 * @param {string} state - OAuth state。
 * @returns {void}
 */
export function deletePending(state) {
	const session = sessions.get(state)
	session?.hook?.close?.()
	sessions.delete(state)
}
