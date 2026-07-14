import {
	isLogicalEntityHash,
	logicalEntityHash,
} from 'npm:@steve02081504/fount-p2p/core/logical_entity'
import { resolveLogicalEntityId } from '../../entity/logicalId.mjs'

/**
 *
 */
export const GROUP_SUBJECT_PREFIX = 'fount:chat:group:'

/**
 * @param {string} groupId 群 ID
 * @returns {string} 128 位 groupEntityHash
 */
export function groupEntityHash(groupId) {
	const id = String(groupId || '').trim()
	if (!id) throw new Error('groupId required')
	return logicalEntityHash(`${GROUP_SUBJECT_PREFIX}${id}`)
}

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
