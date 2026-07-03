/**
 * 【文件】`dag/materialize.mjs` — DAG 物化与 checkpoint 重建。
 * 【职责】从 `events.jsonl` 重放事件得到群物化状态；增量应用 checkpoint；在 tip 变化时写回 `checkpoint.json` 并触发保留/GC。
 * 【原理】先经 WAL 校验 events 与快照 tip 是否一致；按拓扑规范序折叠事件，`applyEvent` 逐条物化；优先从 checkpoint 增量重放；`rebuildAndSaveCheckpoint` 全量重放后签名快照并衔接联邦 relay、频道 GC 与事件保留。
 * 【数据结构】`state`（成员/频道/消息 overlay 等物化视图）、`order`（拓扑序 id 列表）、`checkpoint`（含 `checkpoint_event_id`、`dag_tip_ids`、`epoch_chain`）。
 * 【关联】`wal.mjs`、`storage.mjs`、`events/retention.mjs`、`queries.mjs`、`remoteIngest.mjs`。
 */
import { AsyncLocalStorage } from 'node:async_hooks'
import { mkdir, stat } from 'node:fs/promises'

import { EPOCH_CHAIN_MAX } from '../../../../../../../scripts/p2p/constants.mjs'
import { pubKeyHash, publicKeyFromSeed } from '../../../../../../../scripts/p2p/crypto.mjs'
import { computeLocalTipsHash } from '../../../../../../../scripts/p2p/dag/index.mjs'
import { readJsonl, writeJsonAtomicSynced } from '../../../../../../../scripts/p2p/dag/storage.mjs'
import { stripDagEventLocalExtensions } from '../../../../../../../scripts/p2p/dag/strip_extensions.mjs'
import {
	buildOrderCachePayload,
	deleteOrderCache,
	readOrderCache,
	resolveEventTopologicalOrder,
	writeOrderCache,
} from '../../../../../../../scripts/p2p/dag_order_cache.mjs'
import {
	authzFoldOrderIds,
	computeDagTipIdsFromEvents,
	hasDanglingParents,
	hasGovernanceFork,
	selectAuthzBranchTip,
	selectConsensusBranchTip,
} from '../../../../../../../scripts/p2p/governance_branch.mjs'
import { loadReputation } from '../../../../../../../scripts/p2p/reputation.mjs'
import {
	invalidateTopologicalOrderMemo,
	resolveTopologicalOrderMemoCached,
} from '../../../../../../../scripts/p2p/topo_order_memo.mjs'
import { mergeChannelMessagesForDisplay } from '../../../public/shared/messageMerge.mjs'
import { archivePostsBeforeDagFold, trimMessagesJsonlToHotWindow } from '../archive/archiveBeforeFold.mjs'
import { computeHotPostsForCheckpoint } from '../archive/hotPosts.mjs'
import { archiveSettingsFromGroup } from '../archive/settings.mjs'
import { findStaleUnreachableChannels } from '../channel/gc.mjs'
import { enforceEventRetention } from '../events/retention.mjs'
import { flushPendingRelay } from '../federation/pendingRelay.mjs'
import { loadGovernanceBranchTip } from '../governance/branchStore.mjs'
import { eventsOrderCachePath, groupDir, eventsPath, messagesPath, snapshotPath } from '../lib/paths.mjs'
import { safeReadJson } from '../lib/utils.mjs'

import { buildCheckpointPayload, isAdoptedBaseAuthoritative, isSignedBaseCheckpoint, signCheckpoint } from './checkpointPayload.mjs'
import { withGroupWriteLock } from './groupLock.mjs'
import {
	applyEvent,
	checkpointSignerPubKeyHashes,
	emptyMaterializedState,
	materializeFromCheckpoint,
	serializeReactionsOverlay,
	serializeVotesOverlay,
} from './groupMaterializedState.mjs'
import { verifyEventsSnapshotWAL } from './wal.mjs'

