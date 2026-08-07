/**
 * 【文件】public/src/endpoints/prefs.mjs
 * 【职责】用户级偏好 REST：aliases / care / notify-prefs / translation-prefs / trusted-authors / personal-lists。
 */
import { chatFetch } from './groupClient.mjs'

/**
 * @returns {Promise<{ entities: Record<string, string>, groups: Record<string, string> }>} 别名档
 */
export async function getAliases() {
	const data = await chatFetch('/aliases')
	return { entities: data.entities || {}, groups: data.groups || {} }
}

/**
 * @param {{ entities: Record<string, string>, groups: Record<string, string> }} doc 别名档
 * @returns {Promise<{ entities: Record<string, string>, groups: Record<string, string> }>} 写入后
 */
export async function putAliases(doc) {
	const data = await chatFetch('/aliases', { method: 'PUT', json: doc })
	return { entities: data.entities || {}, groups: data.groups || {} }
}

/**
 * 列出关心的实体。
 * @returns {Promise<string[]>} cared entityHashes
 */
export async function listCaredEntities() {
	const data = await chatFetch('/care')
	return Array.isArray(data.cared) ? data.cared : []
}

/**
 * @param {string} targetEntityHash 目标
 * @param {boolean} cared 是否关心
 * @returns {Promise<string[]>} 更新后列表
 */
export async function setCaredEntity(targetEntityHash, cared) {
	const data = await chatFetch('/care', { method: 'PUT', json: { targetEntityHash, cared } })
	return Array.isArray(data.cared) ? data.cared : []
}

/**
 * @returns {Promise<Record<string, object>>} 通知偏好
 */
export async function getNotificationPreferences() {
	const data = await chatFetch('/notify-prefs')
	return data.prefs || {}
}

/**
 * @param {Record<string, object>} prefs 整档
 * @returns {Promise<Record<string, object>>} 写入后
 */
export async function putNotificationPreferences(prefs) {
	const data = await chatFetch('/notify-prefs', { method: 'PUT', json: { prefs } })
	return data.prefs || {}
}

/**
 * 读取翻译偏好。
 * @returns {Promise<object>} translation prefs
 */
export function getTranslationPrefs() {
	return chatFetch('/translation-prefs')
}

/**
 * @param {object} body prefs body
 * @returns {Promise<object>} 响应
 */
export function putTranslationPrefs(body) {
	return chatFetch('/translation-prefs', { method: 'PUT', json: body })
}

/**
 * 读取信任作者列表。
 * @returns {Promise<any>} trusted authors
 */
export function getTrustedAuthors() {
	return chatFetch('/trusted-authors')
}

/**
 * @param {object} body 请求体
 * @returns {Promise<any>} 响应
 */
export function putTrustedAuthors(body) {
	return chatFetch('/trusted-authors', { method: 'PUT', json: body })
}

/**
 * 读取个人名单（拉黑/隐藏等）。
 * @returns {Promise<any>} personal lists
 */
export function getPersonalLists() {
	return chatFetch('/personal-lists')
}
