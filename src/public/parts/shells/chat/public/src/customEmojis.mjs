/**
 * 【文件】public/src/customEmojis.mjs
 * 【职责】用户级自定义表情库：列表、从群消息保存、解析文本中首个 emoji ref。
 * 【原理】REST /custom-emojis；saveCustomEmojiFromRef 复制群表情到用户 shellData。
 * 【数据结构】entries[] { groupId, emojiId, ... }；:[emoji:group/emoji]: token。
 * 【关联】markdown_extensions/index.mjs、groupEmojiApi.mjs。
 */
import { EMOJI_TOKEN_RE } from '../shared/inlineTokenSyntax.mjs'

import { putCachedEmojiDataUrl, resolveEmojiUrlBestEffort } from './emojiCache.mjs'

/**
 * 读取用户级已保存自定义表情。
 * @returns {Promise<object[]>} shellData 中的 `entries` 列表
 */
export async function listCustomEmojis() {
	const r = await fetch('/api/parts/shells:chat/custom-emojis', { credentials: 'include' })
	const data = await r.json()
	if (!r.ok) throw new Error(data.error || 'load custom emojis failed')
	return Array.isArray(data.entries) ? data.entries : []
}

/**
 * 将 `:[emoji:groupId/emojiId]:` 引用的表情保存到 shellData 并写入 IndexedDB 缓存。
 * @param {string} groupId 来源群
 * @param {string} emojiId 表情 id
 * @returns {Promise<object>} 保存后的条目
 */
export async function saveCustomEmojiFromRef(groupId, emojiId) {
	const url = await resolveEmojiUrlBestEffort(groupId, emojiId)
	if (!url) throw new Error('emoji not available locally')
	const r = await fetch('/api/parts/shells:chat/custom-emojis/save', {
		method: 'POST',
		credentials: 'include',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ groupId, emojiId, dataUrl: url }),
	})
	const data = await r.json()
	if (!r.ok) throw new Error(data.error || 'save failed')
	await putCachedEmojiDataUrl(groupId, emojiId, url)
	return data.entry
}

/**
 * 从消息正文中提取首个自定义表情引用。
 * @param {string} text 消息文本
 * @returns {{ groupId: string, emojiId: string } | null} 首个匹配，无则 null
 */
export function firstCustomEmojiRef(text) {
	const s = String(text || '')
	EMOJI_TOKEN_RE.lastIndex = 0
	const m = EMOJI_TOKEN_RE.exec(s)
	if (!m) return null
	return { groupId: m[1], emojiId: m[2] }
}
