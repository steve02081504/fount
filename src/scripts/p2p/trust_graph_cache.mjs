/** @type {Map<string, { graph: Map<string, object>, builtAt: number, revision: number }>} */
const cache = new Map()

/** @type {Map<string, number>} username → revision counter */
const revisions = new Map()

const DEFAULT_TTL_MS = 30_000

/**
 * @param {string} username 用户
 * @returns {number} 当前 revision
 */
export function getTrustGraphRevision(username) {
	return revisions.get(username) || 0
}

/**
 * @param {string} username 用户
 * @returns {void}
 */
export function invalidateTrustGraphCache(username) {
	cache.delete(username)
	revisions.set(username, (revisions.get(username) || 0) + 1)
}

/**
 * @param {string} username 用户
 * @param {() => Promise<Map<string, object>>} build 构建函数
 * @param {number} [ttlMs=30000] TTL
 * @returns {Promise<Map<string, object>>} 合并后的信任图
 */
export async function getCachedTrustGraph(username, build, ttlMs = DEFAULT_TTL_MS) {
	const revision = getTrustGraphRevision(username)
	const now = Date.now()
	const hit = cache.get(username)
	if (hit && hit.revision === revision && now - hit.builtAt < ttlMs)
		return hit.graph

	const graph = await build()
	cache.set(username, { graph, builtAt: now, revision })
	return graph
}

/** @returns {void} 测试用 */
export function clearTrustGraphCache() {
	cache.clear()
	revisions.clear()
}
