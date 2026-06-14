/**
 * 【文件】`dag/materialize.mjs` — DAG 物化与 checkpoint 重建。
 * 【职责】从 `events.jsonl` 重放事件得到群物化状态；增量应用 checkpoint；在 tip 变化时写回 `checkpoint.json` 并触发保留/GC。
 * 【原理】先经 WAL 校验 events 与快照 tip 是否一致；按拓扑规范序折叠事件，`applyEvent` 逐条物化；优先从 checkpoint 增量重放；`rebuildAndSaveCheckpoint` 全量重放后签名快照并衔接联邦 relay、频道 GC 与事件保留。
 * 【数据结构】`state`（成员/频道/消息 overlay 等物化视图）、`order`（拓扑序 id 列表）、`checkpoint`（含 `checkpoint_event_id`、`dag_tip_ids`、`epoch_chain`）。
 * 【关联】`wal.mjs`、`storage.mjs`、`events/retention.mjs`、`queries.mjs`、`remoteIngest.mjs`。
 */
import { mkdir, stat } from 'node:fs/promises'

import { buildCheckpointPayload, isSignedBaseCheckpoint, signCheckpoint } from '../../../../../../../scripts/p2p/checkpoint.mjs'
import { EPOCH_CHAIN_MAX } from '../../../../../../../scripts/p2p/constants.mjs'
import { pubKeyHash, publicKeyFromSeed } from '../../../../../../../scripts/p2p/crypto.mjs'
import { computeLocalTipsHash } from '../../../../../../../scripts/p2p/dag/index.mjs'
import { readJsonl, writeJsonAtomicSynced } from '../../../../../../../scripts/p2p/dag/storage.mjs'
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
	hasGovernanceFork,
	selectAuthzBranchTip,
	selectConsensusBranchTip,
} from '../../../../../../../scripts/p2p/governance_branch.mjs'
import { isHex64 } from '../../../../../../../scripts/p2p/hexIds.mjs'
import {
	applyEvent,
	checkpointSignerPubKeyHashes,
	emptyMaterializedState,
	materializeFromCheckpoint,
	serializeReactionsOverlay,
	serializeVotesOverlay,
} from '../../../../../../../scripts/p2p/materialized_state.mjs'
import { loadReputation } from '../../../../../../../scripts/p2p/reputation_user.mjs'
import {
	invalidateTopologicalOrderMemo,
	resolveTopologicalOrderMemoCached,
} from '../../../../../../../scripts/p2p/topo_order_memo.mjs'
import { archivePostsBeforeDagFold, trimMessagesJsonlToHotWindow } from '../archive/archiveBeforeFold.mjs'
import { computeHotPostsForCheckpoint } from '../archive/hotPosts.mjs'
import { archiveSettingsFromGroup } from '../archive/settings.mjs'
import { findStaleUnreachableChannels } from '../channel/gc.mjs'
import { enforceEventRetention } from '../events/retention.mjs'
import { sanitizeFederatedEvent } from '../events/wire.mjs'
import { flushPendingRelay } from '../federation/pendingRelay.mjs'
import { loadGovernanceBranchTip } from '../governance/branchStore.mjs'
import { mergeChannelMessagesForDisplay } from '../lib/messageMerge.mjs'
import { eventsOrderCachePath, groupDir, eventsPath, messagesPath, snapshotPath } from '../lib/paths.mjs'
import { safeReadJson } from '../lib/utils.mjs'

import { withGroupWriteLock } from './groupLock.mjs'
import { verifyEventsSnapshotWAL } from './wal.mjs'

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
 * 载入 DAG 事件并按规范拓扑序物化，汇总状态与 checkpoint。
 * @param {string} username 用户名
 * @param {string} groupId 群组 ID
 * @param {{ forceFullReplay?: boolean, skipWalRepair?: boolean, skipLeftPurge?: boolean }} [opts] 物化选项
 * @returns {Promise<{ events: object[], state: object, order: string[], checkpoint: object | null }>} 事件、物化状态与检查点
 */
