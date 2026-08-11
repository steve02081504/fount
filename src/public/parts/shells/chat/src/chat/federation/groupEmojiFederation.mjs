/**
 * 【文件】federation/groupEmojiFederation.mjs
 * 【职责】群表情经 P2P fed_emoji_want/data/manifest 在邻居间拉取与缓存。
 * 【原理】attachFedEmojiHandlers 在 room join 时注册；本地有二进制则响应 dataUrl。载荷含 packId（缺省回落 groupId）。
 */
import { isPlainObject } from 'npm:@steve02081504/fount-p2p/core/object'
import { consumeWireRateBucket } from 'npm:@steve02081504/fount-p2p/wire/rate_bucket'

import { isSafePackId } from '../../emojiPacks/packStore.mjs'
import {
	bufferToDataUrl,
	listGroupPacks,
	persistGroupEmojiFromDataUrl,
	readGroupEmojiBinary,
	upsertGroupEmojiManifestEntry,
} from '../../group/groupEmojis.mjs'

import { bindFedSender } from './outbound.mjs'
import { isFederationActionAllowedUnderLoad } from './roomLoadBudget.mjs'
import { wireAction } from './wireAction.mjs'

const FETCH_TIMEOUT_MS = 14_000
const EMOJI_WANT_MAX_PER_MIN = 30
const EMOJI_WANT_BUCKET_KEY = 'emoji_want'

/** @type {Map<string, { resolve: (v: { dataUrl: string, mimeType: string }) => void, timer: ReturnType<typeof setTimeout> }>} */
const pendingFetches = new Map()

/**
 * @param {string} bucketKey 房间键
 * @returns {boolean} 是否允许 want
 */
function consumeEmojiWant(bucketKey) {
	return consumeWireRateBucket(bucketKey, { maxCount: EMOJI_WANT_MAX_PER_MIN })
}

/**
 * @param {string} username 用户名
 * @param {string} groupId 群 ID
 * @param {string} emojiId 表情 ID
 * @param {string} [packId] 参数
 * @returns {string} 返回值
 */
function waitKey(username, groupId, emojiId, packId) {
	const pid = String(packId || groupId || '').trim()
	return `${username}\0${groupId}\0${pid}\0${emojiId}`
}

/**
 * @param {unknown} data 载荷
 * @param {string} groupId 群 ID
 * @returns {string} 返回值
 */
function resolvePayloadPackId(data, groupId) {
	const raw = String(data?.packId || '').trim()
	if (raw && isSafePackId(raw)) return raw
	return groupId
}

/**
 * 处理入站 `fed_emoji_want`：本地有则回复 `fed_emoji_data`。
 * @param {string} username 用户名
 * @param {string} groupId 群 ID
 * @param {unknown} data 载荷
 * @param {string} peerId 对端
 * @param {(payload: unknown, peerId: string) => void} sendEmojiData 发送 fed_emoji_data
 * @param {(id: string) => boolean} isBlockedPeer 拉黑检查
 * @param {Map<string, string>} peerToNode peer→node 映射
 * @returns {Promise<void>} 返回值
 */
export async function handleFedEmojiWant(username, groupId, data, peerId, sendEmojiData, isBlockedPeer, peerToNode) {
	if (!isPlainObject(data)) return
	if (!consumeEmojiWant(waitKey(username, groupId, EMOJI_WANT_BUCKET_KEY))) return
	const remoteNode = peerToNode.get(peerId)
	if (remoteNode && isBlockedPeer(remoteNode)) return
	const emojiId = String(data.emojiId || '').trim()
	if (!emojiId) return
	const packId = resolvePayloadPackId(data, groupId)
	const local = await readGroupEmojiBinary(username, groupId, emojiId, packId)
	if (!local) return
	const dataUrl = bufferToDataUrl(local.buffer, local.mimeType)
	try {
		sendEmojiData({ emojiId, packId: local.packId || packId, dataUrl, mimeType: local.mimeType }, peerId)
	}
	catch (error) {
		console.warn('federation: fed_emoji_data send failed', error)
	}
}

/**
 * 处理入站 `fed_emoji_data`：写入本地并兑现等待中的 Promise。
 * @param {string} username 用户名
 * @param {string} groupId 群 ID
 * @param {unknown} data 载荷
 * @returns {Promise<void>} 返回值
 */
