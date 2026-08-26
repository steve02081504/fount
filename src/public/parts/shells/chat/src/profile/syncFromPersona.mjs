/**
 * 群 persona 变更后同步 entity profile（Chat 专用）。
 */
import { localesForUser } from '../../../../../../scripts/locale.mjs'
import { getGroupMemberEntityHash, isWritableLocalEntity } from '../chat/lib/replica.mjs'
import {
	getInfoDefaultsForEntity,
	isPlaceholderDisplayName,
	normalizeLocalizedMap,
	resolvePersonaPresentation,
} from '../entity/presentation.mjs'
import {
	getProfile,
	updateProfile,
} from '../entity/profile.mjs'

/**
 * @param {string} replicaUsername replica 登录名
 * @param {string} groupId 群 ID
 * @param {string} [entityHash] 同步目标实体；缺省按 operator（`getGroupMemberEntityHash`）
 * @returns {Promise<void>}
 */
export async function syncEntityProfileFromPersona(replicaUsername, groupId, entityHash) {
	const targetEntityHash = entityHash ?? await getGroupMemberEntityHash(replicaUsername, groupId)
	if (!isWritableLocalEntity(targetEntityHash)) return
	try {
		const locales = localesForUser(replicaUsername)
		const presentation = await resolvePersonaPresentation(replicaUsername, groupId)
		const infoDefaults = await getInfoDefaultsForEntity(replicaUsername, targetEntityHash, locales)
		const profile = await getProfile(targetEntityHash, replicaUsername, { groupId, skipPresentation: true })
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
			await updateProfile(replicaUsername, targetEntityHash, { localized }, { groupId, skipPresentation: true })
		}
	}
	catch (error) {
		if (String(error?.message || '').includes('no users')) return
		throw error
	}
}
