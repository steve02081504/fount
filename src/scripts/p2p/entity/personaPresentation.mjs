import { getUserByUsername } from '../../../server/auth.mjs'
import { getAnyDefaultPart, getPartDetails } from '../../../server/parts_loader.mjs'

/** 无自定义头像时的默认用户图 */
export const DEFAULT_USER_AVATAR = 'https://api.iconify.design/line-md/person.svg'

/**
 * @param {string} displayName 展示名
 * @param {{ subjectHash?: string }} profile 资料对象
 * @returns {boolean} 是否为 entityHash 占位短名
 */
export function isPlaceholderDisplayName(displayName, profile) {
	const name = String(displayName || '').trim()
	if (!name) return true
	const subjectHash = String(profile?.subjectHash || '').trim().toLowerCase()
	if (!subjectHash || subjectHash.length < 12) return false
	const placeholder = `${subjectHash.slice(0, 8)}…${subjectHash.slice(-4)}`
	return name === placeholder
}

/**
 * @param {string} replicaUsername replica 登录名
 * @param {string} [groupId] 群 ID
 * @returns {Promise<string | null>} 人格部件名
 */
export async function resolvePersonanameForReplica(replicaUsername, groupId) {
	if (groupId) {
		const { getMaterializedSession } = await import('./session_snapshot_registry.mjs')
		try {
			const session = await getMaterializedSession(replicaUsername, groupId)
			const fromSession = session.personas?.[replicaUsername]
			if (fromSession) return fromSession
		}
		catch {
			// 群尚未物化时回退默认人格
		}
	}

	return getAnyDefaultPart(replicaUsername, 'personas') || null
}

/**
 * @param {string} replicaUsername replica 登录名
 * @param {string} [groupId] 群 ID
 * @returns {Promise<{ displayName: string, avatar: string }>} 展示名与头像 URL
 */
export async function resolvePersonaPresentation(replicaUsername, groupId) {
	const loginName = getUserByUsername(replicaUsername)?.username || replicaUsername
	const personaname = await resolvePersonanameForReplica(replicaUsername, groupId)
	let personaName = ''
	let personaAvatar = ''
	if (personaname) {
		const { info } = await getPartDetails(replicaUsername, `personas/${personaname}`).catch(() => ({})) || {}
		personaName = String(info?.name || '').trim()
		personaAvatar = String(info?.avatar || '').trim()
	}
	return {
		displayName: personaName || loginName,
		avatar: personaAvatar || DEFAULT_USER_AVATAR,
	}
}
