/**
 * 联邦房间生命周期：按需 join 信令分区、注册 handler、暴露 FederationSlot。
 */
import { normalizeHex64 } from '../../../../../../../scripts/p2p/hexIds.mjs'
import { createActionRegistry } from '../../../../../../../scripts/p2p/action_registry.mjs'
import { createGroupLinkSet } from '../../../../../../../scripts/p2p/group_link_set.mjs'
import { isPeerPoolKeyBlocked, loadPeerPoolView } from '../../../../../../../scripts/p2p/network.mjs'
import { eventsPath } from '../lib/paths.mjs'
import { onFederationRoomReadyForMailbox } from '../mailbox/ingest.mjs'

import { attachFedChunkHandlers, unregisterChunkSwarm } from './chunks.mjs'
import { loadFederationGroupSettings, loadFederationMaterializedState, localNodeHash, requireDagDeps } from './deps.mjs'
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
import { peekFederationBootstrap, peekPeerRoomHint } from './bootstrapStore.mjs'
import { resolveGroupRoomCredentials } from './roomCredentials.mjs'
import { attachFederationRoomHandlers } from './roomHandlers/index.mjs'
import { createFederationRoomHandlerBundle } from './roomHandlers/roomContext.mjs'
import { warmSeenFromLocalEvents } from './seen.mjs'
import { startTipHeartbeat } from './tipHeartbeat.mjs'

/** @typedef {import('./federationSlot.mjs').FederationSlot} FederationSlot */

/** 删群/退群拆除时 await slot leave 的上限（毫秒），避免 relay 慢导致拆除卡住。 */
const DEFAULT_ROOM_LEAVE_TIMEOUT_MS = 4000

/**
 * @param {import('./federationSlot.mjs').FederationSlot | null | undefined} slot 已注册槽
 * @param {{ roomId: string, password: string }} roomCreds 期望凭证
 * @returns {boolean} slot 是否仍绑定同一 room
 */
function partitionSlotMatchesCredentials(slot, roomCreds) {
	return slot?.roomId === roomCreds.roomId && slot?.roomSecret === roomCreds.password
}

/**
 * @param {string} username 用户名
 * @param {string} groupId 群组 ID
 * @param {string} partitionId 分区 id
 * @returns {Promise<boolean>} 分区已绑定且凭证未变
 */
async function isFederationPartitionAlreadyBound(username, groupId, partitionId) {
	if (!hasFederationPartitionSlot(username, groupId, partitionId)) return false
	let roomCreds
	try {
		roomCreds = await resolveGroupRoomCredentials(username, groupId, partitionId)
	}
	catch {
		return false
	}
	return partitionSlotMatchesCredentials(getFederationPartitionSlot(username, groupId, partitionId), roomCreds)
}

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
 * 本群所需分区均已绑定且 room 凭证未变（rebind 幂等跳过）。
 * @param {string} username 用户名
 * @param {string} groupId 群组 ID
 * @param {{ channelId?: string }} [opts] 当前活跃频道
 * @returns {Promise<boolean>} 是否已全部绑定且凭证未变
 */
export async function isFederationRoomAlreadyBound(username, groupId, opts = {}) {
	const groupSettings = await loadFederationGroupSettings(username, groupId)
	const partitionIds = resolveNodePartitionIds(groupSettings, opts.channelId)
	if (!partitionIds.length) return false
	for (const partitionId of partitionIds) 
		if (!await isFederationPartitionAlreadyBound(username, groupId, partitionId)) return false
	
	return true
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
	/** @type {import('./federationSlot.mjs').FederationSlot | null | undefined} */
	let supersededSlot = null
	if (hasFederationPartitionSlot(username, groupId, partitionId)) {
		const existing = getFederationPartitionSlot(username, groupId, partitionId)
		if (partitionSlotMatchesCredentials(existing, roomCreds))
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
		const nodeHash = localNodeHash()
		const roomId = roomCreds.roomId
		try {
			const localEvents = await readJsonl(eventsPath(username, groupId))
			warmSeenFromLocalEvents(username, groupId, localEvents)
			const members = Object.values((await loadFederationMaterializedState(username, groupId))?.members || {})
				.map(member => normalizeHex64(member?.homeNodeHash || member?.nodeHash))
				.filter(Boolean)
			const bootstrapNodeHash = normalizeHex64(peekFederationBootstrap(username, groupId)?.fromNodeId)
			const peerHintNodeHash = normalizeHex64(peekPeerRoomHint(username, groupId)?.fromNodeId)
			if (bootstrapNodeHash) members.push(bootstrapNodeHash)
			if (peerHintNodeHash) members.push(peerHintNodeHash)
			const room = createGroupLinkSet({
				groupId,
				roomSecret: roomCreds.password,
				members,
			})
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
			const wireActions = createActionRegistry(room)
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
			const isBlockedPeer = subject => isPeerPoolKeyBlocked(loadPeerPoolView(groupId), subject)

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
				roomId,
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

			await room.start()

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
