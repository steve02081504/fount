/**
 * 表情包可用性：已加入群包 ∪ 本机实体作者包（关注侧由 social 注册 checker 扩展）。
 */
import { findPackAcrossEntities } from './entity/entityEmojis.mjs'
import { findPackAcrossGroups } from './group/groupEmojis.mjs'

/** @type {((username: string, packId: string) => Promise<boolean>)[]} */
const entityPackCheckers = []

/**
 * @param {(username: string, packId: string) => Promise<boolean>} checker 作者包可用性探针
 * @returns {void}
 */
export function registerEntityPackAvailabilityChecker(checker) {
	entityPackCheckers.push(checker)
}

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
	for (const checker of entityPackCheckers)
		if (await checker(username, pid)) return true
	return false
}
