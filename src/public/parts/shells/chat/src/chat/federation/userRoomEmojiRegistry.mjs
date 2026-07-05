import { registerUserRoomNodeScopeHook } from '../../../../../../../scripts/p2p/user_room.mjs'

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
