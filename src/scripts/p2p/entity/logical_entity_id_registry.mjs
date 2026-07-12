/** @type {Map<string, (username: string, entityHash: string) => Promise<string | null>>} */
const resolversByOwner = new Map()

/**
 * @param {string} ownerId 注册方
 * @param {(username: string, entityHash: string) => Promise<string | null>} resolver logical entity id 反查
 * @returns {void}
 */
export function registerLogicalEntityIdResolver(ownerId, resolver) {
	resolversByOwner.set(String(ownerId), resolver)
}

/**
 * @param {string} ownerId 注册方
 * @returns {void}
 */
export function unregisterLogicalEntityIdResolver(ownerId) {
	resolversByOwner.delete(String(ownerId))
}

/** @returns {void} */
export function clearLogicalEntityIdRegistry() {
	resolversByOwner.clear()
}

/**
 * @param {string} username replica
 * @param {string} entityHash 128 hex logical entity
 * @returns {Promise<string | null>} 逻辑实体 id
 */
export async function resolveLogicalEntityId(username, entityHash) {
	for (const resolver of resolversByOwner.values())
		try {
			const id = await resolver(username, entityHash)
			if (id) return id
		}
		catch { /* next */ }

	return null
}
