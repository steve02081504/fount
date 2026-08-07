/**
 * 从消息收藏 emoji pack（写入 emoji_usage.collection）。
 */
import { parseEmojiToken } from '../shared/inlineTokenSyntax.mjs'

import { addEmojiCollectionPack } from './endpoints/emoji.mjs'

/**
 * 将 pack 加入收藏。
 * @param {string} packId 表情包 ID
 * @returns {Promise<{ packId: string }>} 收藏的 packId
 */
export async function addPackToCollection(packId) {
	const id = String(packId || '').trim()
	if (!id) throw new Error('packId required')
	await addEmojiCollectionPack(id)
	return { packId: id }
}

/**
 * 将消息中的贴纸对应 pack 加入收藏。
 * @param {object} content 消息 content（type sticker）
 * @returns {Promise<{ packId: string }>} 收藏的 packId
 */
export async function saveStickerFromMessage(content) {
	if (content?.type !== 'sticker') throw new Error('no sticker in message')
	const parsed = parseEmojiToken(content.emojiRef)
	if (!parsed?.packId) throw new Error('sticker requires emojiRef')
	return addPackToCollection(parsed.packId)
}
