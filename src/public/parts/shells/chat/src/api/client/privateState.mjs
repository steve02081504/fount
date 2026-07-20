import { createChatShellJsonNamespace } from './helpers.mjs'

/**
 * @param {import('../internal.mjs').ChatApiContext} apiContext API 上下文
 * @returns {object} 实体私有 JSON 方法
 */
export function createPrivateStateMethods(apiContext) {
	return {
		/**
		 * @returns {{ list: Function, set: Function }} 书签
		 */
		get bookmarks() {
			const ns = createChatShellJsonNamespace(apiContext, 'bookmarks', stored => ({
				entries: Array.isArray(stored.entries) ? stored.entries : [],
			}))
			return {
				/**
				 * @returns {Promise<{ entries: object[] }>} 书签列表
				 */
				list: () => ns.list(),
				/**
				 * @param {object[]} entries 书签条目
				 * @returns {Promise<{ entries: object[] }>} 写入后的列表
				 */
				async set(entries) {
					return ns.set({ entries: Array.isArray(entries) ? entries : [] })
				},
			}
		},
		/**
		 * @returns {{ list: Function, set: Function }} 群文件夹
		 */
		get groupFolders() {
			const ns = createChatShellJsonNamespace(apiContext, 'groupFolders', stored => ({
				folders: Array.isArray(stored.folders) ? stored.folders : [],
			}))
			return {
				/**
				 * @returns {Promise<{ folders: object[] }>} 文件夹列表
				 */
				list: () => ns.list(),
				/**
				 * @param {object[]} folders 文件夹
				 * @returns {Promise<{ folders: object[] }>} 写入后的列表
				 */
				async set(folders) {
					return ns.set({ folders: Array.isArray(folders) ? folders : [] })
				},
			}
		},
		/**
		 * @returns {{ list: Function, set: Function }} 实体/群别名
		 */
		get aliases() {
			return createChatShellJsonNamespace(apiContext, 'aliases', stored => ({
				entities: stored.entities || {},
				groups: stored.groups || {},
			}))
		},
	}
}
