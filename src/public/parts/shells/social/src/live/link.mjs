/**
 * 双主播直播连线：邀请 / 接受 / 断链；同节点 AV+信令桥，跨节点经 bridge WS。
 */
import { getNodeHash } from 'npm:@steve02081504/fount-p2p/node/identity'

import { httpError } from '../../../../../../scripts/http_error.mjs'
import { bridgeAvRooms } from '../../../chat/src/chat/ws/avRelay.mjs'
import { collectSocialRpcMerged } from '../federation/part_wire_rpc.mjs'
import { pushFeedUpdate } from '../ws/feedHub.mjs'

import {
	bridgeLiveSignalRooms,
	broadcastLiveSignal,
	liveSignalRoomKey,
} from './hub.mjs'
import {
	createLinkSecret,
	loadLiveSession,
	mintLiveBridgeToken,
	saveLiveSession,
} from './session.mjs'

/** @type {Map<string, () => void>} liveKey → teardown */
const activeTeardowns = new Map()

/**
 * @param {string} entityHash 主播
 * @param {string} liveId 直播
 * @returns {string} map key
 */
function liveKey(entityHash, liveId) {
	return liveSignalRoomKey(entityHash, liveId)
}

/**
 * 发起连线邀请（对端须已在播）。
 * @param {string} username replica
 * @param {string} entityHash 本端主播
 * @param {string} liveId 本端直播
 * @param {{ peerEntityHash: string, peerLiveId: string, bridgeOrigin?: string }} target 对端
 * @returns {Promise<object>} 邀请结果
 */
export async function inviteLiveLink(username, entityHash, liveId, target) {
	const session = loadLiveSession(username, entityHash, liveId)
	if (!session || session.status !== 'live') throw httpError(404, 'not live')
	if (session.link) throw httpError(409, 'already linked')
	const peerEntityHash = String(target.peerEntityHash || '').toLowerCase()
	const peerLiveId = String(target.peerLiveId || '').toLowerCase()
	if (!peerEntityHash || !peerLiveId) throw httpError(400, 'peer required')
	if (peerEntityHash === entityHash.toLowerCase() && peerLiveId === liveId.toLowerCase())
		throw httpError(400, 'cannot link self')

	const bridgeOrigin = String(target.bridgeOrigin || session.bridgeOrigin || '').trim().replace(/\/$/, '')
	const { data, errors } = await collectSocialRpcMerged(username, {
		type: 'live_link_invite',
		fromEntityHash: entityHash.toLowerCase(),
		fromLiveId: liveId.toLowerCase(),
		fromNodeHash: getNodeHash(),
		fromAvRoomId: session.avRoomId,
		fromBridgeOrigin: bridgeOrigin || null,
		fromTitle: session.title,
		peerEntityHash,
		peerLiveId,
	}, 4000, 12)

	const accepted = data.find(row => row?.type === 'live_link_accept' && row.ok)
	if (!accepted) {
		pushFeedUpdate(username, {
			type: 'live_link_invite_sent',
			liveId,
			peerEntityHash,
			peerLiveId,
			errors,
		})
		return { status: 'invited', errors }
	}

	await applyLinkPair(username, entityHash, liveId, {
		peerEntityHash: accepted.peerEntityHash || peerEntityHash,
		peerLiveId: accepted.peerLiveId || peerLiveId,
		peerNodeHash: accepted.peerNodeHash || '',
		peerAvRoomId: accepted.peerAvRoomId || `social:${peerEntityHash}:${peerLiveId}`,
		peerBridgeOrigin: accepted.peerBridgeOrigin || null,
		linkSecret: accepted.linkSecret,
		since: Date.now(),
	})
	return { status: 'linked', link: loadLiveSession(username, entityHash, liveId)?.link }
}

/**
 * 入站邀请处理（RPC）：若本机有对端场次则自动接受并建立桥。
 * @param {string} username replica
 * @param {object} rpc invite 体
 * @returns {Promise<object>} accept / reject
 */
export async function handleLiveLinkInviteRpc(username, rpc) {
	const peerEntityHash = String(rpc.peerEntityHash || '').toLowerCase()
	const peerLiveId = String(rpc.peerLiveId || '').toLowerCase()
	const session = loadLiveSession(username, peerEntityHash, peerLiveId)
	if (!session || session.status !== 'live')
		return { type: 'live_link_accept', ok: false, reason: 'not_live' }
	if (session.link)
		return { type: 'live_link_accept', ok: false, reason: 'already_linked' }

	const linkSecret = createLinkSecret()
	const fromEntityHash = String(rpc.fromEntityHash || '').toLowerCase()
	const fromLiveId = String(rpc.fromLiveId || '').toLowerCase()

	pushFeedUpdate(username, {
		type: 'live_link_invite',
		fromEntityHash,
		fromLiveId,
		fromTitle: rpc.fromTitle,
		peerEntityHash,
		peerLiveId,
	})

	await applyLinkPair(username, peerEntityHash, peerLiveId, {
		peerEntityHash: fromEntityHash,
		peerLiveId: fromLiveId,
		peerNodeHash: String(rpc.fromNodeHash || ''),
		peerAvRoomId: String(rpc.fromAvRoomId || `social:${fromEntityHash}:${fromLiveId}`),
		peerBridgeOrigin: rpc.fromBridgeOrigin || null,
		linkSecret,
		since: Date.now(),
	})

	return {
		type: 'live_link_accept',
		ok: true,
		linkSecret,
		peerEntityHash,
		peerLiveId,
		peerNodeHash: getNodeHash(),
		peerAvRoomId: session.avRoomId,
		peerBridgeOrigin: session.bridgeOrigin || null,
	}
}

