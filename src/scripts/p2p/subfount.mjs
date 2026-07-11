import { ensureNodeDefaults } from './node/identity.mjs'
import { initNode, isNodeInitialized } from './node/instance.mjs'
import { getLinkRegistry } from './link_registry.mjs'
import { createScopedLinkRoom } from './rooms/scoped_link.mjs'

export { createScopedLinkRoom }

/**
 * 独立 subfount 客户端最小 bootstrap：节点目录 + 身份 + discovery runtime。
 * @param {{ nodeDir: string, entityStore?: import('./entity_store.mjs').EntityStore, logger?: object, signaling?: import('./node/signaling_config.mjs').SignalingRuntimeConfig }} options
 * @returns {Promise<void>}
 */
export async function initSubfountP2p(options) {
	if (!isNodeInitialized())
		initNode(options)
	ensureNodeDefaults()
	await getLinkRegistry().ensureRuntime()
}
