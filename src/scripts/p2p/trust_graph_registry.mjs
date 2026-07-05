import { buildMergedGraph, pickTopNodes } from './trust_graph_build.mjs'
import { fanoutToTopNodes, sendToNode } from './trust_graph_send.mjs'

/** @type {Map<string, import('./trust_graph_registry.mjs').TrustGraphProvider>} */
const providersByOwner = new Map()

/** 用户级 P2P trust graph（registerTrustGraphProvider 注册） */
export const DEFAULT_TRUST_GRAPH_OWNER = 'default'

/**
 * @param {string} ownerId 注册方（如 chat）
 * @param {import('./trust_graph_registry.mjs').TrustGraphProvider} impl 信任图实现
 * @returns {void}
 */
export function registerTrustGraphProvider(ownerId, impl) {
	providersByOwner.set(String(ownerId), impl)
}

/**
 * @param {string} ownerId 注册方
 * @returns {void}
 */
export function unregisterTrustGraphProvider(ownerId) {
	providersByOwner.delete(String(ownerId))
}

/** @returns {void} */
export function clearTrustGraphProvider() {
	providersByOwner.clear()
}

/**
 * @param {string} [ownerId=DEFAULT_TRUST_GRAPH_OWNER] 注册方 ID
 * @returns {import('./trust_graph_registry.mjs').TrustGraphProvider} 已注册实现
 */
export function requireTrustGraphProvider(ownerId = DEFAULT_TRUST_GRAPH_OWNER) {
	const impl = providersByOwner.get(String(ownerId))
	if (!impl)
		throw new Error(`p2p: registerTrustGraphProvider('${ownerId}') must run before trust graph fanout`)
	return impl
}

/** @returns {import('./trust_graph_registry.mjs').TrustGraphProvider} 默认 trust graph 实现 */
export function createDefaultTrustGraphProvider() {
	return { buildMergedGraph, pickTopNodes, sendToNode, fanoutToTopNodes }
}
