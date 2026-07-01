/**
 * 联邦房间生命周期：按需 join 信令分区、注册 handler、暴露 FederationSlot。
 */
import { isPeerPoolKeyBlocked, loadPeerPoolView } from '../../../../../../../scripts/p2p/network.mjs'
import { createTrysteroActionRegistry } from '../../../../../../../scripts/p2p/trystero_session.mjs'
import { eventsPath } from '../lib/paths.mjs'
import { onFederationRoomReadyForMailbox } from '../mailbox/ingest.mjs'

import { attachFedChunkHandlers, unregisterChunkSwarm } from './chunks.mjs'
import { getFederationSettings } from './config.mjs'
import { loadFederationGroupSettings, federationNodeHash, requireDagDeps } from './deps.mjs'
import { publishDiscoveryAnnounceForGroup } from './discoveryRelay.mjs'
import { buildFederationSlot } from './federationSlot.mjs'
import { FEDERATION_WIRE_ACTION_NAMES } from './federationWireActions.mjs'
import { attachFedGroupCardHandlers } from './groupCardFederation.mjs'
import { attachFedEmojiHandlers } from './groupEmojiFederation.mjs'
import { createFedOutQueue } from './outbound.mjs'
import { LOGIC_SYNC_PARTITION, partitionForOutboundEvent, resolveNodePartitionIds } from './partitions.mjs'
import {
	bumpFederationPartitionRebindGen,
	deleteFederationPartitionInflight,
	detachFederationPartitionSlot,
	getFederationPartitionInflight,
	forEachFederationRoomSlotInGroup,
	getFederationPartitionRebindGen,
	getFederationPartitionSlot,
	groupFederationOwner,
	hasFederationPartitionSlot,
	invalidateFederationPartitionsForGroup,
	setFederationPartitionInflight,
	setFederationPartitionSlot,
} from './registry.mjs'
import { resolveGroupRoomCredentials } from './roomCredentials.mjs'
import { attachFederationRoomHandlers } from './roomHandlers/index.mjs'
import { createFederationRoomHandlerBundle } from './roomHandlers/roomContext.mjs'
import { warmSeenFromLocalEvents } from './seen.mjs'
import { startTipHeartbeat } from './tipHeartbeat.mjs'

/** @typedef {import('./federationSlot.mjs').FederationSlot} FederationSlot */

/** 删群/退群拆除时 await slot leave 的上限（毫秒），避免 relay 慢导致拆除卡住。 */
const DEFAULT_ROOM_LEAVE_TIMEOUT_MS = 4000

/**
 * 群联邦连接缓存失效（房间名或成员变更后调用；fire-and-forget leave）。
 * @param {string} username 用户名
 * @param {string} groupId 群组 ID
 * @returns {void}
 */
export function invalidateFederationRoomCache(username, groupId) {
	unregisterChunkSwarm(username, groupId)
	invalidateFederationPartitionsForGroup(username, groupId)
}

/**
 * 拆除本群所有联邦 slot：先 await 其 leave（带短超时），再做注册表失效（bump rebind gen）。
 *
 * 删群/退群路径专用：删盘前 await leave 杜绝 werift 持连泄漏；注册表 bump gen 让 invalidate 之后才完成的
 * inflight join 因 gen 不匹配而放弃回填 slot（room.mjs join 完成处据此 leave 迟到房间）。
 * @param {string} username 用户名
 * @param {string} groupId 群组 ID
 * @param {{ leaveTimeoutMs?: number }} [opts] leave 等待上限
 * @returns {Promise<void>}
 */
export async function teardownFederationRoomForGroup(username, groupId, opts = {}) {
	unregisterChunkSwarm(username, groupId)
	const leaveTimeoutMs = Number(opts.leaveTimeoutMs) > 0 ? Number(opts.leaveTimeoutMs) : DEFAULT_ROOM_LEAVE_TIMEOUT_MS
	/** @type {Promise<void>[]} */
	const leaves = []
	forEachFederationRoomSlotInGroup(username, groupId, slot => {
		if (slot && typeof slot.leave === 'function')
			leaves.push(Promise.resolve(slot.leave()).catch(error => console.error('federation: slot leave failed', error)))
	})
	if (leaves.length)
		await Promise.race([
			Promise.allSettled(leaves),
			new Promise(resolve => setTimeout(resolve, leaveTimeoutMs)),
		])
	invalidateFederationPartitionsForGroup(username, groupId)
}

/**
 * 按需加入本群所需 信令分区（频道 + 逻辑慢同步）。
 * @param {string} username 用户名
 * @param {string} groupId 群组 ID
 * @param {{ channelId?: string }} [opts] 当前活跃频道
 * @returns {Promise<FederationSlot | null>} 主分区槽（非 sync）或唯一槽
 */
