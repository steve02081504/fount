/**
 * @param {import('../internal.mjs').ChatApiContext} apiContext API 上下文
 * @returns {object} 实体 / 资料方法
 */
export function createEntityMethods(apiContext) {
	return {
		/**
		 * @param {{ name?: string, avatar?: { buffer: Buffer, filename: string, mimeType?: string }, banner?: { buffer: Buffer, filename: string, mimeType?: string }, [key: string]: unknown }} updates 资料补丁
		 * @returns {Promise<object>} 更新后的 profile 或 `{ queued, contentHash, ts }`
		 */
		async updateProfile(updates = {}) {
			const { updateEntityProfileAsActor } = await import('../../entity/ownerProfileUpdate.mjs')
			const result = await updateEntityProfileAsActor(
				apiContext.username,
				apiContext.entityHash,
				apiContext.entityHash,
				updates,
			)
			return result.profile ?? result
		},
		/**
		 * 以本 client 实体身份更新任意目标实体资料（本机直写或远端主人 EVFS 队列）。
		 * @param {string} targetEntityHash 目标
		 * @param {object} updates 资料补丁
		 * @returns {Promise<object>} `{ profile }` 或 `{ queued, contentHash, ts }`
		 */
		async updateEntityProfile(targetEntityHash, updates = {}) {
			const { updateEntityProfileAsActor } = await import('../../entity/ownerProfileUpdate.mjs')
			return updateEntityProfileAsActor(
				apiContext.username,
				apiContext.entityHash,
				targetEntityHash,
				updates,
			)
		},
		/**
		 * 声明 / 清除本实体的所属主人（identity + profile + 群 `member_owner_update`）。
		 * @param {string | null} ownerEntityHash 主人 entityHash；null/空 清除
		 * @returns {Promise<object>} 更新后的身份行
		 */
		async setOwner(ownerEntityHash) {
			const { setEntityOwner } = await import('../../entity/identity.mjs')
			return setEntityOwner(apiContext.username, apiContext.entityHash, ownerEntityHash)
		},
		/**
		 * @returns {{ search: Function }} 实体命名空间
		 */
		get entities() {
			return {
				/**
				 * @param {string} q 搜索词
				 * @param {{ maxHits?: number }} [options] 选项
				 * @returns {Promise<{ query: string, entities: object[] }>} 网络搜索结果
				 */
				async search(q, options = {}) {
					const { searchEntitiesNetwork } = await import('../../entity/entitySearch.mjs')
					return searchEntitiesNetwork(apiContext.username, q, {
						viewerEntityHash: apiContext.entityHash,
						maxHits: options.maxHits,
					})
				},
			}
		},
	}
}
