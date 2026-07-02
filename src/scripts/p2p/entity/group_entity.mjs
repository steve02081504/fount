import { sha256TextHex } from '../crypto.mjs'
import { encodeEntityHash, parseEntityHash } from '../entity_id.mjs'

const GROUP_SUBJECT_PREFIX = 'fount:chat:group:'

/** @type {string} 逻辑群实体 sentinel nodeHash（非物理节点绑定） */
export const GROUP_SENTINEL_NODE_HASH = '0'.repeat(64)

/**
 * @param {string} groupId 群 ID
 * @returns {string} 128 位 groupEntityHash
 */
export function groupEntityHash(groupId) {
	const id = String(groupId || '').trim()
	if (!id) throw new Error('groupId required')
	return encodeEntityHash(GROUP_SENTINEL_NODE_HASH, sha256TextHex(`${GROUP_SUBJECT_PREFIX}${id}`))
}

/**
 * @param {unknown} entityHash 128 hex
 * @returns {boolean} 是否为 group entity
 */
export function isGroupEntityHash(entityHash) {
	const parsed = parseEntityHash(entityHash)
	if (!parsed) return false
	return parsed.nodeHash === GROUP_SENTINEL_NODE_HASH
}

/**
 * @param {unknown} entityHash 128 hex
 * @param {string} [username] 可选；提供时在用户群目录反查 groupId
 * @returns {Promise<string | null>} groupId
 */
export async function groupIdFromGroupEntity(entityHash, username) {
	if (!isGroupEntityHash(entityHash)) return null
	if (!username) return null
	const { resolveGroupIdFromEntityHash } = await import('./group_entity_index_registry.mjs')
	return resolveGroupIdFromEntityHash(username, String(entityHash).trim().toLowerCase())
}

/**
 * @param {object} meta manifest.meta
 * @returns {string | null} groupId；manifest.meta.groupId 优先（同步）
 */
export function groupIdFromManifestMeta(meta) {
	const groupId = String(meta?.groupId || '').trim()
	return groupId || null
}
