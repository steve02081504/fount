import { createChatShellJsonNamespace } from './helpers.mjs'

/**
 * @param {import('../internal.mjs').ChatApiContext} apiContext API 上下文
 * @returns {object} 实体私有 JSON 方法
 */
export function createPrivateStateMethods(apiContext) {
	return {
		/**
		 * @returns {{ list: Function, set: Function, add: Function, remove: Function }} 书签
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
					const { groupId, eventId } = entry
					let added = true
					const next = await ns.update(({ entries }) => {
						if (entries.some(bookmark => bookmark.groupId === groupId && bookmark.eventId === eventId)) {
							added = false
							return { entries }
						}
						entries.push(entry)
						return { entries }
					})
					return { entries: next.entries, added }
				},
				/**
				 * 原子删除（eventId 优先，回落 href）。
				 * @param {{ groupId?: string, eventId?: string, href?: string }} entry 匹配条件
				 * @returns {Promise<{ entries: object[], removed: boolean }>} 写入后列表与是否删除
				 */
				async remove(entry) {
					const { groupId, eventId, href } = entry
					let removed = true
					const next = await ns.update(({ entries }) => {
						const filtered = entries.filter(bookmark => {
							if (eventId) return !(bookmark.groupId === groupId && bookmark.eventId === eventId)
							if (href) return bookmark.href !== href
							return true
						})
						if (filtered.length === entries.length) {
							removed = false
							return { entries }
						}
						return { entries: filtered }
					})
					return { entries: next.entries, removed }
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
		/**
		 * @returns {{ list: Function, save: Function }} 频道草稿（元数据 + 缩略图，不含附件内容）
		 */
		get drafts() {
			const ns = createChatShellJsonNamespace(apiContext, 'drafts', stored => ({
				channels: stored.channels && typeof stored.channels === 'object' ? stored.channels : {},
			}))
			return {
				/**
				 * @returns {Promise<{ channels: Record<string, object> }>} 全部频道草稿
				 */
				list: () => ns.list(),
				/**
				 * 保存/更新（record 为 null 时删除）单个频道草稿。
				 * @param {string} key `${groupId}:${channelId}`
				 * @param {object | null} [record] 草稿记录
				 * @returns {Promise<{ channels: Record<string, object> }>} 写入后的草稿表
				 */
				async save(key, record) {
					return ns.update(({ channels }) => {
						const next = { ...channels }
						if (record == null) delete next[key]
						else next[key] = record
						return { channels: next }
					})
				},
			}
		},
		/**
		 * @returns {{ list: Function, put: Function, removeMany: Function }} 草稿附件内容（base64）
		 */
		get draftContents() {
			const ns = createChatShellJsonNamespace(apiContext, 'draftContents', stored => ({
				files: stored.files && typeof stored.files === 'object' ? stored.files : {},
			}))
			return {
				/**
				 * @returns {Promise<{ files: Record<string, string> }>} 全部附件内容
				 */
				list: () => ns.list(),
				/**
				 * 写入单个附件内容。
				 * @param {string} fileId 附件 ID
				 * @param {string} content base64 内容
				 * @returns {Promise<{ files: Record<string, string> }>} 写入后的附件表
				 */
				async put(fileId, content) {
					return ns.update(({ files }) => ({ files: { ...files, [fileId]: content } }))
				},
				/**
				 * 批量删除附件内容。
				 * @param {string[]} fileIds 附件 ID 列表
				 * @returns {Promise<{ files: Record<string, string> }>} 删除后的附件表
				 */
				async removeMany(fileIds) {
					return ns.update(({ files }) => {
						const next = { ...files }
						for (const fileId of fileIds) delete next[fileId]
						return { files: next }
					})
				},
			}
		},
	}
}