/** @type {AsyncLocalStorage<boolean>} 当前异步上下文中是否正在执行 WAL 修复，防止 rebuild 内嵌 getState 无限递归 OOM。 */
const walRepairContext = new AsyncLocalStorage()

/**
 * @param {string} username 用户名
 * @param {string} groupId 群组 ID
 * @returns {Promise<{ state: object }>} 物化群状态
 */
export async function getStateForFederation(username, groupId) {
	const { state } = await getState(username, groupId)
	return { state }
}

/**
 * 计算 checkpoint 锚点在当前事件集中的「因果覆盖闭包」：
 * 仅锚点及其可达祖先视作已被基态折叠，避免用拓扑 index 切片误伤“排序在锚点之前但实际上晚到/断链”的事件。
 * @param {Map<string, object>} byId 事件 id -> 事件映射
 * @param {string} anchorId checkpoint 锚点事件 id
 * @returns {Set<string>} 已覆盖事件 id 集
 */
function coveredIdsFromAnchor(byId, anchorId) {
	const covered = new Set()
	const start = String(anchorId || '').trim().toLowerCase()
	if (!start || !byId.has(start)) return covered
	const stack = [start]
	while (stack.length) {
		const id = stack.pop()
		if (!id || covered.has(id)) continue
		covered.add(id)
		const event = byId.get(id)
		const parents = Array.isArray(event?.prev_event_ids) ? event.prev_event_ids : []
		for (const parentId of parents) {
			const pid = String(parentId || '').trim().toLowerCase()
			if (pid && byId.has(pid) && !covered.has(pid)) stack.push(pid)
		}
	}
	return covered
}

/**
 * 载入 DAG 事件并按规范拓扑序物化，汇总状态与 checkpoint。
 * @param {string} username 用户名
 * @param {string} groupId 群组 ID
 * @param {{ forceFullReplay?: boolean, skipWalRepair?: boolean, skipLeftPurge?: boolean }} [opts] 物化选项
 * @returns {Promise<{ events: object[], state: object, order: string[], checkpoint: object | null }>} 事件、物化状态与检查点
 */
