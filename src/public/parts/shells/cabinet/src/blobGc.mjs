import { unlink } from 'node:fs/promises'

import { loadFileManifest } from 'npm:@steve02081504/fount-p2p/files/evfs'
import { getEntityStore } from 'npm:@steve02081504/fount-p2p/node/instance'

/**
 * 从预览 URL 解析 entityHash + logical path 并删除 manifest。
 * @param {string} url 预览 URL
 * @returns {Promise<void>}
 */
export async function tryDeletePreviewByUrl(url) {
	const match = String(url || '').match(/\/entities\/([^/]+)\/files\/(.+)$/)
	if (!match) return
	const entityHash = decodeURIComponent(match[1])
	const logicalPath = match[2].split('/').map(decodeURIComponent).join('/')
	await deleteEvfsManifest(entityHash, logicalPath)
}

/**
 * @param {string} ownerEntityHash 所有者
 * @param {string} logicalPath 路径
 * @returns {Promise<void>}
 */
export async function deleteEvfsManifest(ownerEntityHash, logicalPath) {
	try {
		const store = getEntityStore()
		if (typeof store.deleteManifest === 'function') {
			await store.deleteManifest(ownerEntityHash, logicalPath)
			return
		}
		const manifest = await loadFileManifest(ownerEntityHash, logicalPath)
		if (!manifest) return
		// 无 delete API 时写空占位不可取；尝试直接删文件
		const path = store.manifestPath?.(ownerEntityHash, logicalPath)
		if (path) await unlink(path).catch(() => { })
	}
	catch { /* best-effort */ }
}

/**
 * @param {string} username 用户
 * @param {string} entityHash 实体
 * @param {object} entry 条目
 * @returns {Promise<void>}
 */
export async function hardDeleteEntryBlobs(username, entityHash, entry) {
	void username
	if (entry?.evfs_path)
		await deleteEvfsManifest(entityHash, entry.evfs_path)
	if (entry?.preview?.delete_with_file && entry.preview?.url)
		await tryDeletePreviewByUrl(entry.preview.url)
}