export async function handleFedEmojiData(username, groupId, data) {
	if (!isPlainObject(data)) return
	const emojiId = String(data.emojiId || '').trim()
	const dataUrl = String(data.dataUrl || '').trim()
	const mimeType = String(data.mimeType || 'image/png')
	const packId = resolvePayloadPackId(data, groupId)
	if (!emojiId || !/^data:[^;]+;base64,.+$/u.test(dataUrl)) return
	const key = waitKey(username, groupId, emojiId, packId)
	const pending = pendingFetches.get(key)
	if (pending) {
		clearTimeout(pending.timer)
		pendingFetches.delete(key)
		pending.resolve({ dataUrl, mimeType })
	}
	await persistGroupEmojiFromDataUrl(username, groupId, emojiId, dataUrl, mimeType, undefined, packId)
		.catch(error => console.warn('federation: fed_emoji_data persist failed', error))
}

/**
 * 处理入站 `fed_emoji_manifest`：合并远端 manifest 条目。
 * @param {string} username 用户名
 * @param {string} groupId 群 ID
 * @param {unknown} data 载荷
 * @returns {Promise<void>} 返回值
 */
export async function handleFedEmojiManifest(username, groupId, data) {
	if (!isPlainObject(data)) return
	const emojiId = String(data.emojiId || '').trim()
	if (!emojiId) return
	const packId = resolvePayloadPackId(data, groupId)
	await upsertGroupEmojiManifestEntry(username, groupId, {
		emojiId,
		packId,
		name: data.name,
		mimeType: data.mimeType,
		ext: data.ext,
		animated: data.animated,
		contentHash: data.contentHash,
		uploadedBy: 'federation',
	}).catch(error => console.warn('federation: fed_emoji_manifest persist failed', error))
}

/**
 * 经 user-room node scope 向邻居索要群表情。
 * @param {string} username 用户名
 * @param {string} groupId 群 ID
 * @param {string} emojiId 表情 ID
 * @param {string} [packId] 表情包 ID
 * @returns {Promise<{ dataUrl: string, mimeType: string } | null>} 拉取结果
 */
export async function requestGroupEmojiFromUserRoom(username, groupId, emojiId, packId) {
	if (!consumeEmojiWant(waitKey(username, groupId, EMOJI_WANT_BUCKET_KEY))) return null
	const pid = String(packId || groupId).trim() || groupId
	const key = waitKey(username, groupId, emojiId, pid)
	const payload = { groupId, emojiId, packId: pid }
	const resultPromise = new Promise(resolve => {
		const timer = setTimeout(() => {
			pendingFetches.delete(key)
			resolve(null)
		}, FETCH_TIMEOUT_MS)
		pendingFetches.set(key, { resolve, timer })
	})
	const { ensureUserRoom, deliverToUserRoomPeers } = await import('npm:@steve02081504/fount-p2p/transport/user_room')
	const { DEFAULT_TRUST_GRAPH_OWNER, requireTrustGraphProvider } = await import('npm:@steve02081504/fount-p2p/trust_graph/registry')
	await ensureUserRoom({ replicaUsername: username })
	await deliverToUserRoomPeers(username, 'fed_emoji_want', payload)
	await requireTrustGraphProvider(DEFAULT_TRUST_GRAPH_OWNER).fanoutToTopNodes(username, 'fed_emoji_want', payload, 6)
	return await resultPromise
}

/**
 * 在 node scope user-room 注册 fed_emoji_*。
 * @param {string} username 用户名
 * @param {{ on: (name: string, handler: (payload: unknown, peerId: string) => void) => void, send: (name: string, payload: unknown, peerId: string | null) => void }} wire user-room wire
 * @returns {void} 返回值
 */
export function attachUserRoomEmojiHandlers(username, wire) {
	wire.on('fed_emoji_want', (data, peerId) => {
		if (!isPlainObject(data)) return
		const groupId = String(data.groupId || '').trim()
		if (!groupId) return
		void handleFedEmojiWant(
			username,
			groupId,
			data,
			peerId,
			(payload, targetPeerId) => wire.send('fed_emoji_data', { ...payload, groupId }, targetPeerId),
			() => false,
			new Map(),
		).catch(error => console.warn('federation: user-room fed_emoji_want failed', error))
	})
	wire.on('fed_emoji_data', data => {
		if (!isPlainObject(data)) return
		const groupId = String(data.groupId || '').trim()
		if (!groupId) return
		void handleFedEmojiData(username, groupId, data)
			.catch(error => console.warn('federation: user-room fed_emoji_data failed', error))
	})
	wire.on('fed_emoji_manifest', data => {
		if (!isPlainObject(data)) return
		const groupId = String(data.groupId || '').trim()
		if (!groupId) return
		void handleFedEmojiManifest(username, groupId, data)
			.catch(error => console.warn('federation: user-room fed_emoji_manifest failed', error))
	})
}

