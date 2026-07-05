/**
 * 【文件】federation/groupEmojiFederation.mjs
 * 【职责】群自定义表情经 Trystero fed_emoji_want/data 在 P2P 邻居间拉取与缓存，避免仅靠 HTTP 上传侧存储。
 * 【原理】attachFedEmojiHandlers 在 room join 时注册；本地有二进制则响应 dataUrl，请求方 persistGroupEmojiFromDataUrl。与 fed_chunk 类似采用 pendingFetches + 超时，拉黑 peer 不响应。
 * 【数据结构】载荷 { emojiId, dataUrl?, mimeType? }；等待键 username\0groupId\0emojiId。
 * 【关联】room.mjs、group/groupEmojis.mjs、wire_ingress.mjs、governance/peers 拉黑检查。
 */
import { wireAction } from '../../../../../../../scripts/p2p/room_wire_action.mjs'
import { isFederationActionAllowedUnderLoad } from '../../../../../../../scripts/p2p/rtc_connection_budget.mjs'
import { isPlainObject } from '../../../../../../../scripts/p2p/wire_ingress.mjs'
import { consumeWireRateBucket } from '../../../../../../../scripts/p2p/wire_rate_bucket.mjs'
import {
	bufferToDataUrl,
	loadGroupEmojiManifest,
	persistGroupEmojiFromDataUrl,
	readGroupEmojiBinary,
	upsertGroupEmojiManifestEntry,
} from '../../group/groupEmojis.mjs'

import { bindFedSender } from './outbound.mjs'

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
 * @param {string} username 用户
 * @param {string} groupId 群 ID
 * @param {string} emojiId 表情 ID
 * @returns {string} 等待键
 */
function waitKey(username, groupId, emojiId) {
	return `${username}\0${groupId}\0${emojiId}`
}

/**
 * 处理入站 `fed_emoji_want`：本地有则回复 `fed_emoji_data`。
 * @param {string} username 用户
 * @param {string} groupId 群 ID
 * @param {unknown} data 载荷
 * @param {string} peerId 对端
 * @param {(payload: unknown, peerId: string) => void} sendEmojiData 发送 fed_emoji_data
 * @param {(id: string) => boolean} isBlockedPeer 拉黑检查
 * @param {Map<string, string>} peerToNode peer → nodeId
 * @returns {Promise<void>}
 */
export async function handleFedEmojiWant(username, groupId, data, peerId, sendEmojiData, isBlockedPeer, peerToNode) {
	if (!isPlainObject(data)) return
	if (!consumeEmojiWant(waitKey(username, groupId, EMOJI_WANT_BUCKET_KEY))) return
	const remoteNode = peerToNode.get(peerId)
	if (remoteNode && isBlockedPeer(remoteNode)) return
	const emojiId = String(data.emojiId || '').trim()
	if (!emojiId) return
	const local = await readGroupEmojiBinary(username, groupId, emojiId)
	if (!local) return
	const dataUrl = bufferToDataUrl(local.buffer, local.mimeType)
	try {
		sendEmojiData({ emojiId, dataUrl, mimeType: local.mimeType }, peerId)
	}
	catch (error) {
		console.warn('federation: fed_emoji_data send failed', error)
	}
}

/**
 * 处理入站 `fed_emoji_data`：写入本地并兑现等待中的 Promise。
 * @param {string} username 用户
 * @param {string} groupId 群 ID
 * @param {unknown} data 载荷
 * @returns {Promise<void>}
 */
export async function handleFedEmojiData(username, groupId, data) {
	if (!isPlainObject(data)) return
	const emojiId = String(data.emojiId || '').trim()
	const dataUrl = String(data.dataUrl || '').trim()
	const mimeType = String(data.mimeType || 'image/png')
	if (!emojiId || !/^data:[^;]+;base64,.+$/u.test(dataUrl)) return
	const key = waitKey(username, groupId, emojiId)
	const pending = pendingFetches.get(key)
	if (pending) {
		clearTimeout(pending.timer)
		pendingFetches.delete(key)
		pending.resolve({ dataUrl, mimeType })
	}
	// 无论清单条目是否已存在，始终写入本地二进制（防止清单已同步但文件未下载时丢弃 push 数据）
	await persistGroupEmojiFromDataUrl(username, groupId, emojiId, dataUrl, mimeType)
		.catch(error => console.warn('federation: fed_emoji_data persist failed', error))
}

