/** @type {Map<string, (replicaUsername: string, groupId: string) => Promise<object | null>>} */
const providersByOwner = new Map()

/**
 * @param {string} ownerId 注册方
 * @param {(replicaUsername: string, groupId: string) => Promise<object | null>} provider 物化会话
 * @returns {void}
 */
export function registerMaterializedSessionProvider(ownerId, provider) {
	providersByOwner.set(String(ownerId), provider)
}

/**
 * @param {string} ownerId 注册方
 * @returns {void}
 */
export function unregisterMaterializedSessionProvider(ownerId) {
	providersByOwner.delete(String(ownerId))
}

/**
 * @param {string} replicaUsername replica
 * @param {string} groupId 群 ID
 * @returns {Promise<object | null>} 物化会话
 */
export async function getMaterializedSession(replicaUsername, groupId) {
	const provider = providersByOwner.values().next().value
	if (!provider) return null
	return provider(replicaUsername, groupId)
}
