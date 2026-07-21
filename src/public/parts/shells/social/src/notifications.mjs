
import { resolveOperatorEntityHashForUser as resolveOperatorEntityHash } from '../../chat/src/entity/identity.mjs'

import { readInboxNotifications, notificationCursor } from './inbox.mjs'

/**
 *
 */
export { notificationCursor }

/**
 * 构建观看者的 Social 通知列表（inbox 持久层）。
 * @param {string} username 用户
 * @param {object} [options] 分页选项
 * @param {string} [options.viewerEntityHash] 观看实体；缺省 = operator
 * @param {number} [options.limit=30] 条数上限
 * @param {string} [options.cursor] 分页游标
 * @param {string[] | null} [options.types] 类型过滤
 * @returns {Promise<{ notifications: object[], nextCursor: string | null, unreadCount: number, viewerEntityHash: string | null }>} 通知列表
 */
export async function buildNotifications(username, options = {}) {
	const viewerEntityHash = String(options.viewerEntityHash || '').trim().toLowerCase()
		|| (await resolveOperatorEntityHash(username))?.toLowerCase()
		|| null
	if (!viewerEntityHash)
		return { notifications: [], nextCursor: null, unreadCount: 0, viewerEntityHash: null }
	const page = await readInboxNotifications(username, viewerEntityHash, options)
	return { ...page, viewerEntityHash }
}
