/**
 * 用户在线状态追踪（基于活动时间戳的轻量级 in-memory 模块）
 *
 * 状态判定规则（动态、运行时计算）：
 *   - online : 距离最近活动时间 ≤ 60 秒
 *   - idle   : 60 秒 < 距离最近活动时间 ≤ 5 分钟
 *   - offline: 距离最近活动时间 > 5 分钟，或从未记录过
 *
 * 活动来源：
 *   - 任何经过认证的 HTTP 请求（含 WebSocket 鉴权握手）会在响应结束后调用 markActive
 *   - 客户端可主动调用 /api/presence/ping 心跳（每 30s 一次）保持在线
 */

const ONLINE_THRESHOLD_MS = 60 * 1000          // 60s 内为在线
const IDLE_THRESHOLD_MS = 5 * 60 * 1000        // 5min 内为挂起，超过即离线

// username -> last active timestamp (ms)
const activityMap = new Map()

/**
 * 标记用户处于活动状态。
 * @param {string} username
 */
export function markActive(username) {
	if (!username || typeof username !== 'string') return
	activityMap.set(username, Date.now())
}

/**
 * 计算用户的当前状态。
 * @param {string} username
 * @returns {'online'|'idle'|'offline'}
 */
export function getStatus(username) {
	if (!username) return 'offline'
	const ts = activityMap.get(username)
	if (!ts) return 'offline'
	const delta = Date.now() - ts
	if (delta <= ONLINE_THRESHOLD_MS) return 'online'
	if (delta <= IDLE_THRESHOLD_MS) return 'idle'
	return 'offline'
}

/**
 * 批量获取用户状态。
 * @param {string[]} usernames
 * @returns {Record<string, {status:'online'|'idle'|'offline', lastActive:number|null}>}
 */
export function getBulkStatus(usernames) {
	const result = {}
	for (const u of usernames || []) {
		const ts = activityMap.get(u) || null
		result[u] = { status: getStatus(u), lastActive: ts }
	}
	return result
}

/**
 * 周期性清理超过 1 小时未活动的条目，避免 Map 无限增长。
 */
setInterval(() => {
	const cutoff = Date.now() - 60 * 60 * 1000
	for (const [u, ts] of activityMap) if (ts < cutoff) activityMap.delete(u)
}, 10 * 60 * 1000).unref?.()
