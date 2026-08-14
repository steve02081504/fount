const sessions = new Map()
const TTL_MS = 15 * 60 * 1000

/**
 * 丢掉一条 pending 登录并释放 hook / 轮询。
 * @param {string} state - OAuth state。
 * @returns {void}
 */
function forget(state) {
	const session = sessions.get(state)
	if (!session) return
	clearTimeout(session.expireTimer)
	session.hook?.close?.()
	session.abort?.abort()
	sessions.delete(state)
}

/**
 * 丢掉已过期的 pending 登录。
 * @returns {void}
 */
export function sweepExpired() {
	const now = Date.now()
	for (const [state, session] of sessions)
		if (now - session.createdAt > TTL_MS)
			forget(state)
}

/**
 * 登记一次 pending 登录。
 * @param {string} state - OAuth state。
 * @param {object} session - 会话字段。
 * @returns {object} 登记后的会话。
 */
export function putPending(state, session) {
	sweepExpired()
	const record = { ...session, createdAt: Date.now(), status: 'pending' }
	sessions.set(state, record)
	record.expireTimer = setTimeout(() => forget(state), TTL_MS)
	if (typeof record.expireTimer === 'number')
		globalThis.Deno?.unrefTimer?.(record.expireTimer)
	else
		record.expireTimer.unref?.()
	return record
}

/**
 * 读取 pending 登录。
 * @param {string} state - OAuth state。
 * @returns {object | undefined} 会话。
 */
export function getPending(state) {
	sweepExpired()
	return sessions.get(state)
}

/**
 * 删除 pending 登录并关闭 hook。
 * @param {string} state - OAuth state。
 * @returns {void}
 */
export function deletePending(state) {
	forget(state)
}