export async function ensureFederationRoom(username, groupId, opts = {}) {
	const groupSettings = await loadFederationGroupSettings(username, groupId)
	const partitionIds = resolveNodePartitionIds(groupSettings, opts.channelId)
	let primary = null
	for (const partitionId of partitionIds) {
		const slot = await ensureFederationPartitionRoom(username, groupId, partitionId, opts)
		if (partitionId !== LOGIC_SYNC_PARTITION) primary = slot || primary
		else if (!primary) primary = slot
	}
	return primary
}

/**
 * 按 action 决定联邦出站槽（频道事件优先走 ch-XX；其他走 sync）。
 * @param {string} username 用户名
 * @param {string} groupId 群组 ID
 * @param {{ actionName?: string, channelId?: string, eventType?: string }} [opts] 出站提示
 * @returns {Promise<FederationSlot | null>} 对应分区槽
 */
export async function resolveFederationSlotForAction(username, groupId, opts = {}) {
	const groupSettings = await loadFederationGroupSettings(username, groupId)
	const action = String(opts.actionName || '').trim().toLowerCase()
	const eventType = String(opts.eventType || '').trim().toLowerCase()
	const channelId = String(opts.channelId || '').trim() || undefined
	if (action === 'dag_event' || eventType)
		return await ensureFederationPartitionRoom(
			username,
			groupId,
			partitionForOutboundEvent(eventType || action, channelId, groupSettings),
			{ channelId },
		)
	if (action === 'fed_chunk_get' || action === 'fed_chunk_put' || action === 'fed_chunk_data')
		return await ensureFederationRoom(username, groupId, { channelId })
	return await ensureFederationPartitionRoom(username, groupId, LOGIC_SYNC_PARTITION, { channelId })
}

/**
 * @param {string} username 用户名
 * @param {string} groupId 群组 ID
 * @param {string} partitionId 分区 id
 * @param {{ channelId?: string }} [opts] 选项
 * @returns {Promise<FederationSlot | null>} 房间句柄或 null
 */