/**
 * @param {string} username replica
 * @param {string} entityHash 本端
 * @param {string} liveId 本端
 * @param {object} link 连线描述
 * @returns {Promise<void>}
 */
async function applyLinkPair(username, entityHash, liveId, link) {
	const session = loadLiveSession(username, entityHash, liveId)
	if (!session || session.status !== 'live') return
	session.link = link
	saveLiveSession(username, entityHash, session)

	const key = liveKey(entityHash, liveId)
	teardownLocal(key)

	const peerKey = liveKey(link.peerEntityHash, link.peerLiveId)
	const sameNode = !link.peerNodeHash || link.peerNodeHash === getNodeHash()
		|| Boolean(loadLiveSession(username, link.peerEntityHash, link.peerLiveId))

	/** @type {Array<() => void>} */
	const teardowns = []

	if (sameNode) {
		const peerSession = loadLiveSession(username, link.peerEntityHash, link.peerLiveId)
		if (peerSession?.status === 'live') {
			teardowns.push(bridgeAvRooms(session.avRoomId, peerSession.avRoomId))
			teardowns.push(bridgeLiveSignalRooms(key, peerKey))
			if (!peerSession.link) {
				peerSession.link = {
					peerEntityHash: entityHash.toLowerCase(),
					peerLiveId: liveId.toLowerCase(),
					peerNodeHash: getNodeHash(),
					peerAvRoomId: session.avRoomId,
					peerBridgeOrigin: session.bridgeOrigin,
					linkSecret: link.linkSecret,
					since: link.since,
				}
				saveLiveSession(username, link.peerEntityHash, peerSession)
			}
		}
	}
	else if (link.peerBridgeOrigin) {
		const { connectOutboundLiveBridge } = await import('./bridge.mjs')
		const closer = await connectOutboundLiveBridge({
			username,
			entityHash,
			liveId,
			avRoomId: session.avRoomId,
			peerBridgeOrigin: link.peerBridgeOrigin,
			peerEntityHash: link.peerEntityHash,
			peerLiveId: link.peerLiveId,
			linkSecret: link.linkSecret,
		})
		teardowns.push(closer)
	}

	activeTeardowns.set(key, () => {
		for (const fn of teardowns) try { fn() } catch { /* ignore */ }
	})

	broadcastLiveSignal(key, {
		type: 'link_started',
		peerEntityHash: link.peerEntityHash,
		peerLiveId: link.peerLiveId,
	})
	pushFeedUpdate(username, {
		type: 'live_link_started',
		entityHash: entityHash.toLowerCase(),
		liveId: liveId.toLowerCase(),
		link,
	})
}

/**
 * @param {string} key live key
 * @returns {void}
 */
function teardownLocal(key) {
	const fn = activeTeardowns.get(key)
	if (fn) {
		fn()
		activeTeardowns.delete(key)
	}
}

/**
 * @param {string} username replica
 * @param {string} entityHash 主播
 * @param {string} liveId 直播
 * @returns {Promise<object | null>} 清掉后的 session
 */
export async function tearDownLiveLink(username, entityHash, liveId) {
	const session = loadLiveSession(username, entityHash, liveId)
	if (!session?.link) return session
	const key = liveKey(entityHash, liveId)
	teardownLocal(key)
	const peer = session.link
	session.link = null
	saveLiveSession(username, entityHash, session)
	broadcastLiveSignal(key, { type: 'link_ended' })
	pushFeedUpdate(username, {
		type: 'live_link_ended',
		entityHash: entityHash.toLowerCase(),
		liveId: String(liveId).toLowerCase(),
	})

	const peerSession = loadLiveSession(username, peer.peerEntityHash, peer.peerLiveId)
	if (peerSession?.link) {
		teardownLocal(liveKey(peer.peerEntityHash, peer.peerLiveId))
		peerSession.link = null
		saveLiveSession(username, peer.peerEntityHash, peerSession)
		broadcastLiveSignal(liveKey(peer.peerEntityHash, peer.peerLiveId), { type: 'link_ended' })
	}
	return session
}

/**
 * @param {string} linkSecret 密钥
 * @param {string} entityHash 主播
 * @param {string} liveId 直播
 * @returns {string} token
 */
export function liveBridgeTokenFor(linkSecret, entityHash, liveId) {
	return mintLiveBridgeToken(linkSecret, entityHash, liveId)
}

/**
 * 供 bridge 入站转发信令。
 */
export { ingestBridgedLiveSignal } from './hub.mjs'
