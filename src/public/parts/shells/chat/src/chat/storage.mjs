/**
 * 群文件存储插件（§10.2）。
 *
 * 文件密钥统一由 `KDF(H, "file", fileId)` 推导（§10.3 GSH 方案），
 * 无需单独存储 AES 密钥，旧 `storeFileAesKey` / `getFileAesKey` 已废弃。
 */

import {
	createFederatedChunksPlugin,
	createLocalStoragePlugin,
	createS3StoragePlugin,
} from '../../../../../../scripts/p2p/storage_plugins.mjs'
import { loadShellData } from '../../../../../../server/setting_loader.mjs'

import { shellChatRoot } from './paths.mjs'

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
