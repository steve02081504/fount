/**
 * 联邦群发现 gossip：discovery_announce / discovery_query。
 */
import {
	buildDiscoveryQueryResponse,
	buildSignedDiscoveryAdvertisement,
	mergeDiscoveryAdvertisement,
} from '../discovery/index.mjs'
import { pickFederationTargetPeerIds } from '../../../../../../../scripts/p2p/peer_pool.mjs'
import { listUserGroups } from '../lib/userGroups.mjs'

import { loadFederationGroupSettings } from './deps.mjs'

/** 重导出 discovery wire 解析函数。 */
export { parseDiscoveryAnnounce, parseDiscoveryQuery, parseDiscoveryQueryResponse } from '../../../../../../../scripts/p2p/schemas/discovery_wire.mjs'

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
	if (!targets.length) slot.send('discovery_announce',body, null)
	else for (const peerId of targets) slot.send('discovery_announce',body, peerId)
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
 * @param {string} username 用户
 * @param {object} announce 解析后的 announce
 * @returns {Promise<void>}
 */
export async function ingestDiscoveryAnnounce(username, announce) {
	for (const advertisement of announce.advertisements)
		await mergeDiscoveryAdvertisement(username, advertisement, {
			fromNodeHash: String(announce.nodeHash || '').trim(),
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