export async function getState(username, groupId, opts = {}) {
	const events = await readJsonl(eventsPath(username, groupId), { sanitize: stripDagEventLocalExtensions })
	const checkpoint = await safeReadJson(snapshotPath(username, groupId))

	let wal = { ok: true }
	const repairing = opts.skipWalRepair || walRepairContext.getStore() === true
	if (!opts.forceFullReplay && events.length > 0) {
		wal = await verifyEventsSnapshotWAL(username, groupId, checkpoint, events)
		if (!repairing && (!wal.ok || wal.forceFullReplay === true))
			return walRepairContext.run(true, async () => {
				await rebuildAndSaveCheckpoint(username, groupId, { skipChannelGc: true })
				return getState(username, groupId, { ...opts, skipWalRepair: true })
			})
	}
	const forceReplay = opts.forceFullReplay || wal.forceFullReplay === true

	const eventsFile = eventsPath(username, groupId)
	let fingerprint = `0:0:${events.length}`
	try {
		const st = await stat(eventsFile)
		fingerprint = `${st.mtimeMs}:${st.size}:${events.length}`
	}
	catch { /* empty or missing */ }
	const memoKey = `${username}:${groupId}`
	const orderCachePath = eventsOrderCachePath(username, groupId)
	if (forceReplay) {
		await deleteOrderCache(orderCachePath)
		invalidateTopologicalOrderMemo(memoKey)
	}
	const orderCache = forceReplay ? null : await readOrderCache(orderCachePath)
	const order = resolveTopologicalOrderMemoCached(
		memoKey,
		fingerprint,
		() => resolveEventTopologicalOrder(events, orderCache, { forceFull: forceReplay }),
		{ force: forceReplay },
	)
	if (events.length && !forceReplay)
		await writeOrderCache(orderCachePath, buildOrderCachePayload(order, events))
	const byId = new Map(events.map(event => [event.id, event]))

	const dagTips = computeDagTipIdsFromEvents(events)
	const [reputationFile, preferredBranchTip] = await Promise.all([
		loadReputation(),
		loadGovernanceBranchTip(username, groupId),
	])
	/** @type {Record<string, number>} */
	const reputationBySender = Object.fromEntries(
		Object.entries(reputationFile.byNodeHash).map(([senderKey, entry]) => [senderKey, entry.score ?? 0]),
	)

	const consensusBranchTip = selectConsensusBranchTip(dagTips, byId)
	const localViewBranchTip = preferredBranchTip && dagTips.includes(preferredBranchTip)
		? preferredBranchTip
		: selectAuthzBranchTip(dagTips, byId, reputationBySender, preferredBranchTip)
	const foldOrder = authzFoldOrderIds(order, byId, consensusBranchTip)

	let state = emptyMaterializedState()
	const tipId = checkpoint?.checkpoint_event_id
	const hasBase = !!(checkpoint && tipId && checkpoint.members_record)
	const coveredByAnchor = hasBase ? coveredIdsFromAnchor(byId, tipId) : new Set()
	// 采纳的 owner 签名基态 checkpoint：本机入群时仅拿到签名 checkpoint，未拿 pre-checkpoint 历史。
	// 此时 checkpoint 即权威基态，本地仅持有其后的增量事件（member_join、gossip 拉回的消息等）。
	// 与 forceReplay 解耦：只要基态仍权威（未被本地追平/更高 epoch 本地签名取代），即使 forceReplay===true
	// 也必须以 checkpoint 为基态叠加本地增量，而非裸 authzFold 全量重放（后者会因缺治理链滤没基态成员）。
	const baseAuthoritative = hasBase && isAdoptedBaseAuthoritative(checkpoint, dagTips)
	const canIncrement = !forceReplay && hasBase

	if (hasBase && !events.length)
		state = materializeFromCheckpoint(checkpoint)
	else if (baseAuthoritative) {
		state = materializeFromCheckpoint(checkpoint)
		// 锚点已在本地事件集：按锚点因果祖先闭包判定“已覆盖”；锚点缺失时回退 eventIdsInEpoch。
		const covered = coveredByAnchor.size > 0
			? coveredByAnchor
			: new Set(Array.isArray(checkpoint.eventIdsInEpoch) ? checkpoint.eventIdsInEpoch : [])
		for (const eventId of foldOrder) {
			if (covered.has(eventId)) continue
			const event = byId.get(eventId)
			if (event) state = applyEvent(state, event)
		}
	}
	else if (canIncrement && coveredByAnchor.size > 0) {
		state = materializeFromCheckpoint(checkpoint)
		for (const eventId of foldOrder) {
			if (coveredByAnchor.has(eventId)) continue
			const event = byId.get(eventId)
			if (event) state = applyEvent(state, event)
		}
	}
	else
		for (const eventId of foldOrder) {
			const event = byId.get(eventId)
			if (event) state = applyEvent(state, event)
		}

	state.dagTips = dagTips
	state.consensusBranchTip = consensusBranchTip
	state.localViewBranchTip = localViewBranchTip
	state.governanceFork = hasGovernanceFork(dagTips, consensusBranchTip)
	state.walOk = wal.ok
	if (!wal.ok) state.walReason = wal.reason

	if (!opts.skipLeftPurge) {
		const { maybePurgeLocalReplicaIfLeft } = await import('./lifecycle.mjs')
		if (await maybePurgeLocalReplicaIfLeft(username, groupId, state))
			return { events: [], state: emptyMaterializedState(), order: [], checkpoint: null }
	}

	return { events, state, order, checkpoint }
}

/**
 * @param {object} messageOverlay 物化 `messageOverlay`（Set/Map）
 * @returns {object} checkpoint 可序列化的 overlay
 */
