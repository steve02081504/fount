/**
 * 【文件】public/src/files.mjs
 * 【职责】聊天附件经 EVFS 上传与下载。
 */
import { fetchEvfsFile, getViewerEntityHash, uploadEvfsFile } from './evfs.mjs'

/**
 * 上传聊天附件到 EVFS。
 * @param {File | Blob} file 文件
 * @returns {Promise<{ entityHash: string, path: string, url: string }>} 上传结果
 */
export async function uploadChatAttachment(file) {
	const entityHash = await getViewerEntityHash()
	if (!entityHash) throw new Error('identity required for attachments')
	const fileId = crypto.randomUUID()
	const logicalPath = `shells/chat/attachments/${fileId}`
	return uploadEvfsFile(entityHash, logicalPath, file)
}

/**
 * 获取 EVFS 文件。
 * @param {{ entityHash: string, path: string }} ref 引用
 * @returns {Promise<ArrayBuffer>} 文件字节
 */
export async function getFile(ref) {
	if (ref?.entityHash && ref?.path)
		return fetchEvfsFile(ref.entityHash, ref.path)
	throw new Error('invalid media ref; require entityHash+path')
}

/**
 * @param {{ entityHash?: string, path?: string, url?: string, hash?: string }} ref 媒体引用
 * @returns {string} 下载 URL
 */
export function mediaRefUrl(ref) {
	if (ref?.url) return ref.url
	if (ref?.entityHash && ref?.path)
		return `/api/p2p/entities/${encodeURIComponent(ref.entityHash)}/files/${ref.path.split('/').map(encodeURIComponent).join('/')}`
	return ''
}
