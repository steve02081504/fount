import { logicalEntityHash } from 'https://esm.sh/@steve02081504/fount-p2p/core/logical_entity'

/** 群 subject 前缀（logical entity 命名空间）。 */
export const GROUP_SUBJECT_PREFIX = 'fount:chat:group:'

/**
 * @param {string} groupId 群 ID
 * @returns {string} 128 位 groupEntityHash
 */
export function groupEntityHash(groupId) {
	if (!groupId) throw new Error('groupId required')
	return logicalEntityHash(`${GROUP_SUBJECT_PREFIX}${groupId}`)
}
