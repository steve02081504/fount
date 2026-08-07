/**
 * 【文件】public/src/endpoints/groupFiles.mjs
 * 【职责】群文件分块上传 REST：chunk 预检/注册/上传、文件事件、meta、断点续传、共享柜绑定。
 * 【关联】groupClient.mjs；src/ui/groupFileUpload.mjs、hub/files.mjs。
 */
import { groupFetch, groupPath } from './groupClient.mjs'

/**
 * 预检收敛加密块是否已存在。
 * @param {string} groupId 群 ID
 * @param {object} body `{ ciphertextHash?, size, channelId?, ceMode }`
 * @returns {Promise<{ have: boolean, storageLocator?: string }>} 预检结果
 */
export async function probeChunkHave(groupId, body) {
	return groupFetch(groupPath(groupId, 'chunks', 'have'), { method: 'POST', json: body })
}

/**
 * 注册或上传一个明文块（`registerOnly` 命中去重时跳过重复写入）。
 * @param {string} groupId 群 ID
 * @param {object} body `{ fileId, data, registerOnly?, channelId?, ceMode }`
 * @returns {Promise<object>} 块 manifest 字段
 */
export async function uploadOrRegisterChunk(groupId, body) {
	return groupFetch(groupPath(groupId, 'chunks'), { method: 'POST', json: body })
}

/**
 * 落盘文件事件（单块或多块 manifest）。
 * @param {string} groupId 群 ID
 * @param {object} manifestBody 文件 manifest
 * @returns {Promise<object>} 文件事件
 */
export async function createGroupFileEvent(groupId, manifestBody) {
	return groupFetch(groupPath(groupId, 'files'), { method: 'POST', json: manifestBody })
}

/**
 * 拉取文件元信息（含 parts / storageLocator）。
 * @param {string} groupId 群 ID
 * @param {string} fileId 文件 ID
 * @returns {Promise<object>} 文件元信息
 */
export async function getGroupFileMeta(groupId, fileId) {
	return groupFetch(groupPath(groupId, 'files', fileId, 'meta'), { method: 'GET' })
}

/**
 * 触发多块文件的断点续传（联邦拉取缺失块）。
 * @param {string} groupId 群 ID
 * @param {string} fileId 文件 ID
 * @returns {Promise<void>}
 */
export async function resumeGroupFileDownload(groupId, fileId) {
	await groupFetch(groupPath(groupId, 'files', fileId, 'download-resume'), { method: 'POST', json: {} })
}

/**
 * 绑定共享文件柜到群角色访问表。
 * @param {string} groupId 群 ID
 * @param {{ cabinet_id: string, role_access: Record<string, 'ro'|'rw'> }} body 绑定体
 * @returns {Promise<void>}
 */
export async function bindGroupCabinet(groupId, body) {
	await groupFetch(groupPath(groupId, 'cabinets', 'bind'), { method: 'POST', json: body })
}
