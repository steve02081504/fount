import { appendJsonlSynced, readJsonl } from 'npm:@steve02081504/fount-p2p/dag/storage'

import { resolveOperatorEntityHashForUser as resolveOperatorEntityHash } from '../../../../../../server/p2p_server/operator_identity.mjs'
import { projectFollowerIndexFromTimelineEvent } from '../federation/follower_index.mjs'
import { listLocalAgentEntities } from '../federation/hosting.mjs'
import { collectSocialRpcMerged } from '../federation/part_wire_rpc.mjs'
import { validateRemoteTimelineEvent } from '../federation/remote_ingest.mjs'
import { loadFollowing, loadFollowingForActor } from '../following.mjs'
import { timelineEventsPath } from '../paths.mjs'
import { handleInboundPersonalBlockEvent } from '../personalBlock.mjs'
import { tryImportFollowApproveVault } from '../vault_crypto/followApproveImport.mjs'

import { canonicalizeSignedTimelineEvent } from './canonicalizeEvent.mjs'
import { filterEventsForFederatedPull } from './federationExport.mjs'
import { invalidateTimelineMaterializedCache, maintainSocialTimeline } from './materialize.mjs'
import { invalidateTimelineOwnerIndex } from './ownerIndex.mjs'

/** 联邦 RPC 单次 pull 响应上限（客户端循环 afterEventId 直至空批）。 */
export const FEDERATED_TIMELINE_PULL_BATCH = 200

const FEDERATED_TIMELINE_PULL_MAX_ROUNDS = 8

/**
 * 导入远程时间线事件（part_timeline_put / RPC pull 入站边界）。
 * @param {string} username 本地用户
 * @param {string} entityHash 时间线 owner
 * @param {object} event 签名事件
 * @returns {Promise<boolean>} 是否成功入站（含幂等重复）
 */
export async function ingestRemoteTimelineEvent(username, entityHash, event) {
	const existing = await readJsonl(timelineEventsPath(username, entityHash))
	const validated = await validateRemoteTimelineEvent(event, entityHash, {
		canonicalize: canonicalizeSignedTimelineEvent,
		priorEvents: existing,
	})
	if (!validated.accepted) return false
	if (existing.some(row => row.id === validated.row.id)) return true
	await appendJsonlSynced(timelineEventsPath(username, entityHash), validated.row)
	invalidateTimelineMaterializedCache(username, entityHash)
	invalidateTimelineOwnerIndex(username)
	await tryImportFollowApproveVault(username, entityHash, event)
	await projectFollowerIndexFromTimelineEvent(username, entityHash, validated.row)
	if (validated.row.type === 'block' || validated.row.type === 'unblock') {
		const { following } = await loadFollowing(username)
		await handleInboundPersonalBlockEvent(username, entityHash, validated.row, new Set(following))
	}
	await maintainSocialTimeline(username, entityHash)
	const { appendInboxFromTimelineEvent } = await import('../inbox.mjs')
	await appendInboxFromTimelineEvent(username, entityHash, validated.row)
	const { indexTimelineEventForSearch } = await import('../searchIndex.mjs')
	await indexTimelineEventForSearch(username, entityHash, validated.row)
	if (validated.row.type === 'post') {
		const { dispatchSocialMessage } = await import('../dispatch.mjs')
		await dispatchSocialMessage(username, entityHash, validated.row)
	}
	return true
}

/**
 * 经 TrustGraph RPC 拉取并导入远程时间线事件。
 * @param {string} username 用户
 * @param {string} entityHash owner
 * @returns {Promise<number>} 导入条数
 */
export async function syncTimelineForEntity(username, entityHash) {
	const timelineOwner = entityHash.toLowerCase()
	const { readTimelineEvents } = await import('./append.mjs')

	let imported = 0
	let afterEventId = null
	const local = await readTimelineEvents(username, timelineOwner)
	const knownIds = new Set(local.map(row => row.id))
	if (local.length) afterEventId = local[local.length - 1].id

	for (let round = 0; round < FEDERATED_TIMELINE_PULL_MAX_ROUNDS; round++) {
		const { data: responses, errors } = await collectSocialRpcMerged(username, {
			type: 'social_timeline_pull_request',
			entityHash: timelineOwner,
			afterEventId,
		}, 3000, 8)
		if (errors.length)
			console.warn('social: timeline pull neighbor errors', { entityHash: timelineOwner, count: errors.length })

		let roundImported = 0
		for (const row of responses)
			for (const event of row.events || []) {
				if (!await ingestRemoteTimelineEvent(username, timelineOwner, event)) continue
				if (!knownIds.has(event.id)) {
					knownIds.add(event.id)
					roundImported++
				}
				afterEventId = event.id
			}

		imported += roundImported
		if (!roundImported) break
	}

	const { reprocessFollowApproveVaults } = await import('../vault_crypto/followApproveImport.mjs')
	await reprocessFollowApproveVaults(username, timelineOwner)
	return imported
}

/**
 * @param {string} username replica
 * @returns {Promise<string[]>} 本机 operator + agent 关注目标的并集
 */
async function unionFollowingTargetsForLocalEntities(username) {
	/** @type {Set<string>} */
	const targets = new Set()
	const operator = await resolveOperatorEntityHash(username)
	const actors = []
	if (operator) actors.push(operator.toLowerCase())
	for (const { entityHash } of listLocalAgentEntities(username))
		actors.push(entityHash.toLowerCase())
	for (const actor of actors) {
		const { following } = await loadFollowingForActor(username, actor)
		for (const hash of following)
			if (hash !== actor) targets.add(hash)
	}
	return [...targets]
}

/**
 * 加载首页前同步本机全部 acting entity 关注目标的远程时间线。
 * @param {string} username 用户
 * @param {object} [options] 选项
 * @param {number} [options.max=24] 最多同步多少个关注
 * @returns {Promise<{ attempted: number, imported: number }>} 同步统计
 */
export async function syncFollowingTimelines(username, options = {}) {
	const max = Math.min(Math.max(Number(options.max) || 24, 1), 64)
	const targets = (await unionFollowingTargetsForLocalEntities(username)).slice(0, max)
	const results = await Promise.allSettled(
		targets.map(entityHash => syncTimelineForEntity(username, entityHash)),
	)
	return {
		attempted: targets.length,
		imported: results.reduce(
			(sum, result) => sum + (result.status === 'fulfilled' ? result.value : 0),
			0,
		),
	}
}

/**
 * 联邦 RPC 响应：按可见性过滤后返回时间线切片。
 * @param {string} username replica
 * @param {string} entityHash owner
 * @param {string | null | undefined} afterEventId 增量游标
 * @param {string | null | undefined} requesterNodeHash 请求方 nodeHash
 * @returns {Promise<object[]>} 可见事件切片
 */
export async function buildFederatedTimelinePullResponse(username, entityHash, afterEventId, requesterNodeHash) {
	const timelineOwner = entityHash.toLowerCase()
	const { readTimelineEvents } = await import('./append.mjs')
	const events = await readTimelineEvents(username, timelineOwner)
	const start = afterEventId
		? Math.max(0, events.findIndex(event => event.id === afterEventId.trim()) + 1)
		: 0
	return filterEventsForFederatedPull(
		username,
		timelineOwner,
		events.slice(start, start + FEDERATED_TIMELINE_PULL_BATCH),
		requesterNodeHash,
	)
}
