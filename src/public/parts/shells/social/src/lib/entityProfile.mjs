import { isEntityHash128 } from 'npm:@steve02081504/fount-p2p/core/entity_id'

import { computeEffectiveStatus, getProfile } from '../../../chat/src/entity/profile.mjs'
import { resolveOperatorEntityHashForUser } from '../../../chat/src/entity/identity.mjs'

/**
 * @param {string} username replica 用户名
 * @param {string} entityHash 128 位实体 hash
 * @returns {Promise<object | null>} 实体 profile（含 effectiveStatus）
 */
export async function getEntityProfile(username, entityHash) {
	if (!isEntityHash128(entityHash)) return null
	const profile = await getProfile(entityHash, username)
	if (!profile) return null
	const operator = await resolveOperatorEntityHashForUser(username).catch(() => null)
	const isSelf = !!operator && entityHash === operator
	profile.effectiveStatus = computeEffectiveStatus(profile, operator, { isSelf })
	return profile
}
