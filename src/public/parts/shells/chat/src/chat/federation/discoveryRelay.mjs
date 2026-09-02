/**
 * 联邦群发现 gossip：discovery_announce / discovery_query。
 */

import { parseDiscoveryQuery, parseDiscoveryQueryResponse } from 'npm:@steve02081504/fount-p2p/schemas/discovery'

import {
	buildDiscoveryQueryResponse,
	buildSignedDiscoveryAdvertisement,
	mergeDiscoveryAdvertisement,
} from '../discovery/index.mjs'
import { listUserGroups } from '../lib/userGroups.mjs'

import { loadFederationGroupSettings, localNodeHash } from './dagDependencies.mjs'
import { pickFederationTargetPeerIds } from './peerFanout.mjs'

/**
 * @param {string} username 用户
 * @param {string} groupId 群 ID
 * @param {string} nodeHash 本机 nodeHash
 * @param {object} slot FederationSlot
 * @returns {Promise<void>}
 */
export async function publishDiscoveryAnnounceForGroup(username, groupId, nodeHash, slot) {
	const advertisement = await buildSignedDiscoveryAdvertisement(username, groupId, nodeHash)
	if (!advertisement) return
	const groupSettings = await loadFederationGroupSettings(username, groupId)
	const targets = await pickFederationTargetPeerIds(groupId,
		slot.getRoster(),
		groupSettings,
		nodeHash,
	)
	const body = { nodeHash, advertisements: [advertisement] }
	if (!targets.length) slot.send('discovery_announce', body, null)
	else for (const peerId of targets) slot.send('discovery_announce', body, peerId)
}

/**
 * @param {string} username 用户
 * @param {string} nodeHash 本机 nodeHash
 * @returns {Promise<void>}
 */
export async function publishDiscoveryAnnounceAllGroups(username, nodeHash) {
	const { ensureFederationRoom } = await import('./room.mjs')
	for (const groupId of await listUserGroups(username)) {
		const slot = await ensureFederationRoom(username, groupId)
		if (slot) await publishDiscoveryAnnounceForGroup(username, groupId, nodeHash, slot)
	}
}

/**
 * 广播 discovery_query 到 user-room peers / 信任图 top 节点，主动索取邻居公开群与本地索引。
 * 无本机群房间、纯 discovery 页签冷启动时，这是唯一能把远端公开群拉进本地索引的路径。
 * @param {string} username 用户
 * @param {string} nodeHash 本机 nodeHash
 * @returns {Promise<void>}
 */
export async function broadcastDiscoveryQuery(username, nodeHash) {
	const payload = {
		requestId: crypto.randomUUID(),
		limit: 32,
		nodeHash,
	}
	const { deliverToUserRoomPeers } = await import('npm:@steve02081504/fount-p2p/transport/user_room')
	let sent = 0
	try {
		sent = await deliverToUserRoomPeers(username, 'discovery_query', payload)
	}
	catch (error) {
		console.warn('federation: discovery_query user-room fanout failed', error)
	}
	if (sent <= 0) {
		const { DEFAULT_TRUST_GRAPH_OWNER, requireTrustGraphProvider } = await import('npm:@steve02081504/fount-p2p/trust_graph/registry')
		try {
			await requireTrustGraphProvider(DEFAULT_TRUST_GRAPH_OWNER)
				.fanoutToTopNodes(username, 'discovery_query', payload, 6)
		}
		catch (error) {
			console.warn('federation: discovery_query trust-graph fanout failed', error)
		}
	}
}

/**
 * @param {string} username 用户
 * @param {object} announce 解析后的 announce
 * @returns {Promise<void>}
 */
export async function ingestDiscoveryAnnounce(username, announce) {
	for (const advertisement of announce.advertisements)
		await mergeDiscoveryAdvertisement(username, advertisement, {
			fromNodeHash: announce.nodeHash,
		})
}

/**
 * @param {string} username 用户
 * @param {string} nodeHash 本机 nodeHash
 * @param {object} query 解析后的 discovery_query
 * @param {string} peerId 请求方 peer
 * @param {(payload: unknown, peerId: string) => void} sendResponse 发送 discovery_query_response
 * @returns {Promise<void>}
 */
export async function handleDiscoveryQuery(username, nodeHash, query, peerId, sendResponse) {
	sendResponse({
		requestId: query.requestId,
		nodeHash,
		advertisements: await buildDiscoveryQueryResponse(username, nodeHash, query.limit),
	}, peerId)
}

/**
 * 在 node scope user-room 注册 discovery_query / discovery_query_response：
 * 冷启动节点经 node 链路向邻居拉取公开群广告（与群房间内 relay 互补）。
 * @param {string} username 用户
 * @param {{ on: (name: string, handler: (payload: unknown, peerId: string) => void) => void, send: (name: string, payload: unknown, peerId: string) => void }} wire user-room wire
 * @returns {void}
 */
export function attachUserRoomDiscoveryHandlers(username, wire) {
	wire.on('discovery_query', (data, peerId) => {
		void (async () => {
			const query = parseDiscoveryQuery(data)
			if (!query) return
			const nodeHash = localNodeHash()
			await handleDiscoveryQuery(
				username,
				nodeHash,
				query,
				peerId,
				(payload, targetPeer) => wire.send('discovery_query_response', payload, targetPeer),
			)
		})().catch(error => console.warn('federation: user-room discovery_query failed', error))
	})
	wire.on('discovery_query_response', data => {
		void (async () => {
			const response = parseDiscoveryQueryResponse(data)
			if (!response) return
			await ingestDiscoveryAnnounce(username, response)
		})().catch(error => console.warn('federation: user-room discovery_query_response failed', error))
	})
}
