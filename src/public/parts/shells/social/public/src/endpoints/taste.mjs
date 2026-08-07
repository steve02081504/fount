/** Social 品味标签（口味画像）：读取、隐私、重建、重命名。 */
import { socialRequest } from './client.mjs'

/**
 * 读取本机品味画像。
 * @returns {Promise<{ tags: object[], privacy: object }>} 品味画像
 */
export function getTaste() {
	return socialRequest('/taste')
}

/**
 * 更新品味隐私开关。
 * @param {{ publishPreferences?: boolean, publishReactions?: boolean }} privacy 隐私设置
 * @returns {Promise<object>} 写入结果
 */
export function putTastePrivacy(privacy) {
	return socialRequest('/taste', { method: 'PUT', body: JSON.stringify({ privacy }) })
}

/**
 * 触发品味标签重建。
 * @returns {Promise<object>} 重建结果
 */
export function rebuildTaste() {
	return socialRequest('/taste/rebuild', { method: 'POST' })
}

/**
 * 重命名品味标签本地展示名。
 * @param {string} tagHash 标签 hash
 * @param {string} label 展示名
 * @param {string} locale 语言
 * @returns {Promise<object>} 写入结果
 */
export function renameTasteTag(tagHash, label, locale) {
	return socialRequest('/taste/names', {
		method: 'POST',
		body: JSON.stringify({ tagHash, label, locale }),
	})
}
