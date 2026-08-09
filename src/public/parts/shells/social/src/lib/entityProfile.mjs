import { isEntityHash128 } from 'npm:@steve02081504/fount-p2p/core/entity_id'

import { resolveOperatorEntityHashForUser } from '../../../chat/src/entity/identity.mjs'
import { computeEffectiveStatus, getProfile } from '../../../chat/src/entity/profile.mjs'

/**
 * 读取并返回实体资料（含当前查看者可见的 effectiveStatus）。
 * @param {string} username replica 用户名
 * @param {string} entityHash 128 位实体 hash
 * @returns {Promise<object | null>} 实体 profile（含 effectiveStatus）
 */
export async function getEntityProfile(username, entityHash) {
	if (!isEntityHash128(entityHash)) return null
	const profile = await getProfile(entityHash, username)
	let operator = null
	try {
		operator = await resolveOperatorEntityHashForUser(username)
	}
	catch { /* 无 operator 时保持 null */ }
	profile.effectiveStatus = computeEffectiveStatus(profile, operator)
	return profile
}
