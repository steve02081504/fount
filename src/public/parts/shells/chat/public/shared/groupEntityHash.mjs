import { logicalEntityHash } from 'npm:@steve02081504/fount-p2p/entity/logical_entity'

export const GROUP_SUBJECT_PREFIX = 'fount:chat:group:'

/**
 * @param {string} groupId 群 ID
 * @returns {string} 128 位 groupEntityHash
 */
export function groupEntityHash(groupId) {
	const id = String(groupId).trim()
	if (!id) throw new Error('groupId required')
	return logicalEntityHash(`${GROUP_SUBJECT_PREFIX}${id}`)
}
