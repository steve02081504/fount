import { registerNodeScopeWireHook } from 'npm:@steve02081504/fount-p2p/transport/node_scope/wire'

import { attachUserRoomDiscoveryHandlers } from './discoveryRelay.mjs'

/** @type {(() => void) | null} */
let unregisterHook = null

/**
 * 在 node scope 注册 user-room 群发现 query / response 处理器。
 * @returns {void}
 */
export function registerChatUserRoomDiscoveryHandlers() {
	if (unregisterHook) return
	unregisterHook = registerNodeScopeWireHook((context, wire) => {
		attachUserRoomDiscoveryHandlers(context.replicaUsername, wire)
	})
}

/**
 * 注销 user-room 群发现处理器。
 * @returns {void}
 */
export function unregisterChatUserRoomDiscoveryHandlers() {
	unregisterHook?.()
	unregisterHook = null
}
