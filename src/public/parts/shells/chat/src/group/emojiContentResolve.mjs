/**
 * 群表情内容解析：支持非成员按 contentHash 就近复用（CAS + 联邦）。
 */
import { Buffer } from 'node:buffer'

import { fetchChunk } from '../../../../../../scripts/p2p/files/chunk_fetch.mjs'
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
 * @returns {Promise<{ buffer: Buffer, mimeType: string, entry: object } | null>}
 */
export async function resolveGroupEmojiContent(username, groupId, emojiId) {
	let local = await readGroupEmojiBinary(username, groupId, emojiId)
	if (local) {
		if (!local.entry.contentHash) {
			const contentHash = await storeEmojiInCas(local.buffer).catch(() => null)
			if (contentHash) local.entry.contentHash = contentHash
		}
		return local
	}

	const entry = await getGroupEmojiEntry(username, groupId, emojiId)
	const contentHash = entry?.contentHash

	if (contentHash) {
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
				`data:${entry.mimeType || 'image/png'};base64,${buffer.toString('base64')}`,
				entry.mimeType || 'image/png',
				entry.name,
			).catch(() => { })
			local = await readGroupEmojiBinary(username, groupId, emojiId)
			if (local) return local
			return {
				buffer,
				mimeType: entry.mimeType || 'image/png',
				entry: { ...entry, contentHash: contentHash || computeEmojiContentHash(buffer) },
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