function serializeMessageOverlayForCheckpoint(messageOverlay) {
	const mo = messageOverlay || {}
	return {
		deletedIds: [...mo.deletedIds || []],
		editHistory: Object.fromEntries(mo.editHistory || new Map()),
		feedbackHistory: Object.fromEntries(mo.feedbackHistory || new Map()),
		reactions: serializeReactionsOverlay(mo.reactions || new Map()),
		pins: Object.fromEntries(mo.pins || new Map()),
		fileIndex: Object.fromEntries(mo.fileIndex || new Map()),
		votes: serializeVotesOverlay(mo.votes || new Map()),
	}
}

/**
 * @param {object} state 全量重放后的物化状态
 * @param {string[]} dagTipIds 当前 DAG tip id 列表
 * @param {string[]} foldOrder 拓扑折叠序
 * @returns {string | null} checkpoint 锚点事件 id
 */
function resolveCheckpointEventId(state, dagTipIds, foldOrder) {
	const consensusTip = state.consensusBranchTip
	if (consensusTip && dagTipIds.includes(consensusTip)) return consensusTip
	if (dagTipIds.length === 1) return dagTipIds[0]
	return foldOrder.length ? foldOrder[foldOrder.length - 1] : null
}

/**
 * @param {object} state 物化群状态
 * @param {Uint8Array} secretKey 私钥种子
 * @returns {Promise<boolean>} 是否可用该私钥签名 checkpoint
 */
async function canUseSecretKeyForCheckpointSignature(state, secretKey) {
	if (!secretKey || secretKey.length < 32) return false
	const derivedPubKeyHash = pubKeyHash(publicKeyFromSeed(secretKey))
	return checkpointSignerPubKeyHashes(state).has(derivedPubKeyHash)
}

/**
 * 重放 DAG 并写入 `checkpoint.json`（不含后续维护副作用）。
 * @param {string} username 用户名
 * @param {string} groupId 群组 ID
 * @param {{ checkpointOwnerSecretKey?: Uint8Array }} [opts] checkpoint 选项
 * @returns {Promise<object | null>} 新检查点；无事件时为 null
 */
