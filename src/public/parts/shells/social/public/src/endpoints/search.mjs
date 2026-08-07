/** Social 搜索。 */
import { socialRequest } from './client.mjs'

/**
 * @param {URLSearchParams | string} params 查询参数（q / sort / scope / limit / author / media / tag / cursor）
 * @returns {Promise<{ items: object[], nextCursor: string | null }>} 搜索结果页
 */
export function searchSocial(params) {
	return socialRequest(`/search?${params}`)
}
