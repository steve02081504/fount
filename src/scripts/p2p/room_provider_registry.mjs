/**
 * 联邦房间 Provider 注册表：P2P 层通过 Provider 获取群房间，不 import Chat Shell。
 */

/**
 * @typedef {{
 *   groupId: string
 *   getRoster: () => Array<{ peerId: string, remoteNodeHash?: string }>
 *   getPeerIdByNodeHash: (nodeHash: string) => string | null
 *   sendToPeer: (peerId: string, actionName: string, payload: unknown) => void
 *   pickFallbackPeerIds?: (selfNodeHash: string) => Promise<string[]>
 * }} FederationRoomSlot
 */

/** @type {Map<string, (username: string) => FederationRoomSlot[] | Promise<FederationRoomSlot[]>>} */
const providers = new Map()

/**
 * @param {string} ownerId 注册方（如 chat）
 * @param {(username: string) => FederationRoomSlot[] | Promise<FederationRoomSlot[]>} enumerateRooms 枚举活跃房间
 * @returns {void}
 */
export function registerFederationRoomProvider(ownerId, enumerateRooms) {
	providers.set(String(ownerId), enumerateRooms)
}

/**
 * @param {string} ownerId 注册方
 * @returns {void}
 */
export function unregisterFederationRoomProvider(ownerId) {
	providers.delete(String(ownerId))
}

/**
 * @param {string} username replica 登录名
 * @returns {Promise<FederationRoomSlot[]>} 所有 Provider 提供的活跃 sync 房间
 */
export async function listFederationRoomSlots(username) {
	/** @type {FederationRoomSlot[]} */
	const slots = []
	for (const enumerate of providers.values()) {
		const batch = await enumerate(username)
		if (batch?.length) slots.push(...batch)
	}
	return slots
}
