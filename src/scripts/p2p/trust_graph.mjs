/**
 * Trust graph 公共入口：图构建与 Top-K 选取见 trust_graph_build；定向/扇出发送见 trust_graph_send。
 */
export { buildMergedGraph, pickTopNodes } from './trust_graph_build.mjs'
/**
 *
 */
export { sendToNode, fanoutToTopNodes } from './trust_graph_send.mjs'

import { buildMergedGraph, pickTopNodes } from './trust_graph_build.mjs'
import { fanoutToTopNodes, sendToNode } from './trust_graph_send.mjs'

/**
 * @returns {import('./trust_graph_registry.mjs').TrustGraphProvider} 默认 trust graph 实现
 */
export function createDefaultTrustGraphProvider() {
	return {
		buildMergedGraph,
		pickTopNodes,
		sendToNode,
		fanoutToTopNodes,
	}
}
