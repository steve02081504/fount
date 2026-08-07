/** Social 草稿箱。 */
import { socialRequest } from './client.mjs'

/**
 * @returns {Promise<{ drafts: object[] }>} 草稿列表
 */
export function getDrafts() {
	return socialRequest('/drafts')
}

/**
 * @param {string} draftId 草稿 id
 * @returns {Promise<object>} 草稿行
 */
export function getDraft(draftId) {
	return socialRequest(`/drafts/${encodeURIComponent(draftId)}`)
}

/**
 * 创建或更新草稿（body 携带 `draftId` 时为更新）。
 * @param {object} body 草稿 body
 * @returns {Promise<object>} 写入后的草稿行
 */
export function saveDraft(body) {
	return socialRequest('/drafts', { method: 'POST', body: JSON.stringify(body) })
}

/**
 * @param {string} draftId 草稿 id
 * @returns {Promise<void>}
 */
export function deleteDraft(draftId) {
	return socialRequest(`/drafts/${encodeURIComponent(draftId)}`, { method: 'DELETE' })
}
