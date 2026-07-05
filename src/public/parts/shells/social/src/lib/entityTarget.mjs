import { findHostingReplicaUsername, resolveSocialEntity } from '../../../../../../scripts/p2p/entity/hosting.mjs'
import { isEntityHash128, parseEntityHash } from '../../../../../../scripts/p2p/entity_id.mjs'
import { isHex64, normalizeHex64 } from '../../../../../../scripts/p2p/hexIds.mjs'
import { loadNetwork } from '../../../../../../scripts/p2p/network.mjs'
import { getNodeHash } from '../../../../../../scripts/p2p/node/identity.mjs'
import { getEntityStore, isNodeInitialized } from '../../../../../../scripts/p2p/node/instance.mjs'


/**
 * @param {string} nodeHash 64 hex
 * @returns {boolean} 是否在 P2P 网络表中已知
 */
function isKnownNetworkNode(nodeHash) {
	const net = loadNetwork()
	const id = normalizeHex64(nodeHash)
	if (!isHex64(id)) return false
	if (id === getNodeHash()) return true
	if (net.trustedPeers.some(peer => normalizeHex64(peer) === id)) return true
	if (net.explorePeers.some(peer => normalizeHex64(peer) === id)) return true
	return net.hints.some(hint => normalizeHex64(hint.nodeHash) === id)
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