export async function buildAndSaveCheckpoint(username, groupId, opts = {}) {
	const previousCheckpoint = await safeReadJson(snapshotPath(username, groupId))
	const eventsForReplay = await readJsonl(eventsPath(username, groupId), { sanitize: stripDagEventLocalExtensions })
	// 采纳的 owner 签名基态在本地真正追平前保持权威（与 WAL / getState 同口径 isAdoptedBaseAuthoritative）：
	// 锚点未拉回 / 悬挂父 / 锚点非当前叶 / dag_tip_ids 未对齐均属 catch-up 中间态，禁止 forceFullReplay
	// （否则缺 pre-checkpoint 治理链 → 滤没基态成员）；物化以 checkpoint 为基态叠加本地增量。
	const baseAuthoritative = isAdoptedBaseAuthoritative(previousCheckpoint, computeDagTipIdsFromEvents(eventsForReplay))
		|| (isSignedBaseCheckpoint(previousCheckpoint) && hasDanglingParents(eventsForReplay))
	const { events, state, order } = await getState(username, groupId, { forceFullReplay: !baseAuthoritative })
	if (!events.length) return null

	let signingKey = opts.checkpointOwnerSecretKey
	if (!signingKey) {
		const { readLocalSignerSeed } = await import('./localSigner.mjs')
		signingKey = await readLocalSignerSeed(username, groupId).catch(() => null)
	}
	const canSign = !!(signingKey && await canUseSecretKeyForCheckpointSignature(state, signingKey))
	// 非签名节点（普通成员）不得用未签名 checkpoint 覆盖仍权威的采纳签名基态：覆盖会令
	// isSignedBaseCheckpoint 失真、基态保护失效，下一次重放即把基态成员滤没。保留既有签名基态，
	// 本地增量在每次 getState 动态叠加；更高 epoch 的新基态由 owner 经联邦下发后替换 snapshot.json。
	if (!canSign && baseAuthoritative && isSignedBaseCheckpoint(previousCheckpoint))
		return previousCheckpoint

	const dagTipIds = computeDagTipIdsFromEvents(events)
	const checkpointEventId = resolveCheckpointEventId(state, dagTipIds, order)
	if (!checkpointEventId) return null

	const prevTip = previousCheckpoint?.checkpoint_event_id
	const prevTipIndex = prevTip ? order.indexOf(prevTip) : -1
	const sameTip = prevTip && checkpointEventId === prevTip

	let eventIdsInEpoch = order
	if (!sameTip && prevTipIndex >= 0)
		eventIdsInEpoch = order.slice(prevTipIndex + 1)
	if (!eventIdsInEpoch.length)
		eventIdsInEpoch = order

	let epoch_id = 1
	/** @type {object[]} */
	let epoch_chain = []
	if (previousCheckpoint && !sameTip) {
		epoch_id = (previousCheckpoint.epoch_id ?? 0) + 1
		epoch_chain = Array.isArray(previousCheckpoint.epoch_chain) ? [...previousCheckpoint.epoch_chain] : []
		if (previousCheckpoint.epoch_id != null && previousCheckpoint.epoch_root_hash)
			epoch_chain.push({
				epoch_id: previousCheckpoint.epoch_id,
				epoch_root_hash: previousCheckpoint.epoch_root_hash,
				checkpoint_event_id: previousCheckpoint.checkpoint_event_id,
			})
		if (epoch_chain.length > EPOCH_CHAIN_MAX)
			epoch_chain = epoch_chain.slice(-EPOCH_CHAIN_MAX)
	}
	else if (previousCheckpoint && sameTip) {
		epoch_id = previousCheckpoint.epoch_id ?? 1
		epoch_chain = Array.isArray(previousCheckpoint.epoch_chain) ? [...previousCheckpoint.epoch_chain] : []
		if (Array.isArray(previousCheckpoint.eventIdsInEpoch) && previousCheckpoint.eventIdsInEpoch.length)
			eventIdsInEpoch = previousCheckpoint.eventIdsInEpoch
	}

	state.channelMergedMessages = {}
	for (const channelId of Object.keys(state.channels)) {
		const lines = await readJsonl(messagesPath(username, groupId, channelId), { sanitize: stripDagEventLocalExtensions })
		state.channelMergedMessages[channelId] = mergeChannelMessagesForDisplay(lines)
	}

	let checkpointPayload = buildCheckpointPayload({
		local_node_id: null,
		materialized: state,
		epoch_id,
		checkpoint_event_id: checkpointEventId,
		eventIdsInEpoch,
		dag_tip_ids: dagTipIds,
		local_tips_hash: computeLocalTipsHash(dagTipIds),
		overlay: serializeMessageOverlayForCheckpoint(state.messageOverlay),
		fileFolders: { ...state.fileFolders },
		epoch_chain,
		hot_posts: await computeHotPostsForCheckpoint(username, groupId, state, events),
	})
	// last_activity_ms 必须在签名之前写入：签名覆盖整个 body（除 checkpoint_signature 自身），
	// 验签方也会把它纳入哈希。若签后再加这个字段，两端 body 不一致 → checkpoint_signature 验证失败。
	let lastActivityMs = 0
	for (const ev of events) {
		const ts = Number(ev.timestamp) || 0
		if (ts > lastActivityMs) lastActivityMs = ts
	}
	checkpointPayload.last_activity_ms = lastActivityMs
	if (canSign)
		checkpointPayload = await signCheckpoint(checkpointPayload, signingKey)
	await mkdir(groupDir(username, groupId), { recursive: true })
	await writeJsonAtomicSynced(snapshotPath(username, groupId), checkpointPayload)
	invalidateTopologicalOrderMemo(`${username}:${groupId}`)
	return checkpointPayload
}

