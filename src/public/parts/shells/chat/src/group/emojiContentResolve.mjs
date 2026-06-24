/**
 * 群表情内容解析：支持非成员按 contentHash 就近复用（CAS + 联邦）。
 */
import { Buffer } from 'node:buffer'

import { fetchChunk } from '../../../../../../scripts/p2p/files/chunk_fetch.mjs'
import { isHex64 } from '../../../../../../scripts/p2p/hexIds.mjs'
import { ensureFederationRoom } from '../chat/federation/room.mjs'

import {
	computeEmojiContentHash,
	getGroupEmojiEntry,
	persistGroupEmojiFromDataUrl,
	readGroupEmojiBinary,
	storeEmojiInCas,
} from './groupEmojis.mjs'

/**
 * @param {string} username 用户
 * @param {string} groupId 群 ID
 * @param {string} emojiId 表情 ID
 * @param {{ contentHash?: string }} [options] 可选 contentHash（如 Social mediaRef 或查询参数）
 * @returns {Promise<{ buffer: Buffer, mimeType: string, entry: object } | null>} 表情二进制或 null。
 */
export async function resolveGroupEmojiContent(username, groupId, emojiId, options = {}) {
	let local = await readGroupEmojiBinary(username, groupId, emojiId)
	if (local) {
		if (!local.entry.contentHash) {
			const contentHash = await storeEmojiInCas(local.buffer).catch(() => null)
			if (contentHash) local.entry.contentHash = contentHash
		}
		return local
	}

	const entry = await getGroupEmojiEntry(username, groupId, emojiId)
	const hintedHash = String(options.contentHash || '').trim().toLowerCase()
	const contentHash = entry?.contentHash || (isHex64(hintedHash) ? hintedHash : null)
	const mimeType = entry?.mimeType || 'image/png'

	if (contentHash) {
		await ensureFederationRoom(username, groupId).catch(() => null)
		const chunk = await fetchChunk({
			username,
			ciphertextHash: contentHash,
			groupId,
		}).catch(() => null)
		if (chunk?.byteLength) {
			const buffer = Buffer.from(chunk)
			await persistGroupEmojiFromDataUrl(
				username,
				groupId,
				emojiId,
				`data:${mimeType};base64,${buffer.toString('base64')}`,
				mimeType,
				entry?.name,
			).catch(() => { })
			local = await readGroupEmojiBinary(username, groupId, emojiId)
			if (local) return local
			return {
				buffer,
				mimeType,
				entry: { ...entry || { emojiId }, contentHash: contentHash || computeEmojiContentHash(buffer) },
			}
		}
	}

	const slot = await ensureFederationRoom(username, groupId).catch(() => null)
	const fetched = slot?.requestGroupEmoji
		? await slot.requestGroupEmoji(emojiId)
		: null
	if (fetched?.dataUrl) {
		await persistGroupEmojiFromDataUrl(
			username,
			groupId,
			emojiId,
			fetched.dataUrl,
			fetched.mimeType,
		).catch(() => { })
		return readGroupEmojiBinary(username, groupId, emojiId)
	}

	return null
}
