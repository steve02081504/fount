/**
 * 【文件】federation/powChallengeFederation.mjs
 * 【职责】入群 PoW challenge 联邦拉取：`fed_pow_challenge_want` / `fed_pow_challenge_data`。
 * 【原理】无本地 replica 的加入者无法 `/state` 拿到 dagTips，需经 user-room node scope 向持有该群的
 *   邻居索取当前稳定锚 + 难度；discoveryPublic 的 pow 群一并返回 roomSecret 供 bootstrap。
 * 【数据结构】want `{ groupId }`；data `{ groupId, anchors, powFloorBits, powEpochMs, discoveryPublic, roomSecret?, signalingAppId?, responderNodeHash? }`。
 * 【关联】group/routes/membership.mjs 的 `/pow-challenge`、public/src/powJoin.mjs、userRoomEmojiRegistry.mjs。
 */
import { isPlainObject } from 'npm:@steve02081504/fount-p2p/core/object'
import { consumeWireRateBucket } from 'npm:@steve02081504/fount-p2p/wire/rate_bucket'

import { getState } from '../../chat/dag/materialize.mjs'
import { collectJoinPowAnchors } from '../../chat/governance/joinPowAnchors.mjs'

import { roomCredentialsFromGroupSettings } from './roomCredentials.mjs'

const FETCH_TIMEOUT_MS = 14_000
const CHALLENGE_WANT_MAX_PER_MIN = 30

/** @type {Map<string, { promise: Promise<object | null>, resolve: (v: object | null) => void, timer: ReturnType<typeof setTimeout> }>} */
const pendingFetches = new Map()

/**
 * 生成用户与群的入群 PoW challenge 等待/限流键。
 * @param {string} username 用户
 * @param {string} groupId 群 ID
 * @returns {string} 等待键
 */
export function waitKey(username, groupId) {
	return `${username}\0${groupId}\0pow_challenge`
}

/**
 * 消费一次入群 PoW challenge 配额（超出上限则拒绝）。
 * @param {string} bucketKey 限流键
 * @returns {boolean} 是否允许 want
 */
export function consumeChallengeWant(bucketKey) {
	return consumeWireRateBucket(bucketKey, { maxCount: CHALLENGE_WANT_MAX_PER_MIN })
}

/**
 * 处理入站 `fed_pow_challenge_want`：本地持有 pow 群时回复 `fed_pow_challenge_data`。
 * @param {string} username 用户
 * @param {string} groupId 群 ID
 * @param {unknown} data 载荷
 * @param {string} peerId 对端
 * @param {(payload: unknown, peerId: string) => void} sendChallengeData 发送 fed_pow_challenge_data
 * @param {(id: string) => boolean} isBlockedPeer 拉黑检查
 * @param {Map<string, string>} peerToNode peer→node 映射
 * @returns {Promise<void>}
 */
export async function handleFedPowChallengeWant(username, groupId, data, peerId, sendChallengeData, isBlockedPeer, peerToNode) {
	if (!isPlainObject(data)) return
	if (data.groupId !== groupId) return
	if (!consumeChallengeWant(waitKey(username, groupId))) return
	const remoteNode = peerToNode.get(peerId)
	if (remoteNode && isBlockedPeer(remoteNode)) return
	let state
	try {
		({ state } = await getState(username, groupId))
	}
	catch {
		return
	}
	if (state.groupSettings?.joinPolicy !== 'pow') return
	const payload = {
		groupId,
		anchors: collectJoinPowAnchors(state),
		powFloorBits: Number(state.groupSettings?.powFloorBits) || 0,
		powEpochMs: Number(state.groupSettings?.powEpochMs) || 0,
		discoveryPublic: Boolean(state.groupSettings?.discoveryPublic),
	}
	if (payload.discoveryPublic) {
		const creds = roomCredentialsFromGroupSettings(state.groupSettings)
		if (creds) {
			payload.roomSecret = creds.roomSecret
			payload.signalingAppId = creds.signalingAppId
		}
	}
	try {
		sendChallengeData(payload, peerId)
	}
	catch (error) {
		console.warn('federation: fed_pow_challenge_data send failed', error)
	}
}

