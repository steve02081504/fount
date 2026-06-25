import fs from 'node:fs/promises'
import path from 'node:path'

import { loadJsonFile, saveJsonFile } from '../../../../../../scripts/json_loader.mjs'
import { groupEntityHash } from '../../../../../../scripts/p2p/entity/group_entity.mjs'
import { registerGroupIdResolver, unregisterGroupIdResolver } from '../../../../../../scripts/p2p/entity/group_entity_index_registry.mjs'
import { getUserDictionary } from '../../../../../../server/auth.mjs'

const OWNER_ID = 'chat'

/**
 * @param {string} username replica
 * @returns {string} 索引文件路径
 */
function groupEntityIndexPath(username) {
	return path.join(getUserDictionary(username), 'shells', 'chat', 'group_entity_index.json')
}

/**
 * @param {string} username replica
 * @param {string} groupId 群 ID
 * @returns {Promise<void>}
 */
export async function updateGroupEntityIndex(username, groupId) {
	const id = String(groupId || '').trim()
	if (!id) return
	const filePath = groupEntityIndexPath(username)
	await fs.mkdir(path.dirname(filePath), { recursive: true })
	const data = await loadJsonFile(filePath) || { byEntityHash: {} }
	const entityHash = groupEntityHash(id)
	data.byEntityHash[String(entityHash).trim().toLowerCase()] = id
	await saveJsonFile(filePath, data)
}

/**
 * @param {string} username replica
 * @param {string} entityHash 128 hex
 * @returns {Promise<string | null>} groupId
 */
export async function resolveGroupIdFromIndex(username, entityHash) {
	const want = String(entityHash || '').trim().toLowerCase()
	if (!want) return null
	const data = await loadJsonFile(groupEntityIndexPath(username))
	return data?.byEntityHash?.[want] || null
}

/**
 * 注册 group entity → groupId 反查（读本地索引）。
 * @returns {void}
 */
export function registerChatGroupEntityIndex() {
	registerGroupIdResolver(OWNER_ID, resolveGroupIdFromIndex)
}

/** @returns {void} */
export function unregisterChatGroupEntityIndex() {
	unregisterGroupIdResolver(OWNER_ID)
}
