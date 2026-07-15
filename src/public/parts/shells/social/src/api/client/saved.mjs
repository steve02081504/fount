import {
	addSavedPost,
	createSavedFolder,
	deleteSavedFolder,
	enrichSavedPosts,
	loadSavedPosts,
	removeSavedPost,
	renameSavedFolder,
	searchSavedPosts,
} from '../../savedPosts.mjs'

/**
 * @param {import('./helpers.mjs').SocialApiContext} apiContext API 上下文
 * @returns {{ saved: object }} 收藏命名空间
 */
export function createSavedMethods(apiContext) {
	return {
		saved: {
			/**
			 * @returns {Promise<object>} 收藏结构（含预览）
			 */
			async list() {
				return enrichSavedPosts(apiContext.username, await loadSavedPosts(apiContext.username, apiContext.entityHash))
			},
			/**
			 * @param {{ entityHash: string, postId: string }} ref 帖引用
			 * @param {string | null} [folderId] 文件夹
			 * @returns {Promise<object>} 写入后结构
			 */
			async add(ref, folderId = null) {
				return addSavedPost(apiContext.username, apiContext.entityHash, ref, folderId)
			},
			/**
			 * @param {{ entityHash: string, postId: string }} ref 帖引用
			 * @param {string} [folderId] 文件夹；省略则全局移除
			 * @returns {Promise<object>} 写入后结构
			 */
			async remove(ref, folderId) {
				return removeSavedPost(apiContext.username, apiContext.entityHash, ref, folderId)
			},
			/**
			 * @param {string} name 文件夹名
			 * @returns {Promise<object>} 写入后结构
			 */
			async createFolder(name) {
				return createSavedFolder(apiContext.username, apiContext.entityHash, name)
			},
			/**
			 * @param {string} folderId 文件夹 id
			 * @param {string} name 新名
			 * @returns {Promise<object>} 写入后结构
			 */
			async renameFolder(folderId, name) {
				return renameSavedFolder(apiContext.username, apiContext.entityHash, folderId, name)
			},
			/**
			 * @param {string} folderId 文件夹 id
			 * @returns {Promise<object>} 写入后结构
			 */
			async deleteFolder(folderId) {
				return deleteSavedFolder(apiContext.username, apiContext.entityHash, folderId)
			},
			/**
			 * @param {string} query 搜索串
			 * @param {{ limit?: number }} [opts] 选项
			 * @returns {Promise<object>} 匹配收藏
			 */
			async search(query, opts = {}) {
				return searchSavedPosts(apiContext.username, apiContext.entityHash, query, opts)
			},
		},
	}
}
