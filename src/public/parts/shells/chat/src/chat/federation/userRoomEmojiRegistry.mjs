import { registerUserRoomNodeScopeHook } from 'npm:@steve02081504/fount-p2p/transport/user_room'

import { attachUserRoomEmojiHandlers } from './groupEmojiFederation.mjs'

/** @type {(() => void) | null} */
let unregisterHook = null

/** @returns {void} */
export function registerChatUserRoomEmojiHandlers() {
	if (unregisterHook) return
	unregisterHook = registerUserRoomNodeScopeHook(attachUserRoomEmojiHandlers)
}

/** @returns {void} */
export function unregisterChatUserRoomEmojiHandlers() {
	unregisterHook?.()
	unregisterHook = null
}
