/**
 * 联邦房间 FederationSlot：roomContext + 统一 send(action, payload, peerId)。
 */
import { isFederationActionAllowedUnderLoad } from '../../../../../../../scripts/p2p/rtc_connection_budget.mjs'

import { bindFedSender } from './outbound.mjs'

/** @type {Record<string, [number, string]>} Trystero action → [priority, logLabel] */
const FED_ACTION_SPECS = {
	dag_event: [0, 'sendDag'],
	gossip_request: [1, 'sendGossipRequest'],
	gossip_response: [2, 'sendGossipResponse'],
	channel_history_want: [2, 'channel_history_want'],
	fed_volatile: [10, 'sendFedVolatile'],
	fed_tip_ping: [3, 'sendTipPing'],
	fed_partition_bridge: [5, 'fed_partition_bridge'],
	fed_bootstrap_request: [2, 'sendBootstrapRequest'],
	fed_bootstrap_response: [2, 'sendBootstrapResponse'],
	fed_join_snapshot_request: [2, 'fed_join_snapshot_request'],
	fed_archive_month_want: [2, 'fed_archive_month_want'],
	fed_archive_month_response: [2, 'fed_archive_month_response'],
	discovery_announce: [3, 'sendDiscoveryAnnounce'],
	discovery_query: [3, 'sendDiscoveryQuery'],
	discovery_query_response: [3, 'sendDiscoveryQueryResponse'],
}

/**
 * @param {Map<string, Function>} senderRegistry wireAction 注册的 send 表
 * @param {string} actionName Trystero action
 * @returns {Function} send
 */
function requireRegistrySender(senderRegistry, actionName) {
	const send = senderRegistry.get(actionName)
	if (!send) throw new Error(`federation action not registered: ${actionName}`)
	return send
}

/**
 * @typedef {object} FederationRoomContext
 * @property {string} partitionId
 * @property {string} trysteroRoomName
 * @property {object} room
 * @property {string} mqttPassword
 * @property {string} groupId
 * @property {string} roomKey
 * @property {object} rtcLimits
 * @property {object} fedOut
 * @property {Map<string, string>} peerToNode
 * @property {Map<string, string>} nodeToPeer
 * @property {(name: string) => Function} getActionSender
 * @property {Map<string, Function>} senderRegistry
 */

/**
 * @typedef {FederationRoomContext & {
 *   getRoster: () => Array<{ peerId: string, remoteNodeHash: string | undefined }>
 *   getPeerIdByNodeHash: (nodeHash: string) => string | null
 *   sendToPeer: (peerId: string, actionName: string, payload: unknown) => void
 *   send: (actionName: string, payload: unknown, peerId?: string | null) => void
 * }} FederationSlot
 */

/**
 * @param {FederationRoomContext} roomContext 房间上下文（由 room.mjs 组装）
 * @returns {FederationSlot} 联邦房间槽
 */
export function buildFederationSlot(roomContext) {
	const {
		partitionId,
		trysteroRoomName,
		room,
		mqttPassword,
		groupId,
		roomKey,
		rtcLimits,
		fedOut,
		peerToNode,
		nodeToPeer,
		getActionSender,
		senderRegistry,
	} = roomContext

	/** @type {Map<string, (payload: unknown, peerId: string | null) => void>} */
	const boundByAction = new Map()

	for (const [actionName, [priority, label]] of Object.entries(FED_ACTION_SPECS)) {
		const guard = actionName === 'fed_partition_bridge'
			? () => isFederationActionAllowedUnderLoad(roomKey, actionName, rtcLimits)
			: undefined
		boundByAction.set(actionName, bindFedSender(
			fedOut,
			priority,
			label,
			requireRegistrySender(senderRegistry, actionName),
			guard,
		))
	}

	/** @type {FederationSlot} */
	const slot = {
		partitionId,
		trysteroRoomName,
		room,
		mqttPassword,
		groupId,
		roomKey,
		rtcLimits,
		fedOut,
		peerToNode,
		nodeToPeer,
		getActionSender,
		senderRegistry,
		/** @returns {{ peerId: string, remoteNodeHash: string | undefined }[]} 房内 roster */
		getRoster() {
			return [...peerToNode.entries()].map(([peerId, remoteNodeHash]) => ({ peerId, remoteNodeHash }))
		},
		/**
		 * @param {string} targetNodeId 目标 nodeHash
		 * @returns {string | null} Trystero peerId
		 */
		getPeerIdByNodeHash(targetNodeId) { return nodeToPeer.get(targetNodeId) ?? null },
		/**
		 * @param {string} peerId 目标 peer
		 * @param {string} actionName Trystero action
		 * @param {unknown} payload 载荷
		 * @returns {void}
		 */
		sendToPeer(peerId, actionName, payload) { getActionSender(actionName)(payload, peerId) },
		/**
		 * @param {string} actionName Trystero action
		 * @param {unknown} payload 载荷
		 * @param {string | null} [peerId] 目标 peer；null 为广播
		 * @returns {void}
		 */
		send(actionName, payload, peerId = null) {
			const fn = boundByAction.get(actionName)
			if (!fn) throw new Error(`federation action not supported: ${actionName}`)
			fn(payload, peerId)
		},
	}

	return slot
}
