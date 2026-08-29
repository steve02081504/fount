import fs from 'node:fs/promises'
import path from 'node:path'

import { loadJsonFileIfExists, saveJsonFile } from '../../../../../../scripts/json_loader.mjs'
import { getUserDictionary } from '../../../../../../server/auth/index.mjs'
import { groupEntityHash } from '../../public/shared/groupEntityHash.mjs'
import {
	registerLogicalEntityIdResolver,
	unregisterLogicalEntityIdResolver,
} from '../entity/logicalId.mjs'

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
	const id = groupId || ''
	if (!id) return
	const filePath = groupEntityIndexPath(username)
	await fs.mkdir(path.dirname(filePath), { recursive: true })
	const data = loadJsonFileIfExists(filePath, { byEntityHash: {} })
	const entityHash = groupEntityHash(id)
	data.byEntityHash[entityHash] = id
	await saveJsonFile(filePath, data)
}

/**
 * @param {string} username replica
 * @param {string} entityHash 128 hex
 * @returns {Promise<string | null>} groupId
 */
export async function resolveGroupIdFromIndex(username, entityHash) {
	const want = entityHash || ''
	if (!want) return null
	const data = loadJsonFileIfExists(groupEntityIndexPath(username), null)
	const fromIndex = data?.byEntityHash?.[want]
	if (fromIndex) return fromIndex
	// 索引缺失（如从未上传文件的对端节点）→ 扫描群目录反查。
	try {
		const { readdir } = await import('node:fs/promises')
		const root = path.join(getUserDictionary(username), 'shells', 'chat', 'groups')
		const entries = await readdir(root, { withFileTypes: true }).catch(() => [])
		for (const entry of entries) {
			if (!entry.isDirectory()) continue
			if (groupEntityHash(entry.name) === want) return entry.name
		}
	}
	catch { /* 无群目录 */ }
	return null
}

/**
 * 注册 group entity → groupId 反查（读本地索引）。
 * @returns {void}
 */
export function registerChatGroupEntityIndex() {
	registerLogicalEntityIdResolver(OWNER_ID, resolveGroupIdFromIndex)
}

/** @returns {void} */
export function unregisterChatGroupEntityIndex() {
	unregisterLogicalEntityIdResolver(OWNER_ID)
}
