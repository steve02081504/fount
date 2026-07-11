import { assertHex64, isHex64, normalizeHex64 } from './hexIds.mjs'
import { getNodeDir, getNodeLogger, isNodeInitialized } from './node/instance.mjs'
import { readNodeJsonSync, writeNodeJsonSync } from './node/storage.mjs'
import reputationTunables from './reputation.tunables.json' with { type: 'json' }
import {
	applyDecayCollusionAfterSlashPure,
	applyReputationResetToScoresPure,
	applySubjectiveSlashPure,
	bumpChunkStorageReputationPure,
	bumpReputationOnRelayPure,
	ensureReputationShape,
	isQuarantinedPure,
	observeBehaviorSamplePure,
	penalizeArchiveServeMismatchPure,
	penalizeChunkStorageFailurePure,
	pruneReputationFile,
	recordGossipAllUnknownWantPure,
	recordMessageRateViolationPure,
	resolveSlashAlertTtlMsPure,
	seedMemberReputationFromIntroducerPure,
} from './reputation_engine.mjs'
import { pickNodeScoreFromReputation } from './reputation_pick_score.mjs'
import { invalidateTrustGraphCache } from './trust_graph_cache.mjs'
import { withAsyncMutex } from './utils/async_mutex.mjs'
import { recordWantIdsBackoff, wantIdsPeerKey } from './want_ids.mjs'

const DATA_NAME = 'reputation'

/** @type {((opts: object) => Promise<boolean>) | null} */
let blockReputationHandler = null

/**
 * Social shell Load 时注册：公开 block/unblock → 信誉传导。
 * @param {(opts: object) => Promise<boolean>} handler
 * @returns {void}
 */
export function registerBlockReputationHandler(handler) {
	blockReputationHandler = handler
}

/** @returns {void} */
export function unregisterBlockReputationHandler() {
	blockReputationHandler = null
}

/**
 * @typedef {{
 *   byNodeHash: Record<string, { score: number, offenseStreak?: number, lastOffenseAt?: number, socialBlocks?: Record<string, { penalty: number, appliedAt: number, decayedRefund?: number }> }>
 *   wantUnknownHits: Array<{ peerNodeHash: string, t: number }>
 *   relayBumpSeen: Array<{ peerNodeHash: string, key: string, t: number }>
 * }} ReputationFile
 */

/** @type {ReputationFile | null} */
let reputationCache = null

/** @type {string | null} */
let reputationCacheNodeDir = null

/**
 * @param {(data: ReputationFile) => void | Promise<void>} mutator 突变
 * @returns {Promise<void>}
 */
export function mutateReputation(mutator) {
	return withAsyncMutex('reputation', async () => {
		const data = loadReputation()
		await mutator(data)
		saveReputation(data)
	})
}

/**
 * @returns {ReputationFile} 节点级信誉表
 */
export function loadReputation() {
	const nodeDir = isNodeInitialized() ? getNodeDir() : ''
	if (reputationCache && reputationCacheNodeDir === nodeDir) return reputationCache
	reputationCacheNodeDir = nodeDir
	reputationCache = ensureReputationShape(readNodeJsonSync(DATA_NAME) || {})
	return reputationCache
}

/**
 * @param {ReputationFile} data 信誉表
 * @returns {void}
 */
export function saveReputation(data) {
	pruneReputationFile(data)
	writeNodeJsonSync(DATA_NAME, data)
	reputationCache = data
	invalidateTrustGraphCache()
}

/**
 * @param {string} peerNodeHash 对端节点
 * @param {string} [dedupeKey] 去重键
 * @returns {Promise<void>}
 */
export function bumpReputationOnRelay(peerNodeHash, dedupeKey) {
	return mutateReputation(data => {
		bumpReputationOnRelayPure(data, peerNodeHash, dedupeKey)
	})
}

/**
 * @param {string} groupId 群 ID（仅用于 want 去重键）
 * @param {string} peerNodeHash 请求方
 * @returns {Promise<void>}
 */
