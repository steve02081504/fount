import { getNotificationsSeenAt, parseNotificationTypesFilter, setNotificationsSeenAt } from '../../inbox.mjs'
import { buildNotifications } from '../../notifications.mjs'

import { makeViewerOptions } from './helpers.mjs'

/**
 * @param {import('./helpers.mjs').SocialApiContext} apiContext API 上下文
 * @returns {object} 通知方法
 */
export function createNotificationsMethods(apiContext) {
	const viewerOptions = makeViewerOptions(apiContext)
	return {
		/**
		 * @param {{ limit?: number, cursor?: string, types?: string | string[] }} [options] 通知选项
		 * @returns {Promise<object>} 通知页
		 */
		async notifications(options = {}) {
			const types = Array.isArray(options.types)
				? options.types
				: parseNotificationTypesFilter(options.types)
			return buildNotifications(apiContext.username, {
				...viewerOptions(),
				limit: options.limit,
				cursor: options.cursor,
				types,
			})
		},
		/**
		 * @returns {Promise<number>} 已读水位
		 */
		async notificationsSeenAt() {
			return getNotificationsSeenAt(apiContext.username, apiContext.entityHash)
		},
		/**
		 * @param {number} [ts] 水位；缺省 = now
		 * @returns {Promise<number>} 写入后的水位
		 */
		async setNotificationsSeenAt(ts) {
			const at = Number(ts) || Date.now()
			setNotificationsSeenAt(apiContext.username, apiContext.entityHash, at)
			return at
		},
	}
}
