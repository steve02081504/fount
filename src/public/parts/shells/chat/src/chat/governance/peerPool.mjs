/**
 * 联邦稀疏连接池：roster 选取、PEX 合并、信誉阈值提升。
 */
import { loadPeerPoolView, mergeNetworkPeerPools } from '../../../../../../../scripts/p2p/network.mjs'
import {
	applyPexHints,
	applyRosterToPeerPool,
	resolveFederationPoolLimits,
	selectPeerIdsFromPool,
} from '../../../../../../../scripts/p2p/peer_pool.mjs'
import { loadReputation } from '../../../../../../../scripts/p2p/reputation_user.mjs'

/**
 * 稀疏连接池：优先 trusted，再 explore，再其余在线节点。
 * @param {string} username 用户
 * @param {string} groupId 群
 * @param {{ peerId: string, remoteNodeHash?: string }[]} roster Trystero 在线表
 * @param {object} groupSettings 物化群设置
 * @param {string} selfNodeHash 本机 node_id
 * @returns {Promise<string[]>} 目标 Trystero peerId（去重）
 */
export async function pickFederationTargetPeerIds(username, groupId, roster, groupSettings, selfNodeHash) {
	const limits = resolveFederationPoolLimits(groupSettings)
	const peers = loadPeerPoolView(username, groupId)
	const rep = loadReputation(username)
	const inRoomNodeHashes = roster
		.map(p => p.remoteNodeHash)
		.map(id => String(id).trim())
		.filter(Boolean)
	return selectPeerIdsFromPool({ roster, peers, rep, limits, selfNodeHash, inRoomNodeHashes })
}

/**
 * 合并 PEX 提示并提升长期高信誉节点为 trusted。
 * @param {string} username 用户
 * @param {string} groupId 群
 * @param {string[]} hints 节点 id 列表
 * @param {object} groupSettings 群设置
 * @returns {Promise<void>}
 */
export async function mergePexNodeHints(username, groupId, hints, groupSettings) {
	const limits = resolveFederationPoolLimits(groupSettings)
	const peers = loadPeerPoolView(username, groupId)
	const rep = loadReputation(username)
	const { trustedPeers, explorePeers } = applyPexHints({ peers, rep, hints, limits })
	mergeNetworkPeerPools(username, { trustedPeers, explorePeers })
}

/**
 * roster 观测：将在线节点并入 explore，并按信誉填充 trusted 槽位。
 * @param {string} username 用户
 * @param {string} groupId 群
 * @param {{ remoteNodeHash?: string }[]} roster 在线表
 * @param {object} groupSettings 群设置
 * @returns {Promise<void>}
 */
export async function reconcilePeerPoolFromRoster(username, groupId, roster, groupSettings) {
	if (!roster.length) return
	const limits = resolveFederationPoolLimits(groupSettings)
	const peers = loadPeerPoolView(username, groupId)
	const rep = loadReputation(username)
	const { trustedPeers, explorePeers } = applyRosterToPeerPool({ peers, rep, roster, limits })
	mergeNetworkPeerPools(username, { trustedPeers, explorePeers })
}
