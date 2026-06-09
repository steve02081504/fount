import { loadPeerPoolView } from '../../../../../../../scripts/p2p/network.mjs'
import { resolveFederationPoolLimits, selectPeerIdsFromPool } from '../../../../../../../scripts/p2p/peer_pool.mjs'
import { loadReputation } from '../../../../../../../scripts/p2p/reputation_user.mjs'
import { registerFederationRoomProvider, unregisterFederationRoomProvider } from '../../../../../../../scripts/p2p/room_provider_registry.mjs'

import { loadFederationGroupSettings } from './deps.mjs'
import { LOGIC_SYNC_PARTITION } from './partitions.mjs'
import { forEachFederationPartitionSlot } from './registry.mjs'

/**
 * Chat Load 时注册：向 trust_graph 暴露当前 federation sync 房间槽。
 * @returns {void}
 */
export function registerChatFederationRoomProvider() {
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
					const peers = loadPeerPoolView(username, groupId)
					const reputation = loadReputation(username)
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
}
