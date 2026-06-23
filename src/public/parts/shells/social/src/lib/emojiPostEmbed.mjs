/**
 * 扫描帖子正文中的群表情 token 并提取 contentHash 引用。
 */
import { createHash } from 'node:crypto'

import { fetchChunk } from '../../../../../../scripts/p2p/files/chunk_fetch.mjs'
import { getGroupEmojiEntry, readGroupEmojiBinary, storeEmojiInCas } from '../../../chat/src/group/groupEmojis.mjs'

const EMOJI_TOKEN = /:\[([\w.-]+)\/([\w.-]+)]:/g

/**
 * @param {string} text 帖子正文
 * @returns {Array<{ groupId: string, emojiId: string }>} 表情引用列表。
 */
export function scanEmojiTokens(text) {
	const refs = []
	const seen = new Set()
	for (const match of String(text || '').matchAll(EMOJI_TOKEN)) {
		const key = `${match[1]}/${match[2]}`
		if (seen.has(key)) continue
		seen.add(key)
		refs.push({ groupId: match[1], emojiId: match[2] })
	}
	return refs
}

/**
 * best-effort 将帖子中引用的表情写入 CAS 并返回 mediaRefs。
 * @param {string} username 发帖用户
 * @param {string} text 帖子正文
 * @returns {Promise<object[]>} mediaRefs 数组。
 */
export async function buildEmojiMediaRefsForPost(username, text) {
	const refs = scanEmojiTokens(text)
	/** @type {object[]} */
	const mediaRefs = []
	for (const { groupId, emojiId } of refs) 
		try {
			let contentHash = (await getGroupEmojiEntry(username, groupId, emojiId))?.contentHash
			if (!contentHash) {
				const local = await readGroupEmojiBinary(username, groupId, emojiId)
				if (local?.buffer)
					contentHash = await storeEmojiInCas(local.buffer)
			}
			if (!contentHash) {
				const chunk = await fetchChunk({ username, ciphertextHash: createHash('sha256').update(`${groupId}/${emojiId}`).digest('hex') }).catch(() => null)
				void chunk
			}
			if (contentHash)
				mediaRefs.push({ kind: 'groupEmoji', groupId, emojiId, contentHash })
		}
		catch { /* best-effort */ }
	
	return mediaRefs
}
