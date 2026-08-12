import { isEntityHash128, parseEntityHash } from 'npm:@steve02081504/fount-p2p/core/entity_id'
import { isHex64 } from 'npm:@steve02081504/fount-p2p/core/hexIds'
import { getNodeHash } from 'npm:@steve02081504/fount-p2p/node/identity'
import { getEntityStore, isNodeInitialized } from 'npm:@steve02081504/fount-p2p/node/instance'
import { loadNetwork } from 'npm:@steve02081504/fount-p2p/node/network'

import { findHostingReplicaUsername, resolveSocialEntity } from '../federation/hosting.mjs'


/**
 * @param {string} nodeHash 64 hex
 * @returns {boolean} 是否在 P2P 网络表中已知
 */
function isKnownNetworkNode(nodeHash) {
	const net = loadNetwork()
	if (!isHex64(nodeHash)) return false
	if (nodeHash === getNodeHash()) return true
	if (net.trustedPeers.some(peer => peer === nodeHash)) return true
	if (net.explorePeers.some(peer => peer === nodeHash)) return true
	return net.hints.some(hint => hint.nodeHash === nodeHash)
}

/**
 * 目标 entity 是否可解析/可发现（本地 replica、已知托管节点、network hint 或已缓存 profile）。
 * @param {string} username 调用方 replica
 * @param {string} entityHash 128 hex
 * @returns {Promise<boolean>} 是否可解析/可发现
 */
export async function isKnownSocialTarget(username, entityHash) {
	const target = String(entityHash || '').trim().toLowerCase()
	if (!isEntityHash128(target)) return false

	const resolved = await resolveSocialEntity(target, username)
	if (resolved?.local && resolved.kind !== 'unknown') return true
	if (await findHostingReplicaUsername(target)) return true

	if (!isNodeInitialized()) return false

	const store = getEntityStore()
	if (await store.readEntityJson(target, 'profile.json')) return true

	const parsed = parseEntityHash(target)
	if (!parsed) return false
	return isKnownNetworkNode(parsed.nodeHash)
}
