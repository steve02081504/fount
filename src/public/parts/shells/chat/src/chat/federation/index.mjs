/**
 * 【文件】federation/index.mjs
 * 【职责】联邦对外门面：已签名 DAG 事件出站中继、与邻居交换 DAG 叶并触发 wantIds 补洞、gossip 拉取缺失事件，以及列出当前 Trystero 房内对等端。
 * 【原理】出站经 ensureFederationRoom 取得 Trystero Nostr 房间槽，由 peerPool 稀疏选取目标 peer（无邻居时房内广播）；入站补洞先发 fed_tip_ping/pong 收集远端 tips，再 requestMissingEventsGossip。ACL 门控事件在物化快照未就绪时入 pendingRelay 队列而非立即中继。
 * 【数据结构】signPayload 为已验签 DAG 行；catchUp 返回 tipsCollected、wantIds、eventsFilled 等统计；listFederationPeers 返回 selfNodeHash、peers 名册。
 * 【关联】room.mjs、acl.mjs、pendingRelay.mjs、gossip.mjs、archiveHandshake.mjs、peerPool.mjs、deps.mjs、registry.mjs；DAG 读写在 scripts/p2p 与 dag/ 层。
 */
import { clampNumber } from '../../../../../../../scripts/clamp.mjs'
import { sortedPrevEventIds } from '../../../../../../../scripts/p2p/dag/index.mjs'
import { readJsonlStream } from '../../../../../../../scripts/p2p/dag/storage.mjs'
import { stripDagEventLocalExtensions } from '../../../../../../../scripts/p2p/dag/strip_extensions.mjs'
import { computeDagTipIdsFromEvents } from '../../../../../../../scripts/p2p/governance_branch.mjs'
import { pickFederationTargetPeerIds, reconcilePeerPoolFromRoster } from '../../../../../../../scripts/p2p/peer_pool.mjs'
import { getStalePeerPruneCount } from '../../../../../../../scripts/p2p/stale_peer_log.mjs'
import { isWantIdsInBackoff, wantIdsGroupKey } from '../../../../../../../scripts/p2p/want_ids.mjs'
import { sleep } from '../../../../../../../scripts/sleep.mjs'
import { syncMissingArchiveMonths } from '../archive/syncMonths.mjs'
import { eventChannelId } from '../dag/authorizeEvent.mjs'
import { readQuarantineRows } from '../events/quarantine.mjs'
import { eventsPath } from '../lib/paths.mjs'

import {
	canRelayFederatedEvent,
	shouldDeferFederatedRelay,
} from './acl.mjs'
import { wireArchiveSummary, loadLocalFederationArchive } from './archiveHandshake.mjs'
import { maybeRequestBootstrapAfterCatchup } from './bootstrapRelay.mjs'
import { localNodeHash, loadFederationGroupSettings, loadFederationMaterializedState, requireDagDeps } from './deps.mjs'
import { requestMissingEventsGossip } from './gossip.mjs'
import { requestJoinSnapshotFromPeers } from './joinSnapshot.mjs'
import { sendPartitionBridgeFromSlot } from './partitionBridge.mjs'
import {
	LOGIC_SYNC_PARTITION,
	nodeHasPartition,
	partitionForOutboundEvent,
	pickLocalRelayPartition,
} from './partitions.mjs'
import { readPendingIngestRows } from './pendingIngest.mjs'
import { enqueuePendingRelay } from './pendingRelay.mjs'
import { EVENT_ID_HEX, forEachFederationRoomSlotInGroup, getFederationPartitionSlot } from './registry.mjs'
import { ensureFederationPartitionRoom, ensureFederationRoom } from './room.mjs'
import { maybeJoinSnapshotOnStaleTips } from './staleResync.mjs'
import { markGroupOnlineSynced } from './syncState.mjs'
import { collectRemoteTipsFromPeers } from './tipExchange.mjs'

/** @type {Map<string, Promise<object>>} 同群并发 catchup 合并为单次执行，避免重叠读盘/补洞占满堆。 */
const catchUpInflight = new Map()

/** 首次入群无 checkpoint 时等待 信令 roster 出现邻居的上限（毫秒）。 */
const PEER_ROSTER_WAIT_MS = 12_000
const PEER_ROSTER_POLL_MS = 400

/**
 * 等待联邦房间 roster 出现至少一名邻居（新成员 join snapshot 前置条件）。
 * @param {object} slot FederationSlot
 * @param {{ maxWaitMs?: number }} [opts] 等待上限
 * @returns {Promise<boolean>} roster 非空则为 true
 */
