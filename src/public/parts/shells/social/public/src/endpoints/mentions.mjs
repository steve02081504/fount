/** Social @ 提及自动补全候选。 */
import { socialRequest } from './client.mjs'

/**
 * @param {string} query 过滤词
 * @param {number} [limit=12] 数量
 * @returns {Promise<{ suggestions: object[] }>} 候选列表
 */
export function suggestMentions(query, limit = 12) {
	return socialRequest(`/mentions/suggest?q=${encodeURIComponent(query)}&limit=${limit}`)
}
