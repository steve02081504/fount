import { isEntityHash128 } from 'npm:@steve02081504/fount-p2p/core/entity_id'

import { getProfile } from '../../../chat/src/entity/profile.mjs'

/**
 * @param {string} username replica 用户名
 * @param {string} entityHash 128 位实体 hash
 * @returns {Promise<object | null>} 实体 profile
 */
export async function getEntityProfile(username, entityHash) {
	if (!isEntityHash128(entityHash)) return null
	return getProfile(entityHash, username)
}
