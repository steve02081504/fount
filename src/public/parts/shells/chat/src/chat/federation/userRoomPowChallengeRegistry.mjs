import { registerNodeScopeWireHook } from 'npm:@steve02081504/fount-p2p/transport/node_scope/wire'

import { attachUserRoomPowChallengeHandlers } from './powChallengeFederation.mjs'

/** @type {(() => void) | null} */
let unregisterHook = null

/**
 * 在 node scope 注册 user-room PoW challenge 处理器。
 * @returns {void}
 */
export function registerChatUserRoomPowChallengeHandlers() {
	if (unregisterHook) return
	unregisterHook = registerNodeScopeWireHook((context, wire) => {
		attachUserRoomPowChallengeHandlers(context.replicaUsername, wire)
	})
}

/**
 * 注销 user-room PoW challenge 处理器。
 * @returns {void}
 */
export function unregisterChatUserRoomPowChallengeHandlers() {
	unregisterHook?.()
	unregisterHook = null
}
