/**
 * 【文件】public/src/endpoints/folders.mjs
 * 【职责】群文件夹（侧栏分组）REST。
 */
import { chatFetch } from './groupClient.mjs'

/**
 * @returns {Promise<any>} folders 载荷
 */
export function getGroupFolders() {
	return chatFetch('/group-folders')
}

/**
 * @param {object} body 全量 folders 状态
 * @returns {Promise<any>} 响应
 */
export function putGroupFolders(body) {
	return chatFetch('/group-folders', { method: 'PUT', json: body })
}
