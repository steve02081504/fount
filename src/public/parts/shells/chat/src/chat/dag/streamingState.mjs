/**
 * 【文件】`dag/streamingState.mjs` — 流媒体频道会话进程内缓存。
 * 【职责】记录各群频道当前 SFU/流式会话 id、过期时间与发起者 pubKeyHash；供鉴权与 UI 查询。
 * 【原理】不落 DAG，仅用 `groupId:channelId` 键的 Map；过期条目在读取时惰性删除。
 * 【数据结构】`{ sessionId, expiresAt, by }` 存于模块级 `sessions` Map。
 * 【关联】`channelOperations.mjs`（`appendStreamingSession` / `setStreamingSession`）。
 */
/** @type {Map<string, { sessionId: string, expiresAt: number, by: string }>} */
const sessions = new Map()

/**
 * @param {string} groupId 群 ID
 * @param {string} channelId 频道 ID
 * @returns {string} 会话键
 */
function sessionKey(groupId, channelId) {
	return `${groupId}:${channelId}`
}

/**
 * @param {string} groupId 群 ID
 * @param {string} channelId 频道 ID
 * @param {{ sessionId: string, expiresAt: number, by?: string }} session 会话元数据
 * @returns {void}
 */
export function setStreamingSession(groupId, channelId, session) {
	sessions.set(sessionKey(groupId, channelId), {
		sessionId: session.sessionId,
		expiresAt: session.expiresAt,
		by: String(session.by || '').trim(),
	})
}

/**
 * @param {string} groupId 群 ID
 * @param {string} channelId 频道 ID
 * @returns {{ sessionId: string, expiresAt: number, by: string } | null} 当前会话或 null
 */
export function getStreamingSession(groupId, channelId) {
	const row = sessions.get(sessionKey(groupId, channelId))
	if (!row) return null
	if (Number(row.expiresAt) < Date.now()) {
		sessions.delete(sessionKey(groupId, channelId))
		return null
	}
	return row
}
