import { initNode } from 'npm:@steve02081504/fount-p2p/node/instance'
import {
	createDefaultTrustGraphProvider,
	DEFAULT_TRUST_GRAPH_OWNER,
	registerTrustGraphProvider,
} from 'npm:@steve02081504/fount-p2p/trust_graph/registry'

/**
 * 测试/headless 最小 P2P node 初始化。
 * @param {Parameters<typeof initNode>[0]} options initNode 选项
 * @returns {ReturnType<typeof initNode>} 节点运行时
 */
export function initTestP2pNode(options) {
	const runtime = initNode(options)
	registerTrustGraphProvider(DEFAULT_TRUST_GRAPH_OWNER, createDefaultTrustGraphProvider())
	return runtime
}