export async function getState(username, groupId, opts = {}) {
	const events = await readJsonl(eventsPath(username, groupId), { sanitize: sanitizeFederatedEvent })
	const checkpoint = await safeReadJson(snapshotPath(username, groupId))

	let wal = { ok: true }
	if (!opts.forceFullReplay && events.length > 0) {
		wal = await verifyEventsSnapshotWAL(username, groupId, checkpoint, events)
		if (!opts.skipWalRepair && (!wal.ok || wal.forceFullReplay === true)) {
			await rebuildAndSaveCheckpoint(username, groupId, { skipChannelGc: true })
			return getState(username, groupId, { ...opts, skipWalRepair: true })
		}
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
		loadReputation(username),
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
	const canIncrement = !forceReplay
		&& checkpoint
		&& tipId
		&& checkpoint.members_record
	const tipIndex = canIncrement ? foldOrder.indexOf(tipId) : -1
	// 采纳的远端基态 checkpoint：本机没有 checkpoint 锚点之前的历史事件（入群时只拿到了
	// owner 签名的 checkpoint，未拿 pre-checkpoint 历史）。此时 checkpoint 即权威基态，
	// 本地仅持有其之后的增量事件（如本机自己的 member_join）。判据：checkpoint 已签名且锚点不在本地 DAG。
	const isAdoptedBaseCheckpoint = canIncrement
		&& tipIndex < 0
		&& isSignedBaseCheckpoint(checkpoint)

	if (canIncrement && !events.length)
		state = materializeFromCheckpoint(checkpoint)
	else if (canIncrement && tipIndex >= 0) {
		state = materializeFromCheckpoint(checkpoint)
		for (const eventId of foldOrder.slice(tipIndex + 1)) {
			const event = byId.get(eventId)
			if (event) state = applyEvent(state, event)
		}
	}
	else if (isAdoptedBaseCheckpoint) {
		state = materializeFromCheckpoint(checkpoint)
		const covered = new Set(Array.isArray(checkpoint.eventIdsInEpoch) ? checkpoint.eventIdsInEpoch : [])
		for (const eventId of foldOrder) {
			if (covered.has(eventId)) continue
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
 * 判断 checkpoint 锚点事件是否不在本地 events.jsonl（即本机无该 checkpoint 之前的历史）。
 * @param {string} username 用户名
 * @param {string} groupId 群组 ID
 * @param {string} anchorEventId checkpoint_event_id
 * @returns {Promise<boolean>} 锚点缺失为 true
 */
async function checkpointAnchorAbsentFromEvents(username, groupId, anchorEventId) {
	const anchor = String(anchorEventId || '').trim().toLowerCase()
	if (!anchor) return false
	const rows = await readJsonl(eventsPath(username, groupId), { sanitize: sanitizeFederatedEvent })
	return !rows.some(row => String(row.id || '').trim().toLowerCase() === anchor)
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
	// 仅当「owner 签名基态 checkpoint」且其锚点事件确实不在本地 DAG 时才走 base-aware（不全量重放）：
	// 本机无 pre-checkpoint 历史，全量重放会丢弃基态。普通情形（锚点在本地、只是不再是 tip）必须
	// 全量重放——否则 getState 会触发 WAL 修复并递归回 buildAndSaveCheckpoint 造成死循环。
	const baseTipAbsent = isSignedBaseCheckpoint(previousCheckpoint)
		&& isHex64(String(previousCheckpoint.checkpoint_event_id || '').trim().toLowerCase())
		&& await checkpointAnchorAbsentFromEvents(username, groupId, previousCheckpoint.checkpoint_event_id)
	const { events, state, order } = await getState(username, groupId, { forceFullReplay: !baseTipAbsent })
	if (!events.length) return null
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
		const lines = await readJsonl(messagesPath(username, groupId, channelId), { sanitize: sanitizeFederatedEvent })
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
	let signingKey = opts.checkpointOwnerSecretKey
	if (!signingKey) {
		const { readLocalSignerSeed } = await import('./localSigner.mjs')
		signingKey = await readLocalSignerSeed(username, groupId).catch(() => null)
	}
	if (signingKey && await canUseSecretKeyForCheckpointSignature(state, signingKey))
		checkpointPayload = await signCheckpoint(checkpointPayload, signingKey)
	await mkdir(groupDir(username, groupId), { recursive: true })
	await writeJsonAtomicSynced(snapshotPath(username, groupId), checkpointPayload)
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