async function waitForFederationPeers(slot, opts = {}) {
	const maxWaitMs = clampNumber(opts.maxWaitMs ?? PEER_ROSTER_WAIT_MS, 500, 60_000)
	const start = Date.now()
	while (Date.now() - start < maxWaitMs) {
		if (slot.getRoster().length > 0) return true
		await sleep(PEER_ROSTER_POLL_MS)
	}
	return slot.getRoster().length > 0
}

/**
 * 向联邦邻居请求入群快照（wire-only 请求；用于快速补齐 checkpoint/历史）。
 * @see requestJoinSnapshotFromPeers
 */
export { requestJoinSnapshotFromPeers }

/**
 * 联邦 VOLATILE 中继符号（自 volatile.mjs 再导出）。
 */
export {
	isFederableVolatilePayload,
	publishVolatileToFederation,
} from './volatile.mjs'

/**
 * @param {object} slot 联邦槽
 * @param {unknown} payload 载荷
 * @param {string[]} targets peerId 列表
 * @param {(slot: object, payload: unknown, peerId: string | null) => void} sendFn 发送函数
 * @returns {void}
 */
function deliverToFederationTargets(slot, payload, targets, sendFn) {
	if (!targets.length) {
		sendFn(slot, payload, null)
		return
	}
	for (const peerId of targets)
		sendFn(slot, payload, peerId)
}

/**
 * 将已签名事件发往稀疏池选中的邻居（无在线邻居时回退房内广播）。
 * @param {string} username 用户
 * @param {string} groupId 群 ID
 * @param {object} signPayload 签名事件
 * @param {{ state?: object, existingSlotOnly?: boolean, joinTimeoutMs?: number }} [opts] 出站选项
 * @returns {Promise<void>}
 */
export async function publishSignedEventToFederation(username, groupId, signPayload, opts = {}) {
	const nodeHash = localNodeHash()
	const materializedState = opts.state ?? await loadFederationMaterializedState(username, groupId)
	if (!materializedState) return
	const { groupSettings } = materializedState
	const eventType = String(signPayload.type).trim().toLowerCase()
	const channelId = eventChannelId(signPayload)
	const targetPartition = partitionForOutboundEvent(eventType, channelId, groupSettings)
	if (!canRelayFederatedEvent(materializedState, signPayload)) return
	if (shouldDeferFederatedRelay(materializedState, signPayload)) {
		await enqueuePendingRelay(username, groupId, signPayload)
		return
	}

	const wireEvent = stripDagEventLocalExtensions(signPayload)
	const localInTarget = nodeHasPartition(groupSettings, channelId, targetPartition)
	const outboundPartition = localInTarget
		? targetPartition
		: pickLocalRelayPartition(groupSettings, channelId)
	let slot = null
	if (opts.existingSlotOnly)
		// leaveFast / 删群路径：只用已存在 slot，绝不创建新房间（正在离开，不应再 join）。
		slot = getFederationPartitionSlot(username, groupId, outboundPartition) ?? null
	else if (opts.joinTimeoutMs > 0) {
		// activate / 邀请激活：允许有界等待一次 join（relay 慢/不可达时不超过该窗口）。
		const joinMs = clampNumber(opts.joinTimeoutMs ?? 0, 0, 30_000)
		slot = await Promise.race([
			ensureFederationPartitionRoom(username, groupId, outboundPartition, { channelId }),
			new Promise(resolve => setTimeout(() => resolve(null), joinMs)),
		])
	}
	else {
		// 默认写路径：existingSlotOnly 语义——只用已存在 slot，绝不在写路径上阻塞 join。
		// slot 不存在时跳过本次 live 发布（靠 catch-up 最终一致），并 fire-and-forget 触发一次后台
		// 单飞 ensureFederationRoom 把房间建起来（按 (username,groupId,partitionId) 经 inflight 去重）。
		slot = getFederationPartitionSlot(username, groupId, outboundPartition) ?? null
		if (!slot)
			void ensureFederationRoom(username, groupId, { channelId })
				.catch(error => console.error('federation: background room ensure failed', error))
	}
	if (!slot) return

	const targets = await pickFederationTargetPeerIds(groupId,
		slot.getRoster(),
		groupSettings,
		nodeHash,
	)

	if (localInTarget) {
		deliverToFederationTargets(slot, wireEvent, targets, (s, payload, peerId) => s.send('dag_event', payload, peerId))
		return
	}

	for (const peerId of targets.length ? targets : [null])
		sendPartitionBridgeFromSlot(slot, {
			targetPartition,
			actionName: 'dag_event',
			payload: wireEvent,
			peerId,
		})

}