/**
 * checkpoint 写入后的维护：联邦 relay、频道 GC、留存与压缩。
 * @param {string} username 用户名
 * @param {string} groupId 群组 ID
 * @param {object} checkpointPayload 已保存的检查点
 * @param {{ skipChannelGc?: boolean }} [opts] 维护选项
 * @returns {Promise<void>}
 */
export async function runPostCheckpointMaintenance(username, groupId, checkpointPayload, opts = {}) {
	const { events, state } = await getState(username, groupId)

	try {
		const { invalidateKnownMemberIndex } = await import('../mailbox/memberIndex.mjs')
		invalidateKnownMemberIndex(username)
	}
	catch { /* ignore */ }

	try {
		const { relayPendingFederatedEvent } = await import('./remoteIngest.mjs')
		await flushPendingRelay(username, groupId, event =>
			relayPendingFederatedEvent(username, groupId, event),
		)
	}
	catch (error) {
		console.error('federation: flush pending relay failed', error)
	}

	try {
		const { releasePendingIngestEvents } = await import('./remoteIngest.mjs')
		await releasePendingIngestEvents(username, groupId)
	}
	catch (error) {
		console.error('federation: replay pending ingest failed', error)
	}

	if (!opts.skipChannelGc && state.groupSettings?.autoChannelGc !== false)
		try {
			const staleChannelIds = findStaleUnreachableChannels(state, events)
			const { deleteChannel } = await import('./channelOps.mjs')
			for (const channelId of staleChannelIds.slice(0, 2))
				await deleteChannel(username, groupId, channelId)
		}
		catch (error) {
			console.error('channel_gc:', error)
		}

	const groupSettings = state.groupSettings
	const archiveSettings = archiveSettingsFromGroup(groupSettings)

	try {
		if (archiveSettings.autoPruneDagMessages)
			await enforceEventRetention(username, groupId, checkpointPayload, groupSettings)
	}
	catch (error) {
		console.error('event_retention:', error)
	}

	const hotPosts = checkpointPayload.hot_posts
	if (!hotPosts)
		throw new Error('checkpoint missing hot_posts')

	try {
		await withGroupWriteLock(username, groupId, async () => {
			await archivePostsBeforeDagFold(username, groupId, state, events, hotPosts)

			const { foldDagProcessEvents } = await import('./foldEvents.mjs')
			await foldDagProcessEvents(username, groupId, hotPosts, groupSettings)

			const compactTrigger = Math.max(256, Number(groupSettings.compactTriggerEventDepth) || 100_000)
			if (events.length > compactTrigger) {
				const { pruneEventsJsonlAfterCheckpoint } = await import('./queries.mjs')
				await pruneEventsJsonlAfterCheckpoint(username, groupId, checkpointPayload)
			}

			if (archiveSettings.autoPruneMessagesJsonl) {
				const { pruneAllChannelMessagesByRetention } = await import('./queries.mjs')
				await pruneAllChannelMessagesByRetention(username, groupId, groupSettings)
			}
			else
				await trimMessagesJsonlToHotWindow(username, groupId, hotPosts)
		})
	}
	catch (error) {
		console.error('post_checkpoint_storage:', error)
	}

}

/**
 * 重放 DAG 授权类事件并写回 `checkpoint.json`。
 * @param {string} username 用户名
 * @param {string} groupId 群组 ID
 * @param {{ checkpointOwnerSecretKey?: Uint8Array, skipChannelGc?: boolean }} [opts] checkpoint 选项
 * @returns {Promise<object | null>} 新检查点；无事件时为 null
 */
export async function rebuildAndSaveCheckpoint(username, groupId, opts = {}) {
	const checkpointPayload = await buildAndSaveCheckpoint(username, groupId, opts)
	if (!checkpointPayload) return null
	await runPostCheckpointMaintenance(username, groupId, checkpointPayload, opts)
	return checkpointPayload
}