/**
 * 处理入站 `fed_emoji_manifest`：合并远端 manifest 条目（contentHash 等元数据）。
 * @param {string} username 用户
 * @param {string} groupId 群 ID
 * @param {unknown} data 载荷
 * @returns {Promise<void>}
 */
export async function handleFedEmojiManifest(username, groupId, data) {
	if (!isPlainObject(data)) return
	const emojiId = String(data.emojiId || '').trim()
	if (!emojiId) return
	await upsertGroupEmojiManifestEntry(username, groupId, {
		emojiId,
		name: data.name,
		mimeType: data.mimeType,
		ext: data.ext,
		animated: data.animated,
		contentHash: data.contentHash,
		uploadedBy: 'federation',
	}).catch(error => console.warn('federation: fed_emoji_manifest persist failed', error))
}

/**
 * 经 user-room node scope 向已连接 / trust-graph 邻居索要群表情（非成员预览路径）。
 * @param {string} username 用户
 * @param {string} groupId 群 ID
 * @param {string} emojiId 表情 ID
 * @returns {Promise<{ dataUrl: string, mimeType: string } | null>} 对端返回的 data URL，超时为 null
 */
export async function requestGroupEmojiFromUserRoom(username, groupId, emojiId) {
	if (!consumeEmojiWant(waitKey(username, groupId, EMOJI_WANT_BUCKET_KEY))) return null
	const key = waitKey(username, groupId, emojiId)
	const payload = { groupId, emojiId }
	const resultPromise = new Promise(resolve => {
		const timer = setTimeout(() => {
			pendingFetches.delete(key)
			resolve(null)
		}, FETCH_TIMEOUT_MS)
		pendingFetches.set(key, { resolve, timer })
	})
	const { ensureUserRoom, deliverToUserRoomPeers } = await import('../../../../../../../scripts/p2p/user_room.mjs')
	const { fanoutToTopNodes } = await import('../../../../../../../scripts/p2p/trust_graph_send.mjs')
	await ensureUserRoom({ replicaUsername: username })
	await deliverToUserRoomPeers(username, 'fed_emoji_want', payload)
	await fanoutToTopNodes(username, 'fed_emoji_want', payload, 6)
	return await resultPromise
}

/**
 * 在 node scope user-room 注册 fed_emoji_want / fed_emoji_data（非成员不经群联邦房间拉表情）。
 * @param {string} username replica 用户名
 * @param {{ on: (name: string, handler: (payload: unknown, peerId: string) => void) => void, send: (name: string, payload: unknown, peerId: string | null) => void }} wire node scope 派发
 * @returns {void}
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
 * @param {string} username 用户
 * @param {string} groupId 群 ID
 * @param {string} emojiId 表情 ID
 * @param {object | null} slot 联邦房间槽
 * @returns {Promise<{ dataUrl: string, mimeType: string } | null>} 对端返回的 data URL，超时为 null
 */
