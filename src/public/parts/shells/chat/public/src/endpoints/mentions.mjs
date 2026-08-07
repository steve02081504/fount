/**
 * 【文件】public/src/endpoints/mentions.mjs
 * 【职责】群 @ 提及 autocomplete 候选查询。
 * 【关联】groupClient.mjs；hub/mentionAutocomplete.mjs。
 */
import { groupFetch, groupPath } from './groupClient.mjs'

/**
 * 查询群内 @ 提及候选（成员 / 角色 / @everyone / @here）。
 * @param {string} groupId 群 ID
 * @param {string} query 过滤词
 * @param {number} [limit] 返回条数上限
 * @returns {Promise<{ suggestions: object[] }>} 候选列表
 */
export async function suggestMentions(groupId, query, limit = 12) {
	const params = new URLSearchParams({ q: query, limit: String(limit) })
	return groupFetch(`${groupPath(groupId, 'mentions', 'suggest')}?${params}`, { method: 'GET' })
}
