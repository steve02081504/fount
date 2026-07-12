/**
 * 联邦群卡片拉取：fed_group_card_want / fed_group_card_data。
 */
import { wireAction } from 'npm:@steve02081504/fount-p2p/transport/room_wire_action'
import { isFederationActionAllowedUnderLoad } from 'npm:@steve02081504/fount-p2p/transport/rtc_connection_budget'
import { isPlainObject } from 'npm:@steve02081504/fount-p2p/wire/ingress'
import { consumeWireRateBucket } from 'npm:@steve02081504/fount-p2p/wire/rate_bucket'
import { getState } from '../../chat/dag/materialize.mjs'

import { bindFedSender } from './outbound.mjs'

const FETCH_TIMEOUT_MS = 14_000
const CARD_WANT_MAX_PER_MIN = 30

/** @type {Map<string, { resolve: (v: object | null) => void, timer: ReturnType<typeof setTimeout> }>} */
const pendingFetches = new Map()

/**
 * @param {string} username - 用户名。
 * @param {string} groupId - 群 ID。
 * @returns {string} 等待键。
 */
function waitKey(username, groupId) {
	return `${username}\0${groupId}\0group_card`
}

/**
 * @param {string} bucketKey - 限流桶键。
 * @returns {boolean} 是否允许发送 want。
 */
function consumeCardWant(bucketKey) {
	return consumeWireRateBucket(bucketKey, { maxCount: CARD_WANT_MAX_PER_MIN })
}

/**
 * 处理对端发来的群卡片 want 请求。
 * @param {string} username - 用户名。
 * @param {string} groupId - 群 ID。
 * @param {unknown} data - 入站载荷。
 * @param {string} peerId - 对端 peer ID。
 * @param {(payload: unknown, peerId: string) => void} sendCardData - 发送卡片数据回调。
 * @param {(id: string) => boolean} isBlockedPeer - 是否已屏蔽对端。
 * @param {Map<string, string>} peerToNode - peer 到 nodeHash 映射。
 * @returns {Promise<void>}
 */
export async function handleFedGroupCardWant(username, groupId, data, peerId, sendCardData, isBlockedPeer, peerToNode) {
	if (!isPlainObject(data)) return
	if (!consumeCardWant(waitKey(username, groupId))) return
	const remoteNode = peerToNode.get(peerId)
	if (remoteNode && isBlockedPeer(remoteNode)) return
	let state
	try {
		({ state } = await getState(username, groupId))
	}
	catch {
		return
	}
	const title = (state.groupMeta?.name || state.groupSettings?.discoveryTitle || groupId).slice(0, 200)
	const blurb = (state.groupMeta?.description || state.groupSettings?.discoveryBlurb || '').slice(0, 500)
	try {
		sendCardData({ groupId, title, blurb }, peerId)
	}
	catch (error) {
		console.warn('federation: fed_group_card_data send failed', error)
	}
}

/**
 * 处理对端返回的群卡片数据。
 * @param {string} username - 用户名。
 * @param {string} groupId - 群 ID。
 * @param {unknown} data - 入站载荷。
 * @returns {void}
 */
export function handleFedGroupCardData(username, groupId, data) {
	if (!isPlainObject(data)) return
	const key = waitKey(username, groupId)
	const pending = pendingFetches.get(key)
	if (!pending) return
	clearTimeout(pending.timer)
	pendingFetches.delete(key)
	pending.resolve({
		title: String(data.title || ''),
		blurb: String(data.blurb || ''),
	})
}

/**
 * 向联邦 peer 请求群卡片摘要。
 * @param {string} username - 用户名。
 * @param {string} groupId - 群 ID。
 * @param {object | null} slot - 联邦出站槽位。
 * @returns {Promise<{ title: string, blurb: string } | null>} 卡片摘要或 null。
 */
export async function requestGroupCardFromPeers(username, groupId, slot) {
	if (!slot?.sendGroupCardWant) return null
	const roster = slot.getRoster?.() || []
	if (!roster.length) return null
	if (!consumeCardWant(waitKey(username, groupId))) return null
	const key = waitKey(username, groupId)
	return await new Promise(resolve => {
		const timer = setTimeout(() => {
			pendingFetches.delete(key)
			resolve(null)
		}, FETCH_TIMEOUT_MS)
		pendingFetches.set(key, { resolve, timer })
		for (const { peerId } of roster)
			try {
				slot.sendGroupCardWant({ groupId }, peerId)
			}
			catch { /* ignore */ }
	})
}

/**
 * 为群房间注册联邦群卡片处理器。
 * @param {object} roomContext - 群房间上下文。
 * @returns {void}
 */
export function attachFedGroupCardHandlers(roomContext) {
	const { username, groupId, key, fedOut, rtcLimits, peerToNode, isBlockedPeer, slot } = roomContext
	const cardWant = wireAction(roomContext, 'fed_group_card_want')
	const cardData = wireAction(roomContext, 'fed_group_card_data')
	const sendCardData = bindFedSender(fedOut, 6, 'fed_group_card_data', cardData.send)

	cardWant.on((data, peerId) => {
		void handleFedGroupCardWant(username, groupId, data, peerId, sendCardData, isBlockedPeer, peerToNode)
			.catch(error => console.warn('federation: fed_group_card_want handler failed', error))
	})

	cardData.on(data => {
		handleFedGroupCardData(username, groupId, data)
	})

	slot.sendGroupCardWant = bindFedSender(
		fedOut,
		6,
		'fed_group_card_want',
		cardWant.send,
		() => isFederationActionAllowedUnderLoad(key, 'fed_group_card_want', rtcLimits),
	)
}