/**
 * 与在线邻居交换 DAG 叶 id，并对缺失叶发起 wantIds 补洞（§9）。
 * @param {string} username 用户
 * @param {string} groupId 群 ID
 * @param {{ waitMs?: number, extraWantIds?: string[] }} [opts] 等待邻居 pong 毫秒数、额外索要 id
 * @returns {Promise<{ federationActive: boolean, tipsCollected: number, wantIds: number, eventsFilled: number, wantIdsStillMissing: number, wantIdsRateLimited: boolean, stalePeersPruned: number }>} 补洞统计
 */
export async function catchUpGroupFromPeers(username, groupId, opts = {}) {
	const key = `${username}\0${groupId}`
	const inflight = catchUpInflight.get(key)
	if (inflight) return inflight
	const task = catchUpGroupFromPeersImpl(username, groupId, opts).finally(() => {
		if (catchUpInflight.get(key) === task) catchUpInflight.delete(key)
	})
	catchUpInflight.set(key, task)
	return task
}

/**
 * @param {string} username 用户
 * @param {string} groupId 群 ID
 * @param {{ waitMs?: number, extraWantIds?: string[] }} [opts] 等待邻居 pong 毫秒数、额外索要 id
 * @returns {Promise<{ federationActive: boolean, tipsCollected: number, wantIds: number, eventsFilled: number, wantIdsStillMissing: number, wantIdsRateLimited: boolean, stalePeersPruned: number }>} 补洞统计
 */
