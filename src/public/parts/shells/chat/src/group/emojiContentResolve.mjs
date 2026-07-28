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
	findPackAcrossGroups,
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
 * @param {string} username 用户名
 * @param {string} groupId 群 ID
 * @param {string} emojiId 表情 ID
 * @param {{ contentHash?: string, packId?: string }} [options] 可选 contentHash / packId
 * @returns {Promise<{ buffer: Buffer, mimeType: string, entry: object, packId?: string } | null>} 表情二进制
 */
export async function resolveGroupEmojiContent(username, groupId, emojiId, options = {}) {
	const packId = String(options.packId || '').trim() || undefined
	let local = await readGroupEmojiBinary(username, groupId, emojiId, packId)
	if (local) {
		if (!local.entry.contentHash) {
			const contentHash = await storeEmojiInCas(local.buffer).catch(() => null)
			if (contentHash) local.entry.contentHash = contentHash
		}
		return local
	}

	const entry = await getGroupEmojiEntry(username, groupId, emojiId, packId)
	const hintedHash = String(options.contentHash || '').trim().toLowerCase()
	const contentHash = entry?.contentHash || (isHex64(hintedHash) ? hintedHash : null)
	const mimeType = entry?.mimeType || 'image/png'
	const resolvedPackId = packId || local?.packId || groupId

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
				resolvedPackId,
			).catch(() => { })
			local = await readGroupEmojiBinary(username, groupId, emojiId, resolvedPackId)
			if (local) return local
			return {
				buffer,
				mimeType,
				entry: { ...entry || { emojiId }, contentHash: contentHash || computeEmojiContentHash(buffer) },
				packId: resolvedPackId,
			}
		}
		local = await readGroupEmojiBinary(username, groupId, emojiId, resolvedPackId)
		if (local) return local
	}

	const isMember = await isLocalActiveGroupMember(username, groupId)
	const slot = isMember ? await ensureFederationRoom(username, groupId).catch(() => null) : null
	await ensureUserRoom({ replicaUsername: username }).catch(() => null)
	const fetched = slot?.requestGroupEmoji
		? await slot.requestGroupEmoji(emojiId, resolvedPackId)
		: null
	const userRoomFetched = fetched?.dataUrl
		? fetched
		: await requestGroupEmojiFromUserRoom(username, groupId, emojiId, resolvedPackId)
	if (userRoomFetched?.dataUrl) {
		await persistGroupEmojiFromDataUrl(
			username,
			groupId,
			emojiId,
			userRoomFetched.dataUrl,
			userRoomFetched.mimeType,
			undefined,
			resolvedPackId,
		).catch(() => { })
		return readGroupEmojiBinary(username, groupId, emojiId, resolvedPackId)
	}

	return readGroupEmojiBinary(username, groupId, emojiId, resolvedPackId)
}

/**
 * 按全局 packId 解析内容（扫本机群目录定位 pack）。
 * @param {string} username 用户名
 * @param {string} packId 表情包 ID
 * @param {string} emojiId 表情 ID
 * @param {{ contentHash?: string }} [options] 可选 contentHash
 * @returns {Promise<{ buffer: Buffer, mimeType: string, entry: object, packId?: string } | null>} 表情二进制
 */
export async function resolvePackEmojiContent(username, packId, emojiId, options = {}) {
	const located = await findPackAcrossGroups(username, packId)
	if (located)
		return resolveGroupEmojiContent(username, located.groupId, emojiId, {
			contentHash: options.contentHash,
			packId,
		})

	const { findPackAcrossEntities, readEntityPackEmojiBinary } = await import('../entity/entityEmojis.mjs')
	const entityLocated = await findPackAcrossEntities(packId)
	if (!entityLocated) return null
	const local = await readEntityPackEmojiBinary(
		entityLocated.replicaUsername,
		entityLocated.authorEntityHash,
		packId,
		emojiId,
	)
	if (local) return local

	const entry = (entityLocated.manifest?.items || []).find(row => row?.emojiId === emojiId)
	const hintedHash = String(options.contentHash || '').trim().toLowerCase()
	const contentHash = entry?.contentHash || (isHex64(hintedHash) ? hintedHash : null)
	if (!contentHash) return null

	await ensureUserRoom({ replicaUsername: username }).catch(() => null)
	const chunk = await fetchChunk({
		username,
		ciphertextHash: contentHash,
	}).catch(() => null)
	if (!chunk?.byteLength) return null
	const buffer = Buffer.from(chunk)
	const mimeType = entry?.mimeType || 'image/png'
	return {
		buffer,
		mimeType,
		entry: { ...entry || { emojiId }, contentHash },
		packId,
	}
}