export function recordGossipAllUnknownWant(groupId, peerNodeHash) {
	return mutateReputation(data => {
		if (recordGossipAllUnknownWantPure(data, peerNodeHash))
			recordWantIdsBackoff(wantIdsPeerKey(groupId, peerNodeHash))
	})
}

/**
 * @param {string} peerNodeHash 对端
 * @param {number} [excessRatio=1] 超速超额比例 0..1
 * @returns {Promise<void>}
 */
export function recordMessageRateViolation(peerNodeHash, excessRatio = 1) {
	const id = String(peerNodeHash || '').trim()
	if (!id) return Promise.resolve()
	return mutateReputation(data => {
		recordMessageRateViolationPure(data, id, undefined, excessRatio)
		observeBehaviorSamplePure(data, id, 1)
	})
}

/**
 * @param {string} peerNodeHash 对端
 * @param {number} sample 行为样本强度
 * @returns {Promise<boolean>} 是否触发异常隔离
 */
export async function observePeerBehavior(peerNodeHash, sample) {
	const id = String(peerNodeHash || '').trim()
	if (!id) return false
	let anomaly = false
	await mutateReputation(data => {
		const result = observeBehaviorSamplePure(data, id, sample)
		anomaly = result.anomaly
	})
	return anomaly
}

/**
 * @param {string} peerNodeHash 对端
 * @returns {boolean} 是否处于本地隔离
 */
export function isPeerQuarantined(peerNodeHash) {
	return isQuarantinedPure(loadReputation(), peerNodeHash)
}

/**
 * @param {string} storagePeerKey 责任方
 * @returns {void}
 */
export function bumpChunkStorageReputation(storagePeerKey) {
	const id = String(storagePeerKey || '').trim()
	if (!id) return
	void mutateReputation(data => {
		bumpChunkStorageReputationPure(data, id)
	})
}

/**
 * @param {string} blamePeerKey 责任方
 * @returns {void}
 */
export function penalizeChunkStorageFailure(blamePeerKey) {
	const id = String(blamePeerKey || '').trim()
	if (!id) return
	void mutateReputation(data => {
		penalizeChunkStorageFailurePure(data, id)
	})
}

/**
 * @param {string} peerNodeHash 对端 nodeHash
 * @returns {void}
 */
export function penalizeArchiveServeMismatch(peerNodeHash) {
	const id = String(peerNodeHash || '').trim()
	if (!id) return
	void mutateReputation(data => {
		penalizeArchiveServeMismatchPure(data, id)
	})
}

/**
 * @param {object | null | undefined} groupSettings 群设置
 * @returns {number} 毫秒
 */
export function resolveSlashAlertTtlMs(groupSettings) {
	return resolveSlashAlertTtlMsPure(groupSettings)
}

/**
 * @param {object} alert VOLATILE slash 载荷
 * @returns {boolean} 是否已应用
 */
export async function applyVolatileSlashAlert(alert) {
	const expiresAt = Number(alert?.expiresAt)
	if (Number.isFinite(expiresAt) && Date.now() > expiresAt) return false
	const target = normalizeHex64(alert?.targetPubKeyHash)
	const sender = normalizeHex64(alert?.sender)
	if (!isHex64(target) || !isHex64(sender)) return false
	const claim = Number.isFinite(Number(alert?.claim)) ? Number(alert.claim) : reputationTunables.slashDefaultClaim
	await mutateReputation(data => {
		applySubjectiveSlashPure(data, target, sender, claim, false)
	})
	return true
}

/**
 * @param {string} senderPubKeyHash 签发者
 * @param {{ targetPubKeyHash: string, claim?: number }} content Slash 内容
 * @param {object} [groupSettings] 群设置
 * @returns {object} VOLATILE 载荷
 */