async function catchUpGroupFromPeersImpl(username, groupId, opts = {}) {
	const slot = await ensureFederationPartitionRoom(username, groupId, LOGIC_SYNC_PARTITION)
	if (!slot) return { federationActive: false, tipsCollected: 0, wantIds: 0, eventsFilled: 0, wantIdsStillMissing: 0, wantIdsRateLimited: false, stalePeersPruned: 0 }

	const { readJsonl } = requireDagDeps()
	const groupSettings = await loadFederationGroupSettings(username, groupId)
	const nodeHash = localNodeHash()
	const waitMs = clampNumber(opts.waitMs ?? 1600, 400, 30000)
	// 本轮 catchup 期间因身份映射滞后被自愈剔除的失效 peer 数（观测：>0 说明 onPeerLeave 漏触发/换房残留）。
	const stalePeersAtStart = getStalePeerPruneCount(groupId)
	/** @type {object[]} */
	const events = []
	const eventsById = new Map()
	for await (const event of readJsonlStream(eventsPath(username, groupId), { sanitize: stripDagEventLocalExtensions }))
		events.push(event), eventsById.set(event.id, event)
	const localTips = computeDagTipIdsFromEvents(events)
	const localArchive = await loadLocalFederationArchive(username, groupId, readJsonl)

	// 小圈子补洞顺序：① 首入群（无 checkpoint）信誉 joinSnapshot 引导 ② gossip wantIds 增量补洞
	// ③ 仅当 gossip 仍补不齐远端 tip（真落后/事件已归档）才升级为 joinSnapshot ④ syncMissingArchiveMonths（digest 仲裁）。
	// 注意：不能仅凭 tipsHash 与对端不一致就每轮发起完整 joinSnapshot——活跃 DAG 下两端 tip 天然瞬时相异
	// （本端 merge-tips 产生对端没有的 merge 事件时更是永久相异），那会让每次 catchup 都空转 ~8s 死等快照仲裁。
	if (!localArchive.checkpoint?.checkpoint_event_id) {
		await waitForFederationPeers(slot, { maxWaitMs: PEER_ROSTER_WAIT_MS })
		await maybeJoinSnapshotOnStaleTips(username, groupId, slot, { remoteSummaries: [] })
	}

	/** @returns {Promise<string[]>} 目标 peer id 列表 */
	const pickTargetPeerIds = () => pickFederationTargetPeerIds(groupId,
		slot.getRoster(),
		groupSettings,
		nodeHash,
	)
	/**
	 * @param {object} ping tip ping 载荷
	 * @param {string | null} peerId 目标 peer
	 * @returns {void}
	 */
	const sendTipPing = (ping, peerId) => { slot.send('fed_tip_ping', ping, peerId) }
	const { tipIds: remoteTips, remoteSummaries } = await collectRemoteTipsFromPeers(username, groupId, {
		waitMs,
		nodeHash,
		localTips,
		archiveSummary: wireArchiveSummary(localArchive.summary),
		sendTipPing,
		pickTargetPeerIds,
	})

	void syncMissingArchiveMonths(username, groupId, slot).catch(console.error)

	// 补齐要把 DAG 缺口补到“无悬挂父引用”为止：远端 tip 本地缺失 ∪ 本地事件 prev_event_ids 指向的本地缺失父（有叶无链）。
	// 关键：延迟桶（pending_ingest / quarantine）里的事件同样引用尚缺的父，但它们并不在 events.jsonl 中，
	// 若只扫 events.jsonl，则「因缺父而入延迟桶的 dag_tip_merge」其祖先永不进 wantSet——跨节点合并链补齐永久死锁。
	/**
	 * @param {Map<string, object>} byId 本地 id→事件
	 * @param {object[]} deferredRows pending/quarantine 桶内事件行
	 * @param {boolean} includeExtra 是否并入显式 extraWantIds（仅首轮）
	 * @returns {string[]} 去重后的待补 id（祖先闭包）
	 */
	const computeWantSet = (byId, deferredRows, includeExtra) => {
		const wantSet = new Set()
		for (const tipId of remoteTips)
			if (!byId.has(tipId)) wantSet.add(tipId)
		for (const event of byId.values())
			for (const parentId of sortedPrevEventIds(event.prev_event_ids))
				if (!byId.has(parentId)) wantSet.add(parentId)
		for (const row of deferredRows)
			for (const parentId of sortedPrevEventIds(row?.event?.prev_event_ids))
				if (!byId.has(parentId)) wantSet.add(parentId)
		if (includeExtra)
			for (const eventId of opts.extraWantIds || [])
				if (EVENT_ID_HEX.test(String(eventId)) && !byId.has(eventId))
					wantSet.add(String(eventId).trim().toLowerCase())
		return [...wantSet]
	}
	/** @returns {Promise<Map<string, object>>} 重新读盘构建 id→事件（每轮拉取落盘后调用） */
	const reloadEventsById = async () => {
		const byId = new Map()
		for await (const event of readJsonlStream(eventsPath(username, groupId), { sanitize: stripDagEventLocalExtensions }))
			byId.set(event.id, event)
		return byId
	}
	/** @returns {Promise<object[]>} pending_ingest 与 quarantine 两桶内的事件行（含 prev 悬挂引用） */
	const readDeferredRows = async () => [
		...await readPendingIngestRows(username, groupId).catch(() => []),
		...await readQuarantineRows(username, groupId).catch(() => []),
	]
	/**
	 * @param {Map<string, object>} byId events.jsonl id 集合
	 * @param {object[]} deferredRows 延迟桶行
	 * @returns {Set<string>} 本地已知（含延迟桶）事件 id——用于「进展」判定，避免拉回的事件仅落延迟桶时被误判为无进展而提前停迭代。
	 */
	const knownIdSet = (byId, deferredRows) => {
		const ids = new Set(byId.keys())
		for (const row of deferredRows)
			if (row?.event?.id) ids.add(String(row.event.id))
		return ids
	}

	// 迭代补洞：拉取→落盘→重扫新暴露的缺失父→再拉，直到 wantSet 空 / 达上限 / 无进展 / 命中退避。
	const MAX_CATCHUP_ITERS = 8
	const wantedEver = new Set()
	let currentById = eventsById
	let currentDeferred = await readDeferredRows()
	let knownIds = knownIdSet(currentById, currentDeferred)
	let eventsFilled = 0
	let wantIdsStillMissing = 0
	let wantIdsRateLimited = isWantIdsInBackoff(wantIdsGroupKey( groupId))
	for (let iter = 0; iter < MAX_CATCHUP_ITERS; iter++) {
		const wantIds = computeWantSet(currentById, currentDeferred, iter === 0)
		if (!wantIds.length) break
		for (const id of wantIds) wantedEver.add(id)
		const result = await requestMissingEventsGossip(username, groupId, { wantIds, awaitGossip: true })
		if (result.rateLimited) wantIdsRateLimited = true
		wantIdsStillMissing = result.stillMissing.length
		currentById = await reloadEventsById()
		currentDeferred = await readDeferredRows()
		const nextKnownIds = knownIdSet(currentById, currentDeferred)
		eventsFilled += wantIds.reduce((n, id) => currentById.has(id) ? n + 1 : n, 0)
		// 进展 = 本轮索要的 id 有任何一个新落地（events.jsonl 或延迟桶皆算）；仅落延迟桶也是真进展（其祖先下轮才会暴露）。
		const madeProgress = wantIds.some(id => nextKnownIds.has(id) && !knownIds.has(id))
		knownIds = nextKnownIds
		// 无进展或命中退避：停止迭代，余量交由调度器/心跳后续兜底。
		if (wantIdsRateLimited || !madeProgress) break
	}
	// gossip 补洞后仍存在无法拉齐的远端 tip（真落后：缺链事件已被对端归档/GC，gossip 拿不到）→ 升级 joinSnapshot。
	// 本端领先或已同步时 wantIdsStillMissing===0，跳过昂贵的快照仲裁，避免活跃 DAG 下每轮 catchup 空转死等。
	if (wantIdsStillMissing > 0 && !wantIdsRateLimited && localArchive.checkpoint?.checkpoint_event_id)
		await maybeJoinSnapshotOnStaleTips(username, groupId, slot, { remoteSummaries })
	const stats = {
		federationActive: true,
		tipsCollected: remoteTips.size,
		wantIds: wantedEver.size,
		eventsFilled,
		wantIdsStillMissing,
		wantIdsRateLimited,
		stalePeersPruned: getStalePeerPruneCount(groupId) - stalePeersAtStart,
	}
	void maybeRequestBootstrapAfterCatchup(username, groupId, stats, slot)
	if (localArchive.checkpoint?.local_tips_hash)
		void markGroupOnlineSynced(username, groupId, localArchive.checkpoint.local_tips_hash).catch(console.error)
	try {
		const { releasePendingIngestEvents, releaseQuarantinedEvents } = await import('../dag/remoteIngest.mjs')
		await releaseQuarantinedEvents(username, groupId)
		await releasePendingIngestEvents(username, groupId)
	}
	catch (error) {
		console.error('federation: catchup deferred ingest replay failed', error)
	}
	try {
		const { maybeProbeAndEvaluateShunConsensus } = await import('./shun.mjs')
		await maybeProbeAndEvaluateShunConsensus(username, groupId, slot, { waitMs })
	}
	catch (error) {
		console.error('federation: catchup shun consensus failed', error)
	}
	return stats
}

