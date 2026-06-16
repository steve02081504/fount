/**
 * 用户级 offline mailbox 摘要 API。
 */

/**
 * @returns {Promise<{ pending: number }>} 待处理 mailbox 条数
 */
export async function fetchMailboxSummary() {
	const resp = await fetch('/api/parts/shells:chat/mailbox/summary', { credentials: 'include' })
	if (!resp.ok) throw new Error(`HTTP ${resp.status}`)
	return resp.json()
}
