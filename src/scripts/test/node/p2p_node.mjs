import {
	initNode,
	setNodeLogger,
	setSignalingRuntimeConfig,
} from 'npm:@steve02081504/fount-p2p/node/instance'
import {
	createDefaultTrustGraphProvider,
	DEFAULT_TRUST_GRAPH_OWNER,
	registerTrustGraphProvider,
} from 'npm:@steve02081504/fount-p2p/trust_graph/registry'

/**
 * 测试/headless 最小 P2P node 初始化。
 * @param {{
 *   nodeDir: string,
 *   entityStore?: import('npm:@steve02081504/fount-p2p/node/entity_store').EntityStore,
 *   signaling?: import('npm:@steve02081504/fount-p2p/node/signaling_config').SignalingRuntimeConfig,
 *   logger?: object | null,
 * }} options init 选项（signaling / logger 经专用 setter，不再塞进 initNode）
 * @returns {ReturnType<typeof initNode>} 节点运行时
 */
export function initTestP2pNode(options = {}) {
	const { nodeDir, entityStore, signaling, logger, ...rest } = options
	if (Object.keys(rest).length)
		throw new Error(`initTestP2pNode: unknown options ${Object.keys(rest).join(',')}`)
	const runtime = initNode({ nodeDir, entityStore })
	if (signaling !== undefined) setSignalingRuntimeConfig(signaling)
	if (logger !== undefined) setNodeLogger(logger)
	registerTrustGraphProvider(DEFAULT_TRUST_GRAPH_OWNER, createDefaultTrustGraphProvider())
	return runtime
}