/**
 * `GET .../peers`：本群 信令房内可见对等端。
 * @param {string} username 用户名
 * @param {string} groupId 群 ID
 * @returns {Promise<{ selfNodeHash: string, federationEnabled: boolean, peers: object[] }>} 本机节点与对等端列表
 */
export async function listFederationPeersForGroup(username, groupId) {
	const nodeHash = localNodeHash()
	// 只读列表端点：房间初始化是有网络副作用的尽力而为操作，瞬时失败不应让 GET /peers 抛 500。
	let slot = null
	try {
		slot = await ensureFederationRoom(username, groupId)
	}
	catch (error) {
		console.error('listFederationPeersForGroup: ensureFederationRoom failed', error)
	}
	if (!slot)
		return { selfNodeHash: nodeHash, federationEnabled: false, peers: [] }
	const peersByPeerId = new Map()
	for (const peer of slot.getRoster())
		if (peer?.peerId) peersByPeerId.set(peer.peerId, peer)
	forEachFederationRoomSlotInGroup(username, groupId, roomSlot => {
		for (const peer of roomSlot.getRoster())
			if (peer?.peerId && !peersByPeerId.has(peer.peerId))
				peersByPeerId.set(peer.peerId, peer)
	})
	const peers = [...peersByPeerId.values()]
	const groupSettings = await loadFederationGroupSettings(username, groupId)
	// reconcilePeerPoolFromRoster 是同步函数（同步读写本地 peer 池），不可链 .catch，否则在有 slot
	// 时会因对 undefined 取 catch 而抛 500。瞬时失败只记日志，不影响只读 peers 列表返回。
	try {
		reconcilePeerPoolFromRoster(groupId, peers, groupSettings)
	}
	catch (error) {
		console.error('network pool reconcile failed', error)
	}
	return { selfNodeHash: nodeHash, federationEnabled: true, peers }
}
