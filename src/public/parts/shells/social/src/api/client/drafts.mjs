import { deleteDraft, getDraft, listDrafts, upsertDraft } from '../../drafts.mjs'

/**
 * @param {import('./helpers.mjs').SocialApiContext} apiContext API 上下文
 * @returns {{ drafts: object }} 草稿箱命名空间
 */
export function createDraftsMethods(apiContext) {
	return {
		drafts: {
			/**
			 * @returns {Promise<{ drafts: object[] }>} 草稿列表
			 */
			async list() {
				return listDrafts(apiContext.username, apiContext.entityHash)
			},
			/**
			 * @param {string} draftId id
			 * @returns {Promise<object>} 单条草稿
			 */
			async get(draftId) {
				return getDraft(apiContext.username, apiContext.entityHash, draftId)
			},
			/**
			 * @param {object} body 发帖字段；可选 draftId 更新
			 * @returns {Promise<object>} 写入后草稿行
			 */
			async upsert(body) {
				return upsertDraft(apiContext.username, apiContext.entityHash, body)
			},
			/**
			 * @param {string} draftId id
			 * @returns {Promise<{ drafts: object[] }>} 删除后列表
			 */
			async delete(draftId) {
				return deleteDraft(apiContext.username, apiContext.entityHash, draftId)
			},
		},
	}
}