/**
 * 向联邦邻居广播索要群表情。
 * @param {string} username 用户名
 * @param {string} groupId 群 ID
 * @param {string} emojiId 表情 ID
 * @param {object | null} slot 联邦槽
 * @param {string} [packId] 表情包 ID
 * @returns {Promise<{ dataUrl: string, mimeType: string } | null>} 拉取结果
 */
export async function requestGroupEmojiFromPeers(username, groupId, emojiId, slot, packId) {
	if (!slot) return null
	if (!consumeEmojiWant(waitKey(username, groupId, EMOJI_WANT_BUCKET_KEY))) return null
	if (!slot.sendEmojiWant) return null
	const pid = String(packId || groupId).trim() || groupId
	const key = waitKey(username, groupId, emojiId, pid)
	return await new Promise(resolve => {
		const timer = setTimeout(() => {
			pendingFetches.delete(key)
			resolve(null)
		}, FETCH_TIMEOUT_MS)
		pendingFetches.set(key, { resolve, timer })
		const roster = slot.getRoster()
		const payload = { emojiId, packId: pid }
		for (const { peerId } of roster)
			try {
				slot.sendEmojiWant(payload, peerId)
			}
			catch (error) {
				console.warn('federation: fed_emoji_want send failed', error)
			}
	})
}

/**
 * 经 user-room 推送 manifest。
 * @param {string} username 用户名
 * @param {string} groupId 群 ID
 * @param {object} entry manifest 条目
 * @returns {Promise<void>} 返回值
 */
export async function replicateGroupEmojiManifestToUserRoom(username, groupId, entry) {
	if (!entry?.emojiId) return
	const packId = String(entry.packId || groupId).trim() || groupId
	const { deliverToUserRoomPeers } = await import('npm:@steve02081504/fount-p2p/transport/user_room')
	await deliverToUserRoomPeers(username, 'fed_emoji_manifest', {
		groupId,
		packId,
		emojiId: entry.emojiId,
		name: entry.name,
		mimeType: entry.mimeType,
		ext: entry.ext,
		animated: entry.animated,
		contentHash: entry.contentHash,
	})
}

/**
 * 向联邦邻居广播群表情 manifest 条目。
 * @param {string} username 用户名
 * @param {string} groupId 群 ID
 * @param {object} entry manifest 条目
 * @param {object | null} slot 联邦槽
 * @returns {Promise<void>} 返回值
 */
export async function replicateGroupEmojiManifestToFederation(username, groupId, entry, slot) {
	if (!slot?.sendEmojiManifest || !entry?.emojiId) return
	const packId = String(entry.packId || groupId).trim() || groupId
	const payload = {
		packId,
		emojiId: entry.emojiId,
		name: entry.name,
		mimeType: entry.mimeType,
		ext: entry.ext,
		animated: entry.animated,
		contentHash: entry.contentHash,
	}
	for (let attempt = 0; attempt < 120; attempt++) {
		const roster = slot.getRoster()
		if (roster.length) {
			for (const { peerId } of roster)
				try {
					slot.sendEmojiManifest(payload, peerId)
				}
				catch (error) {
					console.warn('federation: fed_emoji_manifest replicate failed', error)
				}
			return
		}
		await new Promise(resolve => setTimeout(resolve, 500))
	}
}

/**
 * 上传后向邻居推送群表情数据。
 * @param {string} username 用户名
 * @param {string} groupId 群 ID
 * @param {string} emojiId 表情 ID
 * @param {object | null} slot 联邦槽
 * @param {string} [packId] 参数
 * @returns {Promise<void>} 返回值
 */
