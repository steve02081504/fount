/**
 * 【文件】public/src/api/groupBookmarks.mjs
 * 【职责】Hub 侧栏书签 CRUD：读写用户级 chat bookmarks 列表。
 * 【原理】GET/PUT /api/parts/shells:chat/bookmarks；add/remove 在客户端合并数组后 saveChatBookmarks。
 * 【数据结构】书签条目 { groupId, channelId?, label? } 数组。
 * 【关联】Hub 侧栏导航；独立 sessions API。
 */
/**
 * 读取 Hub 侧栏书签列表。
 * @returns {Promise<object[]>} 书签条目数组
 */
export async function getChatBookmarks() {
	const response = await fetch('/api/parts/shells:chat/bookmarks', { credentials: 'include' })
	const data = await response.json()
	if (!response.ok) throw new Error('Failed to fetch bookmarks')
	return Array.isArray(data.entries) ? data.entries : []
}

/**
 * 全量覆盖保存书签。
 * @param {object[]} entries 书签条目
 * @returns {Promise<void>}
 */
export async function saveChatBookmarks(entries) {
	const response = await fetch('/api/parts/shells:chat/bookmarks', {
		method: 'PUT',
		credentials: 'include',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ entries }),
	})
	const data = await response.json()
	if (!response.ok) throw new Error(data.error || 'Failed to save bookmarks')
}

/**
 * 追加一条书签（同群同事件去重）。
 * @param {object} entry 书签条目
 * @returns {Promise<boolean>} 是否新增成功
 */
export async function addChatBookmark(entry) {
	const entries = await getChatBookmarks()
	const groupId = String(entry.groupId || '')
	const eventId = String(entry.eventId)
	if (groupId && eventId && entries.some(bookmark => bookmark?.groupId === groupId && bookmark?.eventId === eventId))
		return false
	entries.push(entry)
	await saveChatBookmarks(entries)
	return true
}

/**
 * 删除一条书签（按 groupId + eventId 匹配，回落 href 匹配）。
 * @param {{ groupId?: string, eventId?: string, href?: string }} entry 书签条目
 * @returns {Promise<void>}
 */
export async function removeChatBookmark(entry) {
	const entries = await getChatBookmarks()
	const groupId = String(entry.groupId || '')
	const eventId = String(entry.eventId || '')
	const href = String(entry.href || '')
	const next = entries.filter(bookmark => {
		if (eventId) return !(String(bookmark?.groupId || '') === groupId && String(bookmark?.eventId || '') === eventId)
		if (href) return String(bookmark?.href || '') !== href
		return true
	})
	if (next.length !== entries.length) await saveChatBookmarks(next)
}
