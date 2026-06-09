/** @type {Map<string, (replicaUsername: string, groupId: string) => Promise<string>>} */
const groupMemberEntityByOwner = new Map()

/**
 * @param {string} ownerId 注册方
 * @param {(replicaUsername: string, groupId: string) => Promise<string>} resolver 群成员 entityHash
 * @returns {void}
 */
export function registerGroupMemberEntityResolver(ownerId, resolver) {
	groupMemberEntityByOwner.set(String(ownerId), resolver)
}

/**
 * @param {string} ownerId 注册方
 * @returns {void}
 */
export function unregisterGroupMemberEntityResolver(ownerId) {
	groupMemberEntityByOwner.delete(String(ownerId))
}

/**
 * @param {string} replicaUsername replica
 * @param {string} groupId 群 ID
 * @returns {Promise<string | null>} entityHash；无注册方时 null
 */
export async function resolveGroupMemberEntityHash(replicaUsername, groupId) {
	for (const resolver of groupMemberEntityByOwner.values()) 
		try {
			const eh = await resolver(replicaUsername, groupId)
			if (eh) return eh
		}
		catch { /* next */ }
	
	return null
}