export async function replicateGroupEmojiToFederation(username, groupId, emojiId, slot, packId) {
	if (!slot) return
	const pid = String(packId || groupId).trim() || groupId
	const local = await readGroupEmojiBinary(username, groupId, emojiId, pid)
	if (!local) return
	if (!slot.sendEmojiData) return
	const dataUrl = bufferToDataUrl(local.buffer, local.mimeType)
	const payload = { emojiId, packId: local.packId || pid, dataUrl, mimeType: local.mimeType }
	for (let attempt = 0; attempt < 120; attempt++) {
		const roster = slot.getRoster()
		if (roster.length) {
			for (const { peerId } of roster)
				try {
					slot.sendEmojiData(payload, peerId)
				}
				catch (error) {
					console.warn('federation: fed_emoji_data replicate failed', error)
				}
			return
		}
		await new Promise(resolve => setTimeout(resolve, 500))
	}
}

/**
 * 新 peer 入房时推送本群 pack manifest；二进制由对端按需 `fed_emoji_want`。
 * @param {string} username 用户名
 * @param {string} groupId 群 ID
 * @param {string} peerId 对端
 * @param {object | null} slot 联邦槽
 * @returns {Promise<void>} 返回值
 */
export async function replicateGroupEmojisToPeer(username, groupId, peerId, slot) {
	if (!slot?.sendEmojiManifest || !peerId) return
	const packs = await listGroupPacks(username, groupId)
	for (const pack of packs) {
		const packId = pack.packId
		for (const entry of pack.items || []) {
			const emojiId = String(entry?.emojiId || '').trim()
			if (!emojiId) continue
			try {
				slot.sendEmojiManifest({
					packId,
					emojiId,
					name: entry.name,
					mimeType: entry.mimeType,
					ext: entry.ext,
					animated: entry.animated,
					contentHash: entry.contentHash,
				}, peerId)
			}
			catch (error) {
				console.warn('federation: fed_emoji_manifest peer replicate failed', error)
			}
		}
	}
}

/**
 * 在联邦房间注册 `fed_emoji_*` 处理器。
 * @param {object} roomContext 房间上下文
 * @returns {void} 返回值
 */
export function attachFedEmojiHandlers(roomContext) {
	const { username, groupId, key, fedOut, rtcLimits, peerToNode, isBlockedPeer, slot } = roomContext
	const emojiWant = wireAction(roomContext, 'fed_emoji_want')
	const emojiData = wireAction(roomContext, 'fed_emoji_data')
	const emojiManifest = wireAction(roomContext, 'fed_emoji_manifest')
	const sendEmojiData = bindFedSender(fedOut, 6, 'fed_emoji_data', emojiData.send)
	const sendEmojiManifest = bindFedSender(fedOut, 6, 'fed_emoji_manifest', emojiManifest.send)

	emojiWant.on((data, peerId) => {
		void handleFedEmojiWant(username, groupId, data, peerId, sendEmojiData, isBlockedPeer, peerToNode)
			.catch(error => console.warn('federation: fed_emoji_want handler failed', error))
	})

	emojiData.on(data => {
		void handleFedEmojiData(username, groupId, data)
			.catch(error => console.warn('federation: fed_emoji_data handler failed', error))
	})

	emojiManifest.on(data => {
		void handleFedEmojiManifest(username, groupId, data)
			.catch(error => console.warn('federation: fed_emoji_manifest handler failed', error))
	})

	slot.sendEmojiWant = bindFedSender(
		fedOut,
		6,
		'fed_emoji_want',
		emojiWant.send,
		() => isFederationActionAllowedUnderLoad(key, 'fed_emoji_want', rtcLimits),
	)
	slot.sendEmojiData = sendEmojiData
	slot.sendEmojiManifest = sendEmojiManifest

	/**
	 * @param {string} emojiId 表情 ID
	 * @param {string} [packId] 表情包 ID
	 * @returns {Promise<{ dataUrl: string, mimeType: string } | null>} 拉取结果
	 */
	slot.requestGroupEmoji = function requestGroupEmoji(emojiId, packId) {
		return requestGroupEmojiFromPeers(username, groupId, emojiId, slot, packId)
	}

	/**
	 * @param {object} entry manifest 条目
	 * @returns {Promise<void>} 返回值
	 */
	slot.replicateGroupEmojiManifest = function replicateGroupEmojiManifest(entry) {
		return replicateGroupEmojiManifestToFederation(username, groupId, entry, slot)
	}

	/**
	 * @param {string} emojiId 表情 ID
	 * @param {string} [packId] 参数
	 * @returns {Promise<void>} 返回值
	 */
	slot.replicateGroupEmoji = function replicateGroupEmoji(emojiId, packId) {
		return replicateGroupEmojiToFederation(username, groupId, emojiId, slot, packId)
	}
}
