/**
 * @param {import('../internal.mjs').ChatApiContext} apiContext API 上下文
 * @returns {object} 偏好 / inbox 方法
 */
export function createPreferencesMethods(apiContext) {
	return {
		/**
		 * @returns {Promise<Record<string, Record<string, { eventId: string, seq: number }>>>} 全量已读水位
		 */
		async readMarkers() {
			const { loadReadMarkers } = await import('../../chat/lib/readMarkers.mjs')
			return loadReadMarkers(apiContext.username, apiContext.entityHash)
		},
		/**
		 * @returns {{ get: Function, set: Function }} 通知偏好
		 */
		get notifications() {
			return {
				/**
				 * @returns {Promise<Record<string, object>>} 整档偏好
				 */
				async get() {
					const { loadNotificationPreferences } = await import('../../chat/lib/notificationPreferences.mjs')
					return loadNotificationPreferences(apiContext.username, apiContext.entityHash)
				},
				/**
				 * @param {Record<string, object>} prefs 整档偏好
				 * @returns {Promise<Record<string, object>>} 写入后的偏好
				 */
				async set(prefs) {
					const { saveNotificationPreferences, loadNotificationPreferences } = await import('../../chat/lib/notificationPreferences.mjs')
					saveNotificationPreferences(apiContext.username, apiContext.entityHash, prefs || {})
					return loadNotificationPreferences(apiContext.username, apiContext.entityHash)
				},
			}
		},
		/**
		 * @returns {{ list: Function, seenAt: Function, setSeenAt: Function }} inbox
		 */
		get inbox() {
			return {
				/**
				 * @param {{ limit?: number, cursor?: string, kinds?: string[] }} [options] 分页
				 * @returns {Promise<{ items: object[], nextCursor: string | null, unreadCount: number }>} 分页结果
				 */
				async list(options = {}) {
					const { listChatInbox } = await import('../../chat/lib/inbox.mjs')
					const { getState } = await import('../../chat/dag/materialize.mjs')
					const page = await listChatInbox(apiContext.username, apiContext.entityHash, options)
					/** @type {Map<string, object>} */
					const stateCache = new Map()
					const items = await Promise.all(page.items.map(async row => {
						let state = stateCache.get(row.groupId)
						if (!state) {
							state = (await getState(apiContext.username, row.groupId)).state
							stateCache.set(row.groupId, state)
						}
						return {
							...row,
							groupName: state.groupMeta?.name || row.groupId,
							channelName: state.channels?.[row.channelId]?.name || row.channelId,
						}
					}))
					return { items, nextCursor: page.nextCursor, unreadCount: page.unreadCount }
				},
				/**
				 * @returns {Promise<number>} 已读水位毫秒
				 */
				async seenAt() {
					const { getChatInboxSeenAt } = await import('../../chat/lib/inbox.mjs')
					return getChatInboxSeenAt(apiContext.username, apiContext.entityHash)
				},
				/**
				 * @param {number} [at] 已读水位毫秒
				 * @returns {Promise<number>} 写入的 seenAt
				 */
				async setSeenAt(at = Date.now()) {
					const { setChatInboxSeenAt } = await import('../../chat/lib/inbox.mjs')
					const seenAt = Number(at) || Date.now()
					setChatInboxSeenAt(apiContext.username, apiContext.entityHash, seenAt)
					return seenAt
				},
			}
		},
	}
}
