/**
 * 【文件】public/src/groupFileBlob.mjs
 * 【职责】群加密文件经 groupEntityHash EVFS 解密下载为 Blob URL。
 */
import { fetchEvfsFile } from '/scripts/endpoints/p2p/evfsMedia.mjs'
import { groupEntityHash } from '../shared/groupEntityHash.mjs'


/**
 * 获取并解密群文件，返回 Blob URL（供 Hub 内联渲染）。
 * @param {string} groupId 群 ID
 * @param {string} fileId 文件 ID
 * @returns {Promise<string>} Blob URL
 */
export async function fetchGroupFileAsBlobUrl(groupId, fileId) {
	const blob = await fetchGroupFileAsBlob(groupId, fileId)
	return URL.createObjectURL(blob)
}

/**
 * 获取并解密群文件为 Blob。
 * @param {string} groupId 群 ID
 * @param {string} fileId 文件 ID
 * @returns {Promise<Blob>} 明文 Blob
 */
export async function fetchGroupFileAsBlob(groupId, fileId) {
	const entityHash = groupEntityHash(groupId)
	const { buffer, mimeType } = await fetchEvfsFile(entityHash, `chat/${fileId}`)
	return new Blob([buffer], { type: mimeType || 'application/octet-stream' })
}
