/**
 * 【文件】public/src/groupFileBlob.mjs
 * 【职责】群加密文件经 groupEntityHash EVFS 解密下载为 Blob URL。
 */
import { entityFileUrl } from './evfs.mjs'
import { groupEntityHash } from './lib/groupEntityHash.mjs'


/**
 * 获取并解密群文件，返回 Blob URL（供 Hub 内联渲染）。
 * @param {string} groupId 群 ID
 * @param {string} fileId 文件 ID
 * @returns {Promise<string | null>} Blob URL；失败时为 null
 */
export async function fetchGroupFileAsBlobUrl(groupId, fileId) {
	const entityHash = await groupEntityHash(groupId)
	const logicalPath = `chat/${fileId}`
	const response = await fetch(entityFileUrl(entityHash, logicalPath), { credentials: 'include' })
	if (!response.ok) return null
	const mimeType = response.headers.get('Content-Type') || 'application/octet-stream'
	const plainBytes = new Uint8Array(await response.arrayBuffer())
	return URL.createObjectURL(new Blob([plainBytes], { type: mimeType }))
}