export async function requestGroupEmojiFromPeers(username, groupId, emojiId, slot) {
	if (!slot) return null
	if (!consumeEmojiWant(waitKey(username, groupId, EMOJI_WANT_BUCKET_KEY))) return null
	if (!slot.sendEmojiWant) return null
	const key = waitKey(username, groupId, emojiId)
	return await new Promise(resolve => {
		const timer = setTimeout(() => {
			pendingFetches.delete(key)
			resolve(null)
		}, FETCH_TIMEOUT_MS)
		pendingFetches.set(key, { resolve, timer })
		// 向当前在线的所有 peer 发 want；roster 为空时不提前退出——
		// A 在新 peer 入房后会主动推送 fed_emoji_data（replicateGroupEmojisToPeer），
		// handleFedEmojiData 会通过 pending promise 兑现结果（非成员预览路径）。
		const roster = slot.getRoster()
		const payload = { emojiId }
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
 * 经 user-room 向已连接邻居推送 manifest（群 roster 未就绪时的补充路径）。
 * @param {string} username 用户
 * @param {string} groupId 群 ID
 * @param {object} entry manifest 条目
 * @returns {Promise<void>}
 */
export async function replicateGroupEmojiManifestToUserRoom(username, groupId, entry) {
	if (!entry?.emojiId) return
	const { deliverToUserRoomPeers } = await import('../../../../../../../scripts/p2p/user_room.mjs')
	await deliverToUserRoomPeers(username, 'fed_emoji_manifest', {
		groupId,
		emojiId: entry.emojiId,
		name: entry.name,
		mimeType: entry.mimeType,
		ext: entry.ext,
		animated: entry.animated,
		contentHash: entry.contentHash,
	})
}

/**
 * 向联邦邻居广播群表情 manifest 条目（轻量，供对端清单 / CAS 路径）。
 * @param {string} username 用户
 * @param {string} groupId 群 ID
 * @param {object} entry manifest 条目
 * @param {object | null} slot 联邦槽
 * @returns {Promise<void>}
 */
export async function replicateGroupEmojiManifestToFederation(username, groupId, entry, slot) {
	if (!slot?.sendEmojiManifest || !entry?.emojiId) return
	const payload = {
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
 * 上传后向邻居推送群表情数据（best-effort）。
 * @param {string} username 用户
 * @param {string} groupId 群 ID
 * @param {string} emojiId 表情 ID
 * @param {object | null} slot 联邦槽
 * @returns {Promise<void>}
 */
export async function replicateGroupEmojiToFederation(username, groupId, emojiId, slot) {
	if (!slot) return
	const local = await readGroupEmojiBinary(username, groupId, emojiId)
	if (!local) return
	if (!slot.sendEmojiData) return
	const dataUrl = bufferToDataUrl(local.buffer, local.mimeType)
	const payload = { emojiId, dataUrl, mimeType: local.mimeType }
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
 * 新 peer 入房时向其推送本群全部表情 manifest + 二进制。
 * @param {string} username 用户
 * @param {string} groupId 群 ID
 * @param {string} peerId 对端 nodeHash
 * @param {object | null} slot 联邦槽
 * @returns {Promise<void>}
 */
export async function replicateGroupEmojisToPeer(username, groupId, peerId, slot) {
	if (!slot?.sendEmojiData || !peerId) return
	const entries = await loadGroupEmojiManifest(username, groupId)
	for (const entry of entries) {
		const emojiId = String(entry?.emojiId || '').trim()
		if (!emojiId) continue
		if (slot.sendEmojiManifest)
			try {
				slot.sendEmojiManifest({
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
		const local = await readGroupEmojiBinary(username, groupId, emojiId)
		if (!local) continue
		try {
			slot.sendEmojiData({
				emojiId,
				dataUrl: bufferToDataUrl(local.buffer, local.mimeType),
				mimeType: local.mimeType,
			}, peerId)
		}
		catch (error) {
			console.warn('federation: fed_emoji_data peer replicate failed', error)
		}
	}
}

/**
 * 在联邦房间注册 `fed_emoji_want` / `fed_emoji_data` 处理器。
 * @param {object} roomContext 房间上下文（与 roomHandlers 相同 wireAction 形状）
 * @returns {void}
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
	 * @returns {Promise<{ dataUrl: string, mimeType: string } | null>} P2P 拉取结果
	 */
	slot.requestGroupEmoji = function requestGroupEmoji(emojiId) {
		return requestGroupEmojiFromPeers(username, groupId, emojiId, slot)
	}

	/**
	 * @param {object} entry manifest 条目
	 * @returns {Promise<void>}
	 */
	slot.replicateGroupEmojiManifest = function replicateGroupEmojiManifest(entry) {
		return replicateGroupEmojiManifestToFederation(username, groupId, entry, slot)
	}

	/**
	 * @param {string} emojiId 表情 ID
	 * @returns {Promise<void>}
	 */
	slot.replicateGroupEmoji = function replicateGroupEmoji(emojiId) {
		return replicateGroupEmojiToFederation(username, groupId, emojiId, slot)
	}
}
