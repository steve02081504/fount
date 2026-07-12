/**
 * 联邦 P2P 精简门面：常用 bootstrap 与房间/发现入口。
 * 重子系统仍从子路径直接 import（如 `./dag/index.mjs`）。
 */
import { registerDiscoveryProvider } from './discovery/index.mjs'
import { createGroupLinkSet } from './group_link_set.mjs'
import { getLinkRegistry } from './link_registry.mjs'
import { ensureNodeDefaults, getNodeHash } from './node/identity.mjs'
import { getNodeDir, initNode, isNodeInitialized } from './node/instance.mjs'
import { createScopedLinkRoom } from './rooms/scoped_link.mjs'
import { ensureUserRoom } from './user_room.mjs'

export {
	createGroupLinkSet,
	createScopedLinkRoom,
	ensureNodeDefaults,
	ensureUserRoom,
	getLinkRegistry,
	getNodeDir,
	getNodeHash,
	initNode,
	isNodeInitialized,
	registerDiscoveryProvider,
}

/**
 * @param {{ nodeDir: string, entityStore?: import('./entity_store.mjs').EntityStore, logger?: object, signaling?: import('./node/signaling_config.mjs').SignalingRuntimeConfig }} options
 * @returns {Promise<void>}
 */
export async function startNode(options) {
	if (!isNodeInitialized())
		initNode(options)
	ensureNodeDefaults()
	await getLinkRegistry().ensureRuntime()
}
