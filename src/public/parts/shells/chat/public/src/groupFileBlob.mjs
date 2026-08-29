/**
 * 【文件】public/src/groupFileBlob.mjs
 * 【职责】群加密文件下载为 Blob URL（经群文件字节路由；跨节点按需拉取 manifest / chunk）。
 */
import { getGroupFileBytes } from './endpoints/groupFiles.mjs'


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
	const { buffer, mimeType } = await getGroupFileBytes(groupId, fileId)
	return new Blob([buffer], { type: mimeType || 'application/octet-stream' })
}
