/**
 * 表情包可用性：已加入群包 ∪ 本机实体作者包（关注可用性由 social 扩展）。
 */
import { findPackAcrossEntities } from './entity/entityEmojis.mjs'
import { findPackAcrossGroups } from './group/groupEmojis.mjs'

/**
 * @param {string} username 用户名
 * @param {string} packId 表情包 ID
 * @returns {Promise<boolean>} 是否可用
 */
export async function isPackAvailableToUser(username, packId) {
	const pid = String(packId || '').trim()
	if (!pid) return false
	if (await findPackAcrossGroups(username, pid)) return true
	const entityHost = await findPackAcrossEntities(pid)
	if (entityHost?.replicaUsername === username) return true
	try {
		const { isEntityPackAvailableToUser } = await import('../../../social/src/emojiPacks.mjs')
		return await isEntityPackAvailableToUser(username, pid)
	}
	catch {
		return false
	}
}
