/** Social 收藏帖与收藏文件夹。 */
import { socialRequest } from './client.mjs'

/**
 * @returns {Promise<{ folders: object, unfiled: object[] }>} 收藏结构
 */
export function getSavedPosts() {
	return socialRequest('/saved-posts')
}

/**
 * @param {string} entityHash 作者
 * @param {string} postId 帖 id
 * @param {string} [folderId] 目标文件夹（省略为未分类）
 * @returns {Promise<object>} 写入结果
 */
export function addSavedPost(entityHash, postId, folderId) {
	return socialRequest('/saved-posts/add', {
		method: 'POST',
		body: JSON.stringify({ entityHash, postId, ...folderId ? { folderId } : {} }),
	})
}

/**
 * @param {string} entityHash 作者
 * @param {string} postId 帖 id
 * @param {string} [folderId] 所在文件夹
 * @returns {Promise<object>} 写入结果
 */
export function removeSavedPost(entityHash, postId, folderId) {
	return socialRequest('/saved-posts/remove', {
		method: 'POST',
		body: JSON.stringify({ entityHash, postId, ...folderId ? { folderId } : {} }),
	})
}

/**
 * @param {string} name 文件夹名
 * @returns {Promise<object>} 新建文件夹
 */
export function createSavedFolder(name) {
	return socialRequest('/saved-posts/folders', { method: 'POST', body: JSON.stringify({ name }) })
}

/**
 * @param {string} folderId 文件夹 id
 * @param {string} name 新名称
 * @returns {Promise<object>} 写入结果
 */
export function renameSavedFolder(folderId, name) {
	return socialRequest('/saved-posts/folders/rename', {
		method: 'POST',
		body: JSON.stringify({ folderId, name }),
	})
}

/**
 * @param {string} folderId 文件夹 id
 * @returns {Promise<object>} 写入结果
 */
export function deleteSavedFolder(folderId) {
	return socialRequest('/saved-posts/folders/delete', {
		method: 'POST',
		body: JSON.stringify({ folderId }),
	})
}
