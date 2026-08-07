/**
 * 【文件】public/src/endpoints/groupBookmarks.mjs
 * 【职责】Hub 侧栏书签 CRUD：读写用户级 chat bookmarks 列表。
 * 【原理】GET/PUT /bookmarks 全量；POST/DELETE 由服务端原子 add/remove，避免客户端 RMW 竞态。
 * 【关联】Hub 侧栏导航、messages/actions/bookmark.mjs。
 */
import { chatFetch } from './groupClient.mjs'

/**
 * 读取 Hub 侧栏书签列表。
 * @returns {Promise<object[]>} 书签条目数组（含 eventId / title / href 等）
 */
export async function getChatBookmarks() {
	const data = await chatFetch('/bookmarks')
	return Array.isArray(data.entries) ? data.entries : []
}

/**
 * 全量覆盖保存书签。
 * @param {object[]} entries 书签条目
 * @returns {Promise<void>}
 */
export async function saveChatBookmarks(entries) {
	await chatFetch('/bookmarks', { method: 'PUT', json: { entries } })
}

/**
 * 追加一条书签（服务端同群同事件去重）。
 * @param {object} entry 书签条目（eventId、title、href 等）
 * @returns {Promise<boolean>} 是否新增成功
 */
export async function addChatBookmark(entry) {
	const data = await chatFetch('/bookmarks', { method: 'POST', json: { entry } })
	return data.added !== false
}

/**
 * 删除一条书签（按 groupId + eventId，回落 href）。
 * @param {{ groupId?: string, eventId?: string, href?: string }} entry 书签条目
 * @returns {Promise<void>}
 */
export async function removeChatBookmark(entry) {
	await chatFetch('/bookmarks', { method: 'DELETE', json: { entry } })
}
