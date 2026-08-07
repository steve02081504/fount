/**
 * 【文件】public/src/endpoints/inbox.mjs
 * 【职责】跨群 inbox REST。
 */
import { chatFetch } from './groupClient.mjs'

/**
 * @param {{ limit?: number, cursor?: string, kinds?: string[] }} [options] 分页
 * @returns {Promise<{ items: object[], nextCursor: string | null, unreadCount: number }>} 分页结果
 */
export function fetchInboxPage(options = {}) {
	const params = new URLSearchParams()
	if (options.limit) params.set('limit', String(options.limit))
	if (options.cursor) params.set('cursor', String(options.cursor))
	if (options.kinds?.length) params.set('kinds', options.kinds.join(','))
	const query = params.toString()
	return chatFetch(`/inbox${query ? `?${query}` : ''}`)
}

/**
 * @param {number} [at] 已读水位毫秒
 * @returns {Promise<any>} 响应
 */
export function markInboxSeen(at = Date.now()) {
	return chatFetch('/inbox/seen', { method: 'PUT', json: { at } })
}
