/** @type {Map<string, { graph: Map<string, object>, builtAt: number, revision: number }>} */
const cacheByUsername = new Map()
let revision = 0

const DEFAULT_TTL_MS = 30_000

/**
 * @returns {number} 当前 revision
 */
export function getTrustGraphRevision() {
	return revision
}

/**
 * @returns {void}
 */
export function invalidateTrustGraphCache() {
	cacheByUsername.clear()
	revision++
}

/**
 * @param {string} username replica 登录名（缓存键，与 buildMergedGraph 一致）
 * @param {() => Promise<Map<string, object>>} build 构建函数
 * @param {number} [ttlMs=30000] TTL
 * @returns {Promise<Map<string, object>>} 合并后的信任图
 */
export async function getCachedTrustGraph(username, build, ttlMs = DEFAULT_TTL_MS) {
	const key = String(username || '')
	const now = Date.now()
	const cached = cacheByUsername.get(key)
	if (cached && cached.revision === revision && now - cached.builtAt < ttlMs)
		return cached.graph

	const graph = await build()
	cacheByUsername.set(key, { graph, builtAt: now, revision })
	return graph
}

/** @returns {void} 测试用 */
export function clearTrustGraphCache() {
	cacheByUsername.clear()
	revision = 0
}