export async function ensureFederationPartitionRoom(username, groupId, partitionId = LOGIC_SYNC_PARTITION, opts = {}) {
	const groupSettings = await loadFederationGroupSettings(username, groupId)
	let roomCreds
	try {
		roomCreds = await resolveGroupRoomCredentials(username, groupId, partitionId)
	}
	catch {
		return null
	}
	const rtcRoomKey = `${username}:${groupId}:${partitionId}`
	const desiredRoomName = roomCreds.roomId
	const desiredPassword = roomCreds.password
	/** @type {import('./federationSlot.mjs').FederationSlot | null | undefined} */
	let supersededSlot = null
	if (hasFederationPartitionSlot(username, groupId, partitionId)) {
		const existing = getFederationPartitionSlot(username, groupId, partitionId)
		if (existing?.trysteroRoomName === desiredRoomName && existing?.roomSecret === desiredPassword)
			return existing
		// join-before-leave 以 slot 粒度实现：先 detach 旧 slot、join 新 room，成功后再 leave 旧 slot，避免 offerPool 归零销毁。
		supersededSlot = detachFederationPartitionSlot(username, groupId, partitionId) ?? null
		bumpFederationPartitionRebindGen(username, groupId, partitionId)
	}
	const inflight = getFederationPartitionInflight(username, groupId, partitionId)
	if (inflight) return await inflight

	const roomJoinTask = (async () => {
		const genAtJoin = getFederationPartitionRebindGen(username, groupId, partitionId)
		const { readJsonl } = requireDagDeps()
		const nodeHash = federationNodeHash(username)
		const trysteroRoomName = roomCreds.roomId
		try {
			const localEvents = await readJsonl(eventsPath(username, groupId))
			warmSeenFromLocalEvents(username, groupId, localEvents)
			const data = await getFederationSettings(username)
			const customRelays = Array.isArray(data.relayUrls)
				? data.relayUrls.map(url => String(url).trim()).filter(url => url.startsWith('wss://'))
				: []
			// 空 = 用默认中继（传 undefined 触发 buildTrysteroSignalingConfig 的默认回退）。
			const relayUrls = customRelays.length ? customRelays : undefined
			const { joinSignalingRoomWithDefaults } = await import('../../../../../../../scripts/p2p/signaling_room.mjs')
			const { resolveIceServers } = await import('../../../../../../../scripts/p2p/ice_servers.mjs')
			const room = await joinSignalingRoomWithDefaults({
				appId: roomCreds.appId,
				password: roomCreds.password,
				roomId: trysteroRoomName,
				relayUrls,
				iceServers: resolveIceServers(groupSettings),
			})
			// join 命中硬超时（串行队列积压）：放弃本次，房间最终一致交由后续 ensureFederationRoom / catch-up 兜底。
			if (!room) return null
			const fedOut = createFedOutQueue()
			const peersSnap = loadPeerPoolView(groupId)
			const rtcLimits = {
				maxActive: Number(groupSettings.rtcConnectionBudgetMax) || 32,
				maxJoinsPerMin: Number(groupSettings.rtcJoinRatePerMin) || 12,
				trustedPeers: peersSnap.trustedPeers,
			}

			/** @type {Map<string, string>} */
			const peerToNode = new Map()
			/** @type {Map<string, string>} */
			const nodeToPeer = new Map()
			/** @type {Map<string, Function>} */
			const senderRegistry = new Map()
			const wireActions = createTrysteroActionRegistry(room)
			wireActions.register(FEDERATION_WIRE_ACTION_NAMES)

			/**
			 * @param {string} name action 名称
			 * @returns {Function} 发送函数
			 */
			function getActionSender(name) {
				return senderRegistry.get(name) ?? wireActions.sender(name)
			}
			/**
			 * @param {string} name action 名称
			 * @returns {Function} 入站注册函数
			 */
			function getActionReceiver(name) {
				return wireActions.receiver(name)
			}

			/** @type {FederationSlot | null} */
			let slotRef = null
			/**
			 * @param {string} subject 节点 id 或 pubKeyHash
			 * @returns {boolean} 是否已拉黑
			 */
			const isBlockedPeer = subject => isPeerPoolKeyBlocked(peersSnap, subject)

			attachFederationRoomHandlers(createFederationRoomHandlerBundle({
				username,
				groupId,
				key: rtcRoomKey,
				nodeHash,
				groupSettings,
				room,
				fedOut,
				rtcLimits,
				peerToNode,
				nodeToPeer,
				senderRegistry,
				wireActions,
				getActionSender,
				getActionReceiver,
				ensureFederationPartitionRoom,
				isBlockedPeer,
				/** @returns {FederationSlot | null} 当前房间槽 */
				getSlot: () => slotRef,
			}))

			const slot = buildFederationSlot({
				partitionId,
				trysteroRoomName,
				room,
				roomSecret: roomCreds.password,
				groupId,
				roomKey: rtcRoomKey,
				rtcLimits,
				fedOut,
				peerToNode,
				nodeToPeer,
				getActionSender,
				senderRegistry,
			})
			slotRef = slot

			attachFedChunkHandlers({
				username,
				groupId,
				room,
				peerToNode,
				isBlockedPeer,
				slot,
				fedOut,
				roomKey: rtcRoomKey,
				rtcLimits,
			})
			attachFedEmojiHandlers({
				username,
				groupId,
				key: rtcRoomKey,
				fedOut,
				rtcLimits,
				peerToNode,
				isBlockedPeer,
				slot,
				senderRegistry,
				wireActions,
			})
			attachFedGroupCardHandlers({
				username,
				groupId,
				key: rtcRoomKey,
				fedOut,
				rtcLimits,
				peerToNode,
				isBlockedPeer,
				slot,
				senderRegistry,
				wireActions,
			})

			if (getFederationPartitionRebindGen(username, groupId, partitionId) !== genAtJoin) {
				unregisterChunkSwarm(username, groupId)
				// 本次 join 已被更新的 rebind gen 作废（删群/退群 teardown 在删盘前 bump gen）：必须 leave 这个刚加入的房间，
				// 否则删群后完成的 inflight join 会回填孤儿 slot，造成 werift 持连泄漏（NodeB OOM）。
				void slot.leave().catch(error => console.error('federation: stale room teardown failed', error))
				return null
			}
			setFederationPartitionSlot(username, groupId, partitionId, slot)
			if (supersededSlot?.isActive?.() && supersededSlot !== slot)
				void supersededSlot.leave().catch(error => console.error('federation: superseded slot leave failed', error))
			groupFederationOwner.set(groupId, username)
			// 方案3：tip 心跳仅在逻辑同步分区 slot 上启动——catch-up 本身也只走 sync 分区，
			// 避免每个频道分区 slot 都读盘+广播全群 tips 的 N 倍冗余。入站补齐 hook（sync.mjs）仍对所有分区生效。
			if (partitionId === LOGIC_SYNC_PARTITION)
				slot.registerCleanup(startTipHeartbeat({ slot, username, groupId, nodeHash, groupSettings }))
			void publishDiscoveryAnnounceForGroup(username, groupId, nodeHash, slot)
				.catch(error => console.warn('federation: initial discovery announce failed', error))
			void onFederationRoomReadyForMailbox(username, groupId)
				.catch(error => console.warn('federation: mailbox ready hook failed', error))
			return slot
		}
		catch (error) {
			console.error('federation: joinSignalingRoom failed', error)
			if (supersededSlot?.isActive?.())
				setFederationPartitionSlot(username, groupId, partitionId, supersededSlot)
			return null
		}
		finally {
			deleteFederationPartitionInflight(username, groupId, partitionId)
		}
	})()
	setFederationPartitionInflight(username, groupId, partitionId, roomJoinTask)
	return roomJoinTask
}
