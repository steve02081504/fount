/**
 * 联邦房间 FederationSlot：roomContext + 统一 send(action, payload, peerId)。
 */
import { pruneStaleRosterEntries } from '../../../../../../../scripts/p2p/peer_identity_maps.mjs'
import { isFederationActionAllowedUnderLoad } from '../../../../../../../scripts/p2p/rtc_connection_budget.mjs'
import { recordStalePeerPrune } from '../../../../../../../scripts/p2p/stale_peer_log.mjs'

import { bindFedSender } from './outbound.mjs'

/** @type {Record<string, [number, string]>} group scope action → [priority, logLabel] */
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
 * @param {string} actionName group scope action
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
 * @property {string} roomId
 * @property {object} room
 * @property {string} roomSecret
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
 *   registerCleanup: (fn: () => void) => void
 *   leave: () => Promise<void>
 *   isActive: () => boolean
 * }} FederationSlot
 */

/**
 * @param {FederationRoomContext} roomContext 房间上下文（由 room.mjs 组装）
 * @returns {FederationSlot} 联邦房间槽
 */
export function buildFederationSlot(roomContext) {
	const {
		partitionId,
		roomId,
		room,
		roomSecret,
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

	// slot 生命周期：失活后 leave 幂等，且 roster 不再被孤儿 handler 读到。
	let active = true

	/**
	 * 用实时连接表（room.getPeers）校正身份映射：剔除已无活连接的 peerId（自愈），并记录观测。
	 * roster/目标解析的唯一可信前置——杜绝向死 peer 发包（"no peer with id ... found" 静默丢失）。
	 * @returns {void}
	 */
	const reconcileLivePeers = () => {
		const livePeerIds = Object.keys(room?.getPeers?.() || {})
		const stale = pruneStaleRosterEntries(peerToNode, nodeToPeer, livePeerIds)
		if (stale.length) recordStalePeerPrune(groupId, stale, { partitionId })
	}

	// slot 绑定的资源清理回调（如 tip 心跳 setInterval）：leave() 时统一执行，杜绝孤儿定时器。
	/** @type {Set<() => void>} */
	const cleanups = new Set()

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
		roomId,
		room,
		roomSecret,
		groupId,
		roomKey,
		rtcLimits,
		fedOut,
		peerToNode,
		nodeToPeer,
		getActionSender,
		senderRegistry,
		/** @returns {{ peerId: string, remoteNodeHash: string | undefined }[]} 房内（活连接）roster */
		getRoster() {
			reconcileLivePeers()
			return [...peerToNode.entries()].map(([peerId, remoteNodeHash]) => ({ peerId, remoteNodeHash }))
		},
		/**
		 * @param {string} targetNodeId 目标 nodeHash
		 * @returns {string | null} 在线 peerId（仅在活连接时返回）
		 */
		getPeerIdByNodeHash(targetNodeId) {
			reconcileLivePeers()
			return nodeToPeer.get(targetNodeId) ?? null
		},
		/**
		 * @param {string} peerId 目标 peer
		 * @param {string} actionName group scope action
		 * @param {unknown} payload 载荷
		 * @returns {void}
		 */
		sendToPeer(peerId, actionName, payload) { getActionSender(actionName)(payload, peerId) },
		/**
		 * @param {string} actionName group scope action
		 * @param {unknown} payload 载荷
		 * @param {string | null} [peerId] 目标 peer；null 为广播
		 * @returns {void}
		 */
		send(actionName, payload, peerId = null) {
			const fn = boundByAction.get(actionName)
			if (!fn) throw new Error(`federation action not supported: ${actionName}`)
			fn(payload, peerId)
		},
		/**
		 * 注册 slot 绑定资源的清理回调（如定时器），leave() 时统一执行。
		 * 失活后注册的回调会被立即执行，避免在 leave 之后启动的资源泄漏。
		 * @param {() => void} fn 清理函数
		 * @returns {void}
		 */
		registerCleanup(fn) {
			if (typeof fn !== 'function') return
			if (!active) { try { fn() } catch (error) { console.error('federation: slot cleanup failed', error) } return }
			cleanups.add(fn)
		},
		/**
		 * 离开底层 group scope 房间并清空 roster/映射，使旧 slot 干净失活。
		 *
		 * 替换/失效 slot 时必须调用：否则旧房间仍在后台存活、peer 连在孤儿房间，
		 * 而新 slot 的 roster 为空 → /peers 空、出站发布落在无 peer 的当前 slot（live push 丢失）。
		 * @returns {Promise<void>} teardown 完成
		 */
		async leave() {
			if (!active) return
			active = false
			// 先清理 slot 绑定资源（定时器等），再 leave 房间，杜绝孤儿定时器继续发心跳。
			for (const fn of cleanups)
				try { fn() }
				catch (error) { console.error('federation: slot cleanup failed', error) }
			cleanups.clear()
			try {
				await room?.leave?.()
			}
			catch (error) {
				console.error('federation: room leave failed', error)
			}
			peerToNode.clear()
			nodeToPeer.clear()
		},
		/** @returns {boolean} slot 是否仍有效（未 leave） */
		isActive() { return active },
	}

	return slot
}
