/** 浏览器端 group entityHash（与 `scripts/p2p/entity/group_entity.mjs` 算法一致）。 */
import { sha256TextHex } from '/scripts/digest.mjs'

import { encodeEntityHash } from './entityId.mjs'

const GROUP_SUBJECT_PREFIX = 'fount:chat:group:'

/** 逻辑群实体 sentinel nodeHash（非物理节点绑定） */
export const GROUP_SENTINEL_NODE_HASH = '0'.repeat(64)

/**
 * @param {string} groupId 群 ID
 * @returns {Promise<string>} 128 位 groupEntityHash
 */
export async function groupEntityHash(groupId) {
	const id = String(groupId || '').trim()
	if (!id) throw new Error('groupId required')
	return encodeEntityHash(GROUP_SENTINEL_NODE_HASH, await sha256TextHex(`${GROUP_SUBJECT_PREFIX}${id}`))
}
