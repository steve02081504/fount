/**
 * 【文件】public/src/groupEmojiApi.mjs
 * 【职责】群自定义表情 data URL 路径与 fetch（浏览器侧）。
 * 【原理】groupEmojiDataApiPath 拼 REST URL；fetchGroupEmojiDataUrl blob→object URL。
 * 【数据结构】groupId、emojiId。
 * 【关联】chatMarkdown、customEmojis；后端群 emoji 存储。
 */
/**
 * 群自定义表情 data API 路径（浏览器侧）。
 * @param {string} groupId 群 ID
 * @param {string} emojiId 表情 ID
 * @returns {string} API URL
 */
export function groupEmojiDataApiPath(groupId, emojiId) {
	return `/api/parts/shells:chat/groups/${encodeURIComponent(groupId)}/emojis/${encodeURIComponent(emojiId)}/data`
}

/**
 * 拉取群表情 data URL（含服务端 P2P 回退）。
 * @param {string} groupId 群 ID
 * @param {string} emojiId 表情 ID
 * @returns {Promise<string | null>} data URL
 */
export async function fetchGroupEmojiDataUrl(groupId, emojiId) {
	const url = `${groupEmojiDataApiPath(groupId, emojiId)}?json=1`
	const resp = await fetch(url, { credentials: 'include', headers: { Accept: 'application/json' } })
	if (!resp.ok) return null
	const data = await resp.json()
	return data?.dataUrl || null
}
