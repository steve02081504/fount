/**
 * 【文件】groupEntity.mjs
 * 【职责】群逻辑实体：哈希推导复用 shared；本文件保留 manifest/目录反查。
 */
import { isLogicalEntityHash } from 'npm:@steve02081504/fount-p2p/core/logical_entity'

import { resolveLogicalEntityId } from '../../entity/logicalId.mjs'

/**
 *
 */
export {
	GROUP_SUBJECT_PREFIX,
	groupEntityHash,
} from '../../../public/shared/groupEntityHash.mjs'

/**
 * @param {unknown} entityHash 128 hex
 * @returns {boolean} 是否为 group entity
 */
export function isGroupEntityHash(entityHash) {
	return isLogicalEntityHash(entityHash)
}

/**
 * @param {unknown} entityHash 128 hex
 * @param {string} [username] 可选；提供时在用户群目录反查 groupId
 * @returns {Promise<string | null>} groupId
 */
export async function groupIdFromGroupEntity(entityHash, username) {
	if (!isGroupEntityHash(entityHash)) return null
	if (!username) return null
	return resolveLogicalEntityId(username, String(entityHash).trim().toLowerCase())
}

/**
 * @param {object} meta manifest.meta
 * @returns {string | null} groupId；manifest.meta.groupId 优先（同步）
 */
export function groupIdFromManifestMeta(meta) {
	const groupId = String(meta?.groupId || '').trim()
	return groupId || null
}
