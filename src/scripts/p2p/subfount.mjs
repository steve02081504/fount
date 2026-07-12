import { startNode } from './index.mjs'

export { createScopedLinkRoom } from './rooms/scoped_link.mjs'

/**
 * 独立 subfount 客户端最小 bootstrap：节点目录 + 身份 + discovery runtime。
 * @param {{ nodeDir: string, entityStore?: import('./entity_store.mjs').EntityStore, logger?: object, signaling?: import('./node/signaling_config.mjs').SignalingRuntimeConfig }} options
 * @returns {Promise<void>}
 */
export async function initSubfountP2p(options) {
	await startNode(options)
}
