/**
 * 群表情内容解析：支持非成员按 contentHash 就近复用（CAS + 联邦）。
 */
import { Buffer } from 'node:buffer'

import { isHex64 } from 'npm:@steve02081504/fount-p2p/core/hexIds'
import { fetchChunk } from 'npm:@steve02081504/fount-p2p/files/chunk_fetch'
import { ensureUserRoom } from 'npm:@steve02081504/fount-p2p/transport/user_room'

import { getState } from '../chat/dag/materialize.mjs'
import { requestGroupEmojiFromUserRoom } from '../chat/federation/groupEmojiFederation.mjs'
import { ensureFederationRoom } from '../chat/federation/room.mjs'

import { resolveActiveMemberKeyForLocalUser } from './access.mjs'
import {
	computeEmojiContentHash,
	getGroupEmojiEntry,
	persistGroupEmojiFromDataUrl,
	readGroupEmojiBinary,
	storeEmojiInCas,
} from './groupEmojis.mjs'

/**
 * @param {string} username replica
 * @param {string} groupId 群 ID
 * @returns {Promise<boolean>} 本机是否为活跃成员
 */
async function isLocalActiveGroupMember(username, groupId) {
	try {
		const { state } = await getState(username, groupId)
		return Boolean(await resolveActiveMemberKeyForLocalUser(username, groupId, state))
	}
	catch {
		return false
	}
}

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
		await ensureUserRoom({ replicaUsername: username }).catch(() => null)
		const isMember = await isLocalActiveGroupMember(username, groupId)
		const slot = isMember ? await ensureFederationRoom(username, groupId).catch(() => null) : null
		let chunk = slot
			? await fetchChunk({
				username,
				ciphertextHash: contentHash,
				groupId,
			}).catch(() => null)
			: null
		// 非成员无群联邦 swarm：群路径 miss 后改走 user-room / TrustGraph fanout
		if (!chunk?.byteLength)
			chunk = await fetchChunk({
				username,
				ciphertextHash: contentHash,
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
		// CAS 未命中：A 可能在等待期间已主动推送 fed_emoji_data 并写入本地（replicateGroupEmojisToPeer）
		local = await readGroupEmojiBinary(username, groupId, emojiId)
		if (local) return local
	}

	const isMember = await isLocalActiveGroupMember(username, groupId)
	const slot = isMember ? await ensureFederationRoom(username, groupId).catch(() => null) : null
	await ensureUserRoom({ replicaUsername: username }).catch(() => null)
	const fetched = slot?.requestGroupEmoji
		? await slot.requestGroupEmoji(emojiId)
		: null
	const userRoomFetched = fetched?.dataUrl
		? fetched
		: await requestGroupEmojiFromUserRoom(username, groupId, emojiId)
	if (userRoomFetched?.dataUrl) {
		await persistGroupEmojiFromDataUrl(
			username,
			groupId,
			emojiId,
			userRoomFetched.dataUrl,
			userRoomFetched.mimeType,
		).catch(() => { })
		return readGroupEmojiBinary(username, groupId, emojiId)
	}

	// emoji-want 超时后再做一次本地检查：A 在等待期内推送了 fed_emoji_data 并由 handleFedEmojiData 写盘
	return readGroupEmojiBinary(username, groupId, emojiId)

}
