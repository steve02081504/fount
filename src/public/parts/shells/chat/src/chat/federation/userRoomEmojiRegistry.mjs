import { registerNodeScopeWireHook } from 'npm:@steve02081504/fount-p2p/transport/node_scope'

import { attachUserRoomEmojiHandlers } from './groupEmojiFederation.mjs'

/** @type {(() => void) | null} */
let unregisterHook = null

/** @returns {void} */
export function registerChatUserRoomEmojiHandlers() {
	if (unregisterHook) return
	unregisterHook = registerNodeScopeWireHook((context, wire) => {
		attachUserRoomEmojiHandlers(context.replicaUsername, wire)
	})
}

/** @returns {void} */
export function unregisterChatUserRoomEmojiHandlers() {
	unregisterHook?.()
	unregisterHook = null
}
