/**
 * 聊天附件经 EVFS 上传与下载。
 */
import { fetchEvfsFile, uploadEvfsAttachment } from '/parts/shells:chat/shared/evfsMedia.mjs'

const CHAT_ATTACHMENT_PREFIX = 'shells/chat/attachments'

/**
 * 上传聊天附件到 EVFS。
 * @param {File | Blob} file 文件
 * @returns {Promise<{ entityHash: string, path: string, url: string }>} 上传结果
 */
export async function uploadChatAttachment(file) {
	return uploadEvfsAttachment(file, CHAT_ATTACHMENT_PREFIX)
}

/**
 * 获取 EVFS 文件。
 * @param {{ entityHash: string, path: string }} ref 引用
 * @returns {Promise<ArrayBuffer>} 文件字节
 */
export async function getFile(ref) {
	return fetchEvfsFile(ref.entityHash, ref.path)
}
