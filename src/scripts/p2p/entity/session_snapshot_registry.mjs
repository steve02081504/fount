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
 * @param {string} [ownerId] 注册方 id；省略时遍历所有 provider
 * @returns {Promise<object | null>} 物化会话
 */
export async function getMaterializedSession(replicaUsername, groupId, ownerId) {
	if (ownerId != null) {
		const provider = providersByOwner.get(String(ownerId))
		if (!provider) return null
		return provider(replicaUsername, groupId)
	}
	for (const provider of providersByOwner.values()) {
		const session = await provider(replicaUsername, groupId)
		if (session) return session
	}
	return null
}
