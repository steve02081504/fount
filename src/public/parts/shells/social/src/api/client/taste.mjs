import { rebuildTaste } from '../../taste/cluster.mjs'
import { revokeTasteAlias } from '../../taste/mergeClaims.mjs'
import { listTasteTags, publishTagName } from '../../taste/nameClaims.mjs'
import { loadTaste, mutateTaste } from '../../taste/store.mjs'

/**
 * @param {import('./helpers.mjs').SocialApiContext} apiContext API 上下文
 * @returns {{ taste: object }} taste 命名空间
 */
export function createTasteMethods(apiContext) {
	return {
		taste: {
			/**
			 * @param {{ locale?: string }} [options] 选项
			 * @returns {Promise<object>} 偏好与标签列表
			 */
			async get(options = {}) {
				const locale = String(options.locale || 'zh-CN')
				const store = await loadTaste(apiContext.username, apiContext.entityHash)
				const tags = await listTasteTags(apiContext.username, apiContext.entityHash, locale)
				return {
					privacy: store.privacy,
					clusteredAt: store.clusteredAt,
					aliases: store.aliases,
					tags,
				}
			},
			/**
			 * @param {{ privacy?: { publishPreferences?: boolean }, tags?: Record<string, number> }} patch 补丁
			 * @returns {Promise<object>} 更新后偏好摘要
			 */
			async update(patch = {}) {
				const store = await mutateTaste(apiContext.username, apiContext.entityHash, draft => {
					if (patch.privacy && typeof patch.privacy === 'object')
						draft.privacy = {
							publishPreferences: patch.privacy.publishPreferences !== false,
							publishReactions: patch.privacy.publishReactions !== false,
						}
					if (patch.tags && typeof patch.tags === 'object')
						for (const [tag, weight] of Object.entries(patch.tags)) {
							const key = String(tag).trim().toLowerCase()
							if (!key) continue
							const value = Number(weight)
							if (!Number.isFinite(value)) continue
							if (value === 0) delete draft.manual[key]
							else draft.manual[key] = value
						}
					return draft
				})
				return {
					privacy: store.privacy,
					computed: store.computed,
					manual: store.manual,
					aliases: store.aliases,
				}
			},
			/**
			 * @returns {Promise<object>} 重建结果
			 */
			async rebuild() {
				const store = await rebuildTaste(apiContext.username, apiContext.entityHash)
				return {
					clusteredAt: store.clusteredAt,
					tagCount: Object.keys(store.computed).length + Object.keys(store.manual).length,
				}
			},
			/**
			 * @param {{ tagHash: string, label: string, locale?: string }} input 命名
			 * @returns {Promise<object>} 命名事件
			 */
			async setName(input) {
				const event = await publishTagName(apiContext.username, apiContext.entityHash, input)
				return { event }
			},
			/**
			 * @param {string} fromTag 源 tag
			 * @returns {Promise<object>} 别名表
			 */
			async revokeAlias(fromTag) {
				const store = await revokeTasteAlias(apiContext.username, apiContext.entityHash, fromTag)
				return { aliases: store.aliases }
			},
		},
	}
}
