/**
 * @param {import('../internal.mjs').ChatApiContext} apiContext API 上下文
 * @returns {object} 表情 / care 方法
 */
export function createMediaCollectionsMethods(apiContext) {
	return {
		/**
		 * @returns {object} 表情用量与收藏
		 */
		get emojis() {
			return {
				/**
				 * @returns {Promise<{ entries: object[] }>} 收藏映射条目
				 */
				async list() {
					const { listCollection } = await import('../../emojiUsage.mjs')
					const collection = listCollection(apiContext.username)
					return { entries: collection.packIds.map(packId => ({ id: packId, packId, groupId: packId })) }
				},
				/**
				 * @param {object[]} _entries 忽略
				 * @returns {never} 始终抛错，提示改用 addPack/removePack
				 */
				async set(_entries) {
					throw new Error('emojis.set unsupported; use addPack/removePack')
				},
				/**
				 * @param {{ groupId?: string, packId?: string, emojiId?: string }} fields 保存字段（收藏 pack；emojiId 仅回显）
				 * @returns {Promise<{ entry: object }>} 写入结果
				 */
				async save({ groupId, packId, emojiId }) {
					const { addPackToCollection } = await import('../../emojiUsage.mjs')
					const pid = String(packId || groupId || '').trim()
					if (pid) addPackToCollection(apiContext.username, pid)
					return {
						entry: {
							id: pid && emojiId ? `${pid}/${emojiId}` : pid || null,
							packId: pid || null,
							groupId: pid || null,
							emojiId: emojiId || null,
							savedAt: Date.now(),
						},
					}
				},
				/**
				 * @param {number} [limit] 参数
				 * @returns {Promise<object[]>} 返回值
				 */
				async frequent(limit = 32) {
					const { listFrequentEmojis } = await import('../../emojiUsage.mjs')
					return listFrequentEmojis(apiContext.username, limit)
				},
				/**
				 * @param {{ kind: string, unicode?: string, packId?: string, groupId?: string, emojiId?: string }} item 用量项
				 * @returns {Promise<void>} 返回值
				 */
				async record(item) {
					const { recordEmojiUsage } = await import('../../emojiUsage.mjs')
					recordEmojiUsage(apiContext.username, item)
				},
				/**
				 * @returns {Promise<{ packIds: string[], emojiIds: string[] }>} 收藏
				 */
				async listCollection() {
					const { listCollection } = await import('../../emojiUsage.mjs')
					return listCollection(apiContext.username)
				},
				/**
				 * @param {string} packId 表情包 ID
				 * @returns {Promise<{ packIds: string[], emojiIds: string[] }>} 更新后收藏
				 */
				async addPack(packId) {
					const { addPackToCollection, listCollection } = await import('../../emojiUsage.mjs')
					addPackToCollection(apiContext.username, packId)
					return listCollection(apiContext.username)
				},
				/**
				 * @param {string} packId 表情包 ID
				 * @returns {Promise<{ packIds: string[], emojiIds: string[] }>} 更新后收藏
				 */
				async removePack(packId) {
					const { removePackFromCollection, listCollection } = await import('../../emojiUsage.mjs')
					removePackFromCollection(apiContext.username, packId)
					return listCollection(apiContext.username)
				},
				/**
				 * @returns {Promise<object>} 用量日志 + collection + linkedDefaults
				 */
				async loadUsage() {
					const { loadEmojiUsage } = await import('../../emojiUsage.mjs')
					return loadEmojiUsage(apiContext.username)
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
