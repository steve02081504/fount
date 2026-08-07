/** Social 借用的 Chat shell HTTP 面：viewer / personal-lists / entities / translation-prefs / groups。 */
import { chatRequest } from './client.mjs'

/**
 * @returns {Promise<{ viewerEntityHash: string | null, nodeHash: string | null, profile: object | null }>} viewer 信息
 */
export function getChatViewer() {
	return chatRequest('/viewer')
}

/**
 * @returns {Promise<{ entries: object[] }>} 个人拉黑/隐藏名单
 */
export function getPersonalLists() {
	return chatRequest('/personal-lists')
}

/**
 * @returns {Promise<{ prefs: { autoTranslate: boolean } }>} 翻译偏好
 */
export function getTranslationPrefs() {
	return chatRequest('/translation-prefs')
}

/**
 * @param {{ autoTranslate: boolean }} prefs 翻译偏好
 * @returns {Promise<object>} 写入结果
 */
export function putTranslationPrefs(prefs) {
	return chatRequest('/translation-prefs', { method: 'PUT', body: JSON.stringify({ prefs }) })
}

/**
 * 经 Chat 多跳搜实体。
 * @param {string} query 查询词
 * @param {number} [limit=20] 数量
 * @returns {Promise<{ entities: object[] }>} 实体搜索结果
 */
export function searchChatEntities(query, limit = 20) {
	return chatRequest(`/entities/search?q=${encodeURIComponent(query)}&limit=${limit}`)
}

/**
 * @param {string} entityHash 实体
 * @returns {Promise<object>} 实体资料
 */
export function getChatEntity(entityHash) {
	return chatRequest(`/entities/${encodeURIComponent(entityHash)}`)
}

/**
 * @returns {Promise<object[]>} operator 所在群列表（发帖关联群选择器用）
 */
export function getChatGroups() {
	return chatRequest('/groups/')
}
