import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import {
	createLocalStoragePlugin,
	createS3StoragePlugin,
	createFederatedChunksPlugin,
} from '../../../../../../scripts/p2p/storage_plugins.mjs'
import { loadShellData } from '../../../../../../server/setting_loader.mjs'

import { aesKeysPath, shellChatRoot } from './paths.mjs'
import { safeReadJson } from './utils.mjs'

// ─── 文件 aesKey 安全存储（与 DAG 解耦，仅服务端持有）─────────────────────

/**
 * 存储 fileId → aesKeyHex（仅 home 节点调用，不写入 DAG）
 * @param {string} username 用户名
 * @param {string} groupId 群组 ID
 * @param {string} fileId 文件 ID
 * @param {string} aesKeyHex 256 位 AES 密钥（十六进制）
 * @returns {Promise<void>} 写入完成
 */
export async function storeFileAesKey(username, groupId, fileId, aesKeyHex) {
	const p = aesKeysPath(username, groupId)
	await mkdir(join(p, '..'), { recursive: true })
	const obj = await safeReadJson(p) ?? {}
	obj[String(fileId)] = String(aesKeyHex)
	await writeFile(p, JSON.stringify(obj, null, '\t'), 'utf8')
}

/**
 * 读取 fileId 对应的 aesKeyHex
 * @param {string} username 用户名
 * @param {string} groupId 群组 ID
 * @param {string} fileId 文件事件 ID
 * @returns {Promise<string | null>} 十六进制密钥；不存在则 null
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
 * @param {string} username 用户名
 * @param {string} groupId 群组 ID
 * @param {string} fileId 文件 ID
 * @returns {Promise<void>}
 */
export async function deleteFileAesKey(username, groupId, fileId) {
	const p = aesKeysPath(username, groupId)
	const obj = await safeReadJson(p)
	if (!obj) return
	delete obj[fileId]
	await writeFile(p, JSON.stringify(obj, null, '\t'), 'utf8')
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
 * @param {string} username 用户名
 * @returns {object} 存储插件实例（local / s3 / federated 之一）
 */
export function getStorage(username) {
	const baseDir = shellChatRoot(username)
	const data = loadShellData(username, 'chat', 'storage') || {}
	const type = typeof data.type === 'string' ? data.type : 'local'
	if (type === 's3' && data.s3 && typeof data.s3 === 'object')
		return createS3StoragePlugin(data.s3)
	if (type === 'federated' && data.federated && typeof data.federated === 'object')
		return createFederatedChunksPlugin(data.federated)
	return createLocalStoragePlugin(baseDir)
}
