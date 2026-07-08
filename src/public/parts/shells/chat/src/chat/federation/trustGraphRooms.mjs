import { normalizeHex64 } from '../../../../../../../scripts/p2p/hexIds.mjs'
import { registerScopeAuthorizer } from '../../../../../../../scripts/p2p/link_registry.mjs'
import { loadPeerPoolView } from '../../../../../../../scripts/p2p/network.mjs'
import { resolveFederationPoolLimits, selectPeerIdsFromPool } from '../../../../../../../scripts/p2p/peer_pool.mjs'
import { loadReputation } from '../../../../../../../scripts/p2p/reputation_store.mjs'
import { registerFederationRoomProvider, unregisterFederationRoomProvider } from '../../../../../../../scripts/p2p/room_provider_registry.mjs'

import { loadFederationGroupSettings, loadFederationMaterializedState } from './dagDependencies.mjs'
import { LOGIC_SYNC_PARTITION } from './partitions.mjs'
import { forEachFederationPartitionSlot, groupFederationOwner } from './registry.mjs'

let unregisterGroupScopeAuthorizer = null

const PREMEMBER_GROUP_ACTIONS = new Set([
	'fed_bootstrap_request',
	'fed_bootstrap_response',
	'fed_join_snapshot_request',
	'fed_join_snapshot_response',
	'fed_tip_ping',
	'fed_tip_pong',
	'discovery_announce',
	'discovery_query',
	'discovery_query_response',
])

/**
 * @param {object | null | undefined} state 物化群状态
 * @param {unknown} nodeHash 64 位 hex 节点 hash
 * @returns {boolean} 是否为活跃成员的 home 节点
 */
function isActiveMemberNodeHash(state, nodeHash) {
	const normalizedNodeHash = normalizeHex64(nodeHash)
	if (!normalizedNodeHash) return false
	return Object.values(state?.members || {}).some(member =>
		member?.status === 'active'
		&& normalizeHex64(member?.homeNodeHash || member?.nodeHash) === normalizedNodeHash)
}

/**
 * @param {{ action?: unknown, payload?: { type?: unknown } } | null | undefined} envelope link 层信封
 * @returns {boolean} 是否为 member_join 的 dag_event 引导包
 */
function isBootstrapJoinEnvelope(envelope) {
	return envelope?.action === 'dag_event'
		&& String(envelope?.payload?.type || '') === 'member_join'
}

/**
 * @param {{ action?: unknown, payload?: { type?: unknown } } | null | undefined} envelope link 层信封
 * @returns {boolean} 是否允许未入群成员发送的 bootstrap/discovery 动作
 */
function isPrememberBootstrapEnvelope(envelope) {
	const action = String(envelope?.action || '').trim()
	return PREMEMBER_GROUP_ACTIONS.has(action) || isBootstrapJoinEnvelope(envelope)
}

/**
 * Chat Load 时注册：向 trust_graph 暴露当前 federation sync 房间槽。
 * @returns {void}
 */
export function registerChatFederationRoomProvider() {
	unregisterGroupScopeAuthorizer?.()
	unregisterGroupScopeAuthorizer = registerScopeAuthorizer('group:', async (scope, senderNodeHash, envelope) => {
		const groupId = String(scope || '').slice('group:'.length).trim()
		if (!groupId) return false
		const owner = groupFederationOwner.get(groupId)
		if (!owner) return false
		const state = await loadFederationMaterializedState(owner, groupId)
		return isActiveMemberNodeHash(state, senderNodeHash) || isPrememberBootstrapEnvelope(envelope)
	})
	registerFederationRoomProvider('chat', username => {
		/** @type {import('../../../../../../../scripts/p2p/room_provider_registry.mjs').FederationRoomSlot[]} */
		const slots = []
		forEachFederationPartitionSlot(username, (groupId, partitionId, slot) => {
			if (partitionId !== LOGIC_SYNC_PARTITION || !slot) return
			slots.push({
				groupId,
				/** @returns {Array<{ peerId: string, remoteNodeHash: string | undefined }>} roster */
				getRoster: () => slot.getRoster(),
				/**
				 * @param {string} nodeHash 64 hex
				 * @returns {string | null} peer id
				 */
				getPeerIdByNodeHash: nodeHash => slot.getPeerIdByNodeHash(nodeHash),
				/**
				 * @param {string} peerId Trystero peer
				 * @param {string} actionName action
				 * @param {unknown} payload 载荷
				 * @returns {void}
				 */
				sendToPeer: (peerId, actionName, payload) => slot.sendToPeer(peerId, actionName, payload),
				/**
				 * @param {string} selfNodeHash 本机 node hash
				 * @returns {Promise<string[]>} fallback peer ids
				 */
				pickFallbackPeerIds: async selfNodeHash => {
					const peers = loadPeerPoolView( groupId)
					const reputation = loadReputation()
					const groupSettings = await loadFederationGroupSettings(username, groupId)
					return selectPeerIdsFromPool({
						roster: slot.getRoster(),
						peers,
						rep: reputation,
						limits: resolveFederationPoolLimits(groupSettings),
						selfNodeHash,
					})
				},
			})
		})
		return slots
	})
}

/**
 * @returns {void}
 */
export function unregisterChatFederationRoomProvider() {
	unregisterFederationRoomProvider('chat')
	unregisterGroupScopeAuthorizer?.()
	unregisterGroupScopeAuthorizer = null
}
