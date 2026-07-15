import { getNotificationsSeenAt, parseNotificationTypesFilter, setNotificationsSeenAt } from '../../inbox.mjs'
import { buildNotifications } from '../../notifications.mjs'

import { makeViewerOpts } from './helpers.mjs'

/**
 * @param {import('./helpers.mjs').SocialApiContext} apiContext API 上下文
 * @returns {object} 通知方法
 */
export function createNotificationsMethods(apiContext) {
	const viewerOpts = makeViewerOpts(apiContext)
	return {
		/**
		 * @param {{ limit?: number, cursor?: string, types?: string | string[] }} [opts] 通知选项
		 * @returns {Promise<object>} 通知页
		 */
		async notifications(opts = {}) {
			const types = Array.isArray(opts.types)
				? opts.types
				: parseNotificationTypesFilter(opts.types)
			return buildNotifications(apiContext.username, {
				...viewerOpts(),
				limit: opts.limit,
				cursor: opts.cursor,
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
