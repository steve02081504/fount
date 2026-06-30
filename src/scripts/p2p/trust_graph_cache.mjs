/** @type {{ graph: Map<string, object>, builtAt: number, revision: number } | null} */
let cache = null
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
	cache = null
	revision++
}

/**
 * @param {() => Promise<Map<string, object>>} build 构建函数
 * @param {number} [ttlMs=30000] TTL
 * @returns {Promise<Map<string, object>>} 合并后的信任图
 */
export async function getCachedTrustGraph(build, ttlMs = DEFAULT_TTL_MS) {
	const now = Date.now()
	if (cache && cache.revision === revision && now - cache.builtAt < ttlMs)
		return cache.graph

	const graph = await build()
	cache = { graph, builtAt: now, revision }
	return graph
}

/** @returns {void} 测试用 */
export function clearTrustGraphCache() {
	cache = null
	revision = 0
}
