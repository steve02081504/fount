import { initNode } from '../../node/instance.mjs'
import {
	createDefaultTrustGraphProvider,
	DEFAULT_TRUST_GRAPH_OWNER,
	registerTrustGraphProvider,
} from '../../trust_graph_registry.mjs'

/**
 * 测试/headless 最小 node 初始化：initNode + 默认 trust graph provider。
 * @param {Parameters<typeof initNode>[0]} options initNode 选项
 * @returns {ReturnType<typeof initNode>} 节点运行时
 */
export function initTestP2pNode(options) {
	const runtime = initNode(options)
	registerTrustGraphProvider(DEFAULT_TRUST_GRAPH_OWNER, createDefaultTrustGraphProvider())
	return runtime
}
