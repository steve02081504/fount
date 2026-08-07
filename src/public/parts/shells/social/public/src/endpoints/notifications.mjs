/** Social 通知：收件箱与已读水位。 */
import { socialRequest } from './client.mjs'

/**
 * @returns {Promise<{ seenAt: number }>} 已读水位
 */
export function getNotificationsSeen() {
	return socialRequest('/notifications/seen')
}

/**
 * @param {number} at 已读水位时间戳
 * @returns {Promise<void>}
 */
export function putNotificationsSeen(at) {
	return socialRequest('/notifications/seen', { method: 'PUT', body: JSON.stringify({ at }) })
}

/**
 * @param {{ limit?: number, cursor?: string, types?: string }} [options] 分页与类型过滤
 * @returns {Promise<{ notifications: object[], nextCursor: string | null, unreadCount: number }>} 通知页
 */
export function getNotifications({ limit = 40, cursor, types } = {}) {
	const cursorQuery = cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''
	const typesQuery = types && types !== 'all' ? `&types=${encodeURIComponent(types)}` : ''
	return socialRequest(`/notifications?limit=${limit}${cursorQuery}${typesQuery}`)
}
