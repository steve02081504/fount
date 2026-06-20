/**
 * 【文件】stream/groupWsRateLimit.mjs
 * 【职责】群 WebSocket 接入防护：按 IP 滑动窗口限流。
 * 【原理】checkWsRateLimit 维护 ipWsRequests 计数。
 * 【数据结构】ipWsRequests Map。
 * 【关联】session/wsLifecycle 握手。
 */

/** IP 限流：{ip} -> { count, resetAt } */
const ipWsRequests = new Map()
const IP_WS_WINDOW_MS = 60_000
const IP_WS_MAX = 60

/**
 * WS 升级前 IP 限流检查（每分钟最多 60 次）。
 * @param {string} ip 客户端 IP（可取 X-Forwarded-For 首段）
 * @returns {boolean} true=允许，false=拒绝
 */
export function checkWsRateLimit(ip) {
	const now = Date.now()
	let entry = ipWsRequests.get(ip)
	if (!entry || now > entry.resetAt) {
		entry = { count: 0, resetAt: now + IP_WS_WINDOW_MS }
		ipWsRequests.set(ip, entry)
	}
	entry.count++
	return entry.count <= IP_WS_MAX
}
