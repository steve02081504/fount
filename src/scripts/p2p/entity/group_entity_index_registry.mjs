/** @type {Map<string, (username: string, entityHash: string) => Promise<string | null>>} */
const resolversByOwner = new Map()

/**
 * @param {string} ownerId 注册方（如 chat）
 * @param {(username: string, entityHash: string) => Promise<string | null>} resolver groupId 反查
 * @returns {void}
 */
export function registerGroupIdResolver(ownerId, resolver) {
	resolversByOwner.set(String(ownerId), resolver)
}

/**
 * @param {string} ownerId 注册方
 * @returns {void}
 */
export function unregisterGroupIdResolver(ownerId) {
	resolversByOwner.delete(String(ownerId))
}

/** @returns {void} */
export function clearGroupEntityIndexRegistry() {
	resolversByOwner.clear()
}

/**
 * @param {string} username replica
 * @param {string} entityHash 128 hex group entity
 * @returns {Promise<string | null>} groupId
 */
export async function resolveGroupIdFromEntityHash(username, entityHash) {
	for (const resolver of resolversByOwner.values()) 
		try {
			const groupId = await resolver(username, entityHash)
			if (groupId) return groupId
		}
		catch { /* next */ }
	
	return null
}
