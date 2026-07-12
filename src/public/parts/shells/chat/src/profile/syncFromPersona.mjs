/**
 * 群 persona 变更后同步 entity profile（Chat 专用）。
 */
import {
	getProfile,
	updateProfile,
} from 'npm:@steve02081504/fount-p2p/entity/profile'
import {
	getInfoDefaultsForEntity,
	isPlaceholderDisplayName,
	normalizeLocalizedMap,
	resolvePersonaPresentation,
} from '../../../../../../server/p2p_server/presentation.mjs'
import { getGroupMemberEntityHash, isWritableLocalEntity } from '../chat/lib/replica.mjs'

/**
 * @param {string} replicaUsername replica 登录名
 * @param {string} groupId 群 ID
 * @returns {Promise<void>}
 */
export async function syncEntityProfileFromPersona(replicaUsername, groupId) {
	const entityHash = await getGroupMemberEntityHash(replicaUsername, groupId)
	if (!isWritableLocalEntity(entityHash)) return
	try {
		const locales = ['zh-CN', 'en-UK']
		const presentation = await resolvePersonaPresentation(replicaUsername, groupId)
		const infoDefaults = await getInfoDefaultsForEntity(replicaUsername, entityHash, locales)
		const profile = await getProfile(entityHash, replicaUsername, { groupId, skipPresentation: true })
		const localized = normalizeLocalizedMap(profile.localized)
		const primary = locales[0]
		const slice = localized[primary] || {}
		let changed = false
		const next = { ...slice }
		if (!slice.name?.trim() || isPlaceholderDisplayName(slice.name.trim(), profile)) {
			next.name = presentation.displayName || infoDefaults.name
			changed = true
		}
		if (!slice.avatar?.trim()) {
			next.avatar = presentation.avatar || infoDefaults.avatar
			changed = true
		}
		if (changed) {
			localized[primary] = next
			await updateProfile(replicaUsername, entityHash, { localized }, { groupId, skipPresentation: true })
		}
	}
	catch (error) {
		if (String(error?.message || '').includes('no users')) return
		throw error
	}
}
