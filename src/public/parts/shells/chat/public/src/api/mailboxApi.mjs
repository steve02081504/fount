import { CHAT_API_CLIENT_PREFIX } from '../../shared/apiPaths.mjs'

/**
 * 用户级 offline mailbox 摘要 API。
 */

/**
 * @returns {Promise<{ pendingCount: number }>} 待处理 mailbox 条数
 */
export async function fetchMailboxSummary() {
	const resp = await fetch(`${CHAT_API_CLIENT_PREFIX}/mailbox/summary`, { credentials: 'include' })
	if (!resp.ok) throw new Error(`HTTP ${resp.status}`)
	return resp.json()
}
