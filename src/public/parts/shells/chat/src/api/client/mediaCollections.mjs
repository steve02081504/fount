import { createChatShellJsonNamespace } from './helpers.mjs'

/**
 * @param {import('../internal.mjs').ChatApiContext} apiContext API 上下文
 * @returns {object} 表情 / 贴纸 / care 方法
 */
export function createMediaCollectionsMethods(apiContext) {
	return {
		/**
		 * @returns {{ list: Function, set: Function, save: Function, frequent: Function, record: Function }} 自定义表情与用量
		 */
		get emojis() {
			const customEmojis = createChatShellJsonNamespace(apiContext, 'customEmojis', stored => ({
				entries: Array.isArray(stored.entries) ? stored.entries : Array.isArray(stored) ? stored : [],
			}))
			return {
				/**
				 * @returns {Promise<{ entries: object[] }>} 自定义表情
				 */
				list: () => customEmojis.list(),
				/**
				 * @param {object[]} entries 表情条目
				 * @returns {Promise<{ entries: object[] }>} 写入后的列表
				 */
				async set(entries) {
					return customEmojis.set({ entries: Array.isArray(entries) ? entries : [] })
				},
				/**
				 * @param {{ groupId: string, emojiId: string, dataUrl: string }} fields 保存字段
				 * @returns {Promise<{ entry: object }>} 新条目
				 */
				async save({ groupId, emojiId, dataUrl }) {
					const { loadEntityShellData, assignEntityShellData } = await import('../../../../../../../server/setting_loader.mjs')
					const gid = String(groupId || '').trim()
					const eid = String(emojiId || '').trim()
					const url = String(dataUrl || '').trim()
					if (!gid || !eid) throw new Error('groupId and emojiId required')
					if (!url.startsWith('data:')) throw new Error('dataUrl required (data:…)')
					const entries = [...loadEntityShellData(apiContext.username, 'chat', apiContext.entityHash, 'customEmojis').entries || []]
					const id = `${gid}/${eid}`
					const next = { id, groupId: gid, emojiId: eid, dataUrl: url, savedAt: Date.now() }
					const existingIndex = entries.findIndex(entry => entry?.id === id)
					if (existingIndex >= 0) entries[existingIndex] = next
					else entries.push(next)
					assignEntityShellData(apiContext.username, 'chat', apiContext.entityHash, 'customEmojis', { entries })
					return { entry: next }
				},
				/**
				 * @param {number} [limit] 条数上限
				 * @returns {Promise<object[]>} 常用表情
				 */
				async frequent(limit = 32) {
					const { listFrequentEmojis } = await import('../../emojiUsage.mjs')
					return listFrequentEmojis(apiContext.username, apiContext.entityHash, limit)
				},
				/**
				 * @param {{ kind: string, unicode?: string, groupId?: string, emojiId?: string }} item 表情
				 * @returns {Promise<void>}
				 */
				async record(item) {
					const { recordEmojiUsage } = await import('../../emojiUsage.mjs')
					recordEmojiUsage(apiContext.username, apiContext.entityHash, item)
				},
			}
		},
		/**
		 * @returns {{ get: Function, install: Function, uninstall: Function, addFavorite: Function, removeFavorite: Function, recordRecent: Function }} 贴纸收藏
		 */
		get stickers() {
			return {
				/**
				 * @returns {Promise<object>} 贴纸收藏
				 */
				async get() {
					const { getUserCollection } = await import('../../stickers/stickers.mjs')
					return getUserCollection(apiContext.username, apiContext.entityHash)
				},
				/**
				 * @param {string} packId 包 id
				 * @returns {Promise<void>}
				 */
				async install(packId) {
					const { installPack } = await import('../../stickers/stickers.mjs')
					await installPack(apiContext.username, apiContext.entityHash, packId)
				},
				/**
				 * @param {string} packId 包 id
				 * @returns {Promise<void>}
				 */
				async uninstall(packId) {
					const { uninstallPack } = await import('../../stickers/stickers.mjs')
					await uninstallPack(apiContext.username, apiContext.entityHash, packId)
				},
				/**
				 * @param {string} stickerId 贴纸 id
				 * @returns {Promise<void>}
				 */
				async addFavorite(stickerId) {
					const { addToFavorites } = await import('../../stickers/stickers.mjs')
					await addToFavorites(apiContext.username, apiContext.entityHash, stickerId)
				},
				/**
				 * @param {string} stickerId 贴纸 id
				 * @returns {Promise<void>}
				 */
				async removeFavorite(stickerId) {
					const { removeFromFavorites } = await import('../../stickers/stickers.mjs')
					await removeFromFavorites(apiContext.username, apiContext.entityHash, stickerId)
				},
				/**
				 * @param {string} stickerId 贴纸 id
				 * @returns {Promise<void>}
				 */
				async recordRecent(stickerId) {
					const { recordRecentUse } = await import('../../stickers/stickers.mjs')
					await recordRecentUse(apiContext.username, apiContext.entityHash, stickerId)
				},
			}
		},
		/**
		 * @returns {{ list: Function, set: Function }} 关心列表（共享 care.json，键=entityHash）
		 */
		get care() {
			return {
				/**
				 * @returns {Promise<string[]>} cared entityHashes
				 */
				async list() {
					const { listCared } = await import('../../chat/lib/care.mjs')
					return listCared(apiContext.username, apiContext.entityHash)
				},
				/**
				 * @param {string} targetEntityHash 目标实体
				 * @param {boolean} [cared] 是否关心
				 * @returns {Promise<string[]>} 更新后的列表
				 */
				async set(targetEntityHash, cared = true) {
					const { setCared, listCared } = await import('../../chat/lib/care.mjs')
					await setCared(apiContext.username, apiContext.entityHash, targetEntityHash, cared !== false)
					return listCared(apiContext.username, apiContext.entityHash)
				},
			}
		},
	}
}
