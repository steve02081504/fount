/**
 * 联邦房间生命周期：按需 join MQTT 分区、注册 handler、暴露 FederationSlot。
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
import { attachFedEmojiHandlers } from './groupEmojiFederation.mjs'
import { resolveGroupMqttCredentials } from './mqttCredentials.mjs'
import { createFedOutQueue } from './outbound.mjs'
import { LOGIC_SYNC_PARTITION, partitionForOutboundEvent, resolveNodePartitionIds } from './partitions.mjs'
import {
	bumpFederationPartitionRebindGen,
	deleteFederationPartitionInflight,
	deleteFederationPartitionSlot,
	getFederationPartitionInflight,
	getFederationPartitionRebindGen,
	getFederationPartitionSlot,
	groupFederationOwner,
	hasFederationPartitionSlot,
	invalidateFederationPartitionsForGroup,
	setFederationPartitionInflight,
	setFederationPartitionSlot,
} from './registry.mjs'
import { attachFederationRoomHandlers } from './roomHandlers/index.mjs'
import { createFederationRoomHandlerBundle } from './roomHandlers/roomContext.mjs'
import { warmSeenFromLocalEvents } from './seen.mjs'
import { startTipHeartbeat } from './tipHeartbeat.mjs'

/** @typedef {import('./federationSlot.mjs').FederationSlot} FederationSlot */

/**
 * 群联邦连接缓存失效（房间名或成员变更后调用）。
 * @param {string} username 用户名
 * @param {string} groupId 群组 ID
 * @returns {void}
 */
export function invalidateFederationRoomCache(username, groupId) {
	unregisterChunkSwarm(username, groupId)
	invalidateFederationPartitionsForGroup(username, groupId)
}

/**
 * 按需加入本群所需 MQTT 分区（频道 + 逻辑慢同步）。
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
	let mqttCreds
	try {
		mqttCreds = await resolveGroupMqttCredentials(username, groupId, partitionId)
	}
	catch {
		return null
	}
	const rtcRoomKey = `${username}:${groupId}:${partitionId}`
	const desiredRoomName = mqttCreds.roomId
	const desiredPassword = mqttCreds.password
	if (hasFederationPartitionSlot(username, groupId, partitionId)) {
		const existing = getFederationPartitionSlot(username, groupId, partitionId)
		if (existing?.trysteroRoomName === desiredRoomName && existing?.mqttPassword === desiredPassword)
			return existing
		deleteFederationPartitionSlot(username, groupId, partitionId)
		bumpFederationPartitionRebindGen(username, groupId, partitionId)
	}
	const inflight = getFederationPartitionInflight(username, groupId, partitionId)
	if (inflight) return await inflight

	const roomJoinTask = (async () => {
		const genAtJoin = getFederationPartitionRebindGen(username, groupId, partitionId)
		const { readJsonl } = requireDagDeps()
		const nodeHash = federationNodeHash(username)
		const trysteroRoomName = mqttCreds.roomId
		try {
			const localEvents = await readJsonl(eventsPath(username, groupId))
			warmSeenFromLocalEvents(username, groupId, localEvents)
			const data = getFederationSettings(username)
			const customRelays = Array.isArray(data.relayUrls)
				? data.relayUrls.map(url => String(url).trim()).filter(url => url.startsWith('wss://'))
				: []
			// 空 = 用默认中继（传 undefined 触发 buildTrysteroMqttConfig 的默认回退）。
			const relayUrls = customRelays.length ? customRelays : undefined
			const { joinMqttRoomWithDefaults } = await import('../../../../../../../scripts/p2p/mqtt_room.mjs')
			const { resolveIceServers } = await import('../../../../../../../scripts/p2p/ice_servers.mjs')
			const room = await joinMqttRoomWithDefaults({
				appId: mqttCreds.appId,
				password: mqttCreds.password,
				roomId: trysteroRoomName,
				relayUrls,
				iceServers: resolveIceServers(groupSettings),
			})
			const fedOut = createFedOutQueue()
			const rtcLimits = {
				maxActive: Number(groupSettings.rtcConnectionBudgetMax) || 32,
				maxJoinsPerMin: Number(groupSettings.rtcJoinRatePerMin) || 12,
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
			const peersSnap = loadPeerPoolView(username, groupId)
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
				mqttPassword: mqttCreds.password,
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

			if (getFederationPartitionRebindGen(username, groupId, partitionId) !== genAtJoin) {
				unregisterChunkSwarm(username, groupId)
				// 本次 join 已被更新的 rebind 作废：必须 leave 这个刚加入的房间，否则它成为孤儿持连。
				void slot.leave().catch(error => console.error('federation: stale room teardown failed', error))
				return null
			}
			setFederationPartitionSlot(username, groupId, partitionId, slot)
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
			console.error('federation: joinMqttRoom failed', error)
			return null
		}
		finally {
			deleteFederationPartitionInflight(username, groupId, partitionId)
		}
	})()
	setFederationPartitionInflight(username, groupId, partitionId, roomJoinTask)
	return roomJoinTask
}