/**
 * 处理入站 `fed_pow_challenge_data`：按已验证发送者兑现等待中的 Promise。
 * @param {string} username 用户
 * @param {string} groupId 群 ID
 * @param {unknown} data 载荷
 * @param {string} senderNodeHash 发送方 nodeHash（node scope 已验证）
 * @returns {void}
 */
export function handleFedPowChallengeData(username, groupId, data, senderNodeHash) {
	if (!isPlainObject(data)) return
	if (data.groupId !== groupId) return
	if (!Array.isArray(data.anchors) || !data.anchors.length) return
	if (typeof senderNodeHash !== 'string' || !senderNodeHash) return
	if (data.nodeHash && data.nodeHash !== senderNodeHash) return
	const key = waitKey(username, groupId)
	const pending = pendingFetches.get(key)
	if (!pending) return
	clearTimeout(pending.timer)
	pendingFetches.delete(key)
	pending.resolve({ ...data, responderNodeHash: senderNodeHash })
}

/**
 * 经 user-room node scope 向邻居索取入群 PoW challenge。
 * 先定向拨号候选节点（引入者/发现源）建立链路，再广播 want 并等待首个有效响应。
 * @param {string} username 用户
 * @param {string} groupId 群 ID
 * @param {{ introducerNodeHash?: string }} [options] 优先定向的引入者节点
 * @returns {Promise<object | null>} challenge 或 null
 */
export async function requestPowChallengeFromUserRoom(username, groupId, options = {}) {
	if (!consumeChallengeWant(waitKey(username, groupId))) return null
	const key = waitKey(username, groupId)
	const existing = pendingFetches.get(key)
	if (existing) return existing.promise
	let resolvePending
	const promise = new Promise(resolve => { resolvePending = resolve })
	const timer = setTimeout(() => {
		pendingFetches.delete(key)
		resolvePending(null)
	}, FETCH_TIMEOUT_MS)
	pendingFetches.set(key, { promise, resolve: resolvePending, timer })
	try {
		const { ensureUserRoom, deliverToUserRoomPeers } = await import('npm:@steve02081504/fount-p2p/transport/user_room')
		const { DEFAULT_TRUST_GRAPH_OWNER, requireTrustGraphProvider } = await import('npm:@steve02081504/fount-p2p/trust_graph/registry')
		const payload = { groupId }
		await ensureUserRoom({ replicaUsername: username })
		if (options.introducerNodeHash) {
			const { ensureLinkToNode } = await import('npm:@steve02081504/fount-p2p/transport/link_registry')
			try {
				await ensureLinkToNode(options.introducerNodeHash)
			}
			catch { /* dial 失败交给 fanout 兜底 */ }
		}
		const sent = await deliverToUserRoomPeers(username, 'fed_pow_challenge_want', payload)
		if (sent <= 0)
			await requireTrustGraphProvider(DEFAULT_TRUST_GRAPH_OWNER).fanoutToTopNodes(username, 'fed_pow_challenge_want', payload, 6)
	}
	catch (error) {
		if (pendingFetches.get(key)?.promise === promise) {
			clearTimeout(timer)
			pendingFetches.delete(key)
		}
		throw error
	}
	return await promise
}

/**
 * 在 node scope user-room 注册 fed_pow_challenge_*。
 * @param {string} username 用户
 * @param {{ on: (name: string, handler: (payload: unknown, peerId: string) => void) => void, send: (name: string, payload: unknown, peerId: string | null) => void }} wire user-room wire
 * @returns {void}
 */
export function attachUserRoomPowChallengeHandlers(username, wire) {
	wire.on('fed_pow_challenge_want', (data, peerId) => {
		if (!isPlainObject(data)) return
		const groupId = data.groupId || ''
		if (!groupId) return
		void handleFedPowChallengeWant(
			username,
			groupId,
			data,
			peerId,
			(payload, targetPeerId) => wire.send('fed_pow_challenge_data', { ...payload, groupId }, targetPeerId),
			() => false,
			new Map(),
		).catch(error => console.warn('federation: user-room fed_pow_challenge_want failed', error))
	})
	wire.on('fed_pow_challenge_data', (data, peerId) => {
		if (!isPlainObject(data)) return
		const groupId = data.groupId || ''
		if (!groupId) return
		handleFedPowChallengeData(username, groupId, data, peerId)
	})
}
