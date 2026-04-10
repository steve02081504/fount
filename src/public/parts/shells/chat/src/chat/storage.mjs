import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import { getUserDictionary } from '../../../../../../server/auth.mjs'
import { loadShellData } from '../../../../../../server/setting_loader.mjs'
import {
	createLocalStoragePlugin,
	createS3StoragePlugin,
	createFederatedChunksPlugin,
} from '../../../../../../scripts/p2p/storage_plugins.mjs'

// ─── 文件 aesKey 安全存储（与 DAG 解耦，仅服务端持有）─────────────────────

function aesKeysPath(username, groupId) {
	return join(getUserDictionary(username), 'shells', 'chat', 'groups', groupId, 'aes_keys.json')
}

/**
 * 存储 fileId → aesKeyHex（仅 home 节点调用，不写入 DAG）
 * @param {string} username
 * @param {string} groupId
 * @param {string} fileId
 * @param {string} aesKeyHex 256-bit AES key in hex
 */
export async function storeFileAesKey(username, groupId, fileId, aesKeyHex) {
	const p = aesKeysPath(username, groupId)
	await mkdir(join(p, '..'), { recursive: true })
	let obj = {}
	try { obj = JSON.parse(await readFile(p, 'utf8')) } catch { /* new */ }
	obj[String(fileId)] = String(aesKeyHex)
	await writeFile(p, JSON.stringify(obj, null, '\t'), 'utf8')
}

/**
 * 读取 fileId 对应的 aesKeyHex
 * @param {string} username
 * @param {string} groupId
 * @param {string} fileId
 * @returns {Promise<string | null>}
 */
export async function getFileAesKey(username, groupId, fileId) {
	try {
		const obj = JSON.parse(await readFile(aesKeysPath(username, groupId), 'utf8'))
		return typeof obj[fileId] === 'string' ? obj[fileId] : null
	}
	catch { return null }
}

/**
 * 吊销 aesKey（file_delete 时调用）
 * @param {string} username
 * @param {string} groupId
 * @param {string} fileId
 */
export async function deleteFileAesKey(username, groupId, fileId) {
	try {
		const p = aesKeysPath(username, groupId)
		const obj = JSON.parse(await readFile(p, 'utf8'))
		delete obj[fileId]
		await writeFile(p, JSON.stringify(obj, null, '\t'), 'utf8')
	}
	catch { /* ignore */ }
}

// ─── 存储插件 ────────────────────────────────────────────────────────────────

/**
 * 返回该用户配置的群文件存储插件。
 *
 * 通过 `shellData/chat/storage.json` 配置，格式：
 * ```json
 * { "type": "local" }
 * { "type": "s3", "s3": { "bucket": "...", "accessKeyId": "...", "secretAccessKey": "..." } }
 * { "type": "federated", "federated": { "replicas": [...] } }
 * ```
 * 默认（无配置）使用 local 插件。
 * @param {string} username
 */
export function getStorage(username) {
	const baseDir = join(getUserDictionary(username), 'shells', 'chat')
	const data = loadShellData(username, 'chat', 'storage') || {}
	const type = typeof data.type === 'string' ? data.type : 'local'
	if (type === 's3' && data.s3 && typeof data.s3 === 'object')
		return createS3StoragePlugin(data.s3)
	if (type === 'federated' && data.federated && typeof data.federated === 'object')
		return createFederatedChunksPlugin(data.federated)
	return createLocalStoragePlugin(baseDir)
}
