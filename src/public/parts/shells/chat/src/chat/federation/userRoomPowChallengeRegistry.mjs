import { registerNodeScopeWireHook } from 'npm:@steve02081504/fount-p2p/transport/node_scope/wire'

import { attachUserRoomPowChallengeHandlers } from './powChallengeFederation.mjs'

/** @type {(() => void) | null} */
let unregisterHook = null

/** @returns {void} */
export function registerChatUserRoomPowChallengeHandlers() {
	if (unregisterHook) return
	unregisterHook = registerNodeScopeWireHook((context, wire) => {
		attachUserRoomPowChallengeHandlers(context.replicaUsername, wire)
	})
}

/** @returns {void} */
export function unregisterChatUserRoomPowChallengeHandlers() {
	unregisterHook?.()
	unregisterHook = null
}
