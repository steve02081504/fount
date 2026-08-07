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
				/**
				 * 原子追加（同群同事件去重）。
				 * @param {object} entry 书签条目
				 * @returns {Promise<{ entries: object[], added: boolean }>} 写入后列表与是否新增
				 */
				async add(entry) {
					const { entries } = await ns.list()
					const groupId = String(entry?.groupId || '')
					const eventId = String(entry?.eventId || '')
					if (groupId && eventId && entries.some(bookmark => bookmark?.groupId === groupId && bookmark?.eventId === eventId))
						return { entries, added: false }
					entries.push(entry)
					const next = await ns.set({ entries })
					return { entries: next.entries, added: true }
				},
				/**
				 * 原子删除（eventId 优先，回落 href）。
				 * @param {{ groupId?: string, eventId?: string, href?: string }} entry 匹配条件
				 * @returns {Promise<{ entries: object[], removed: boolean }>} 写入后列表与是否删除
				 */
				async remove(entry) {
					const { entries } = await ns.list()
					const groupId = String(entry?.groupId || '')
					const eventId = String(entry?.eventId || '')
					const href = String(entry?.href || '')
					const next = entries.filter(bookmark => {
						if (eventId) return !(String(bookmark?.groupId || '') === groupId && String(bookmark?.eventId || '') === eventId)
						if (href) return String(bookmark?.href || '') !== href
						return true
					})
					if (next.length === entries.length) return { entries, removed: false }
					const saved = await ns.set({ entries: next })
					return { entries: saved.entries, removed: true }
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