export function buildAndApplyUnverifiedSlashAlert(senderPubKeyHash, content, groupSettings = {}) {
	const targetPubKeyHash = assertHex64(content.targetPubKeyHash, 'slash target')
	const claim = Number.isFinite(Number(content.claim)) ? Number(content.claim) : reputationTunables.slashDefaultClaim
	const sender = assertHex64(senderPubKeyHash, 'slash sender')
	const ttl = resolveSlashAlertTtlMs(groupSettings)
	return {
		type: 'reputation_slash_alert',
		targetPubKeyHash,
		sender,
		claim,
		expiresAt: Date.now() + ttl,
	}
}

/**
 * @param {string} username 用户（readEvents 回调用）
 * @param {string} groupId 群
 * @param {object} event reputation_slash 事件
 * @param {(username: string, groupId: string) => Promise<object[]>} readEvents 读 DAG 事件
 * @returns {Promise<void>}
 */
export async function applySubjectiveSlashFromEvent(username, groupId, event, readEvents) {
	if (event.type !== 'reputation_slash') return
	const { content } = event
	const target = content.targetPubKeyHash.trim().toLowerCase()
	const sender = event.sender.trim().toLowerCase()

	await mutateReputation(async data => {
		const verified = content.verified && await verifySlashProof(username, groupId, content, readEvents)
		const claim = Number(content.claim ?? (verified ? reputationTunables.slashVerifiedDefaultClaim : reputationTunables.slashUnverifiedDefaultClaim))
		applySubjectiveSlashPure(data, target, sender, claim, verified)
	})
}

/**
 * @param {string} username 用户
 * @param {string} groupId 群
 * @param {object} content slash content
 * @param {(username: string, groupId: string) => Promise<object[]>} readEvents 读 DAG
 * @returns {Promise<boolean>} 是否找到 proof 对应事件
 */
async function verifySlashProof(username, groupId, content, readEvents) {
	const eventId = content?.proof?.eventId?.trim().toLowerCase()
	if (!eventId) return false
	const events = await readEvents(username, groupId)
	return events.some(event => event.id === eventId)
}

/**
 * @param {string} targetPubKeyHash 目标
 * @param {Array<{ from?: string, to?: string }>} inviteEdges 邀请边
 * @returns {void}
 */
export function applyDecayCollusionAfterSlash(targetPubKeyHash, inviteEdges) {
	void mutateReputation(data => {
		const applied = applyDecayCollusionAfterSlashPure(data, targetPubKeyHash, inviteEdges)
		if (applied.length)
			getNodeLogger().warn?.('reputation: collusion decay after slash', {
				target: targetPubKeyHash.trim().toLowerCase(),
				upstreamCount: applied.length,
				hops: applied.map(row => row.hop),
			})
	})
}

/**
 * @param {string} targetPubKeyHash 目标
 * @returns {void}
 */
export function applyReputationResetToScores(targetPubKeyHash) {
	void mutateReputation(data => {
		applyReputationResetToScoresPure(data, targetPubKeyHash)
	})
}

/**
 * @param {string} memberPubKeyHash 新成员
 * @param {string} [introducerPubKeyHash] 介绍者
 * @param {number} [repEdge] 边信任
 * @param {number} [powBonus=0] 入群 PoW 自愿封顶加成
 * @returns {void}
 */
export function seedMemberReputationFromIntroducer(memberPubKeyHash, introducerPubKeyHash, repEdge, powBonus = 0) {
	void mutateReputation(data => {
		seedMemberReputationFromIntroducerPure(data, memberPubKeyHash, introducerPubKeyHash, repEdge, undefined, powBonus)
	})
}

/**
 * @param {string} nodeId 64 hex
 * @returns {number} 信誉分
 */
export function pickNodeScore(nodeId) {
	return pickNodeScoreFromReputation(loadReputation(), nodeId)
}

/**
 * @param {object} opts applyFollowedBlockSignal 参数
 * @returns {Promise<boolean>} 是否已应用
 */
export async function applySocialBlockReputationSignal(opts) {
	if (!blockReputationHandler) return false
	return blockReputationHandler(opts)
}
