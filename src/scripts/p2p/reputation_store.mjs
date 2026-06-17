import { assertHex64, isHex64, normalizeHex64 } from './hexIds.mjs'
import { readNodeJsonSync, writeNodeJsonSync } from './node/storage.mjs'
import {
	clampReputationScore,
	computeRepMaxEff,
	seedReputationFromIntro,
	subjectiveSlashPenalty,
} from './reputation.mjs'
import { pickNodeScoreFromReputation } from './reputation_pick_score.mjs'
import {
	RELAY_BUMP_DEDUPE_MS,
	relayBumpIsDuplicate,
} from './reputation_relay_dedupe.mjs'
import { invalidateTrustGraphCache } from './trust_graph_cache.mjs'
import { withAsyncMutex } from './utils/async_mutex.mjs'
import { recordWantIdsBackoff, wantIdsPeerKey } from './want_ids.mjs'

const DATA_NAME = 'reputation'

/** §9 默认：5 分钟内同一邻居「整批 want 本地全无」累计次数 */
const WANT_UNKNOWN_WINDOW_MS = 5 * 60 * 1000
const WANT_UNKNOWN_THRESHOLD = 3
const PENALTY_UNKNOWN_WANT = 0.12
const PENALTY_MESSAGE_RATE = 0.15
const CHUNK_STORE_REP_BUMP = 0.03
const CHUNK_FETCH_FAIL_PENALTY = 0.08
const ARCHIVE_SERVE_MISMATCH_PENALTY = 0.08
const RELAY_REP_BUMP = 0.02
const DEFAULT_SLASH_ALERT_TTL_MS = 86_400_000
const MAX_RELAY_BUMP_SEEN = 2000

/**
 * @typedef {{
 *   byNodeHash: Record<string, { score: number, scopes?: Record<string, number> }>
 *   wantUnknownHits: Array<{ peerNodeHash: string, t: number }>
 *   relayBumpSeen: Array<{ peerNodeHash: string, key: string, t: number }>
 * }} ReputationFile
 */

/**
 *
 */
export { relayBumpIsDuplicate } from './reputation_relay_dedupe.mjs'

/**
 * @param {ReputationFile} data 信誉表
 * @param {string} nodeId 64 hex
 * @returns {{ score: number, scopes: Record<string, number> }} 节点行
 */
function repRow(data, nodeId) {
	const row = data.byNodeHash[nodeId] || { score: 0 }
	return {
		score: Number(row.score ?? 0),
		scopes: row.scopes ? { ...row.scopes } : {},
	}
}

/**
 * @param {ReputationFile} data 信誉表
 * @param {string} nodeId 64 hex
 * @param {string} groupId 群 ID
 * @param {number} delta 增量
 * @returns {void}
 */
function adjustNodeReputation(data, nodeId, groupId, delta) {
	const row = repRow(data, nodeId)
	if (groupId) {
		const prev = row.scopes[groupId] ?? 0
		row.scopes[groupId] = clampReputationScore(prev + delta)
	}
	else
		row.score = clampReputationScore(row.score + delta)
	data.byNodeHash[nodeId] = row
}

/**
 * @param {ReputationFile} data 磁盘 JSON（可信）
 * @returns {ReputationFile} 补齐字段后的同一对象
 */
function ensureReputationShape(data) {
	data.byNodeHash ??= {}
	data.wantUnknownHits ??= []
	data.relayBumpSeen ??= []
	return data
}

/**
 * @param {ReputationFile} data 信誉表
 * @returns {ReputationFile} 裁剪后的同一对象
 */
function pruneReputationFile(data) {
	const now = Date.now()
	data.wantUnknownHits = data.wantUnknownHits.filter(hit => now - hit.t <= WANT_UNKNOWN_WINDOW_MS)
	data.relayBumpSeen = data.relayBumpSeen.filter(hit => now - hit.t <= RELAY_BUMP_DEDUPE_MS)
	if (data.relayBumpSeen.length > MAX_RELAY_BUMP_SEEN)
		data.relayBumpSeen = data.relayBumpSeen.slice(-MAX_RELAY_BUMP_SEEN)
	return data
}

/** @type {ReputationFile | null} */
let reputationCache = null

/**
 * @param {(data: ReputationFile) => void | Promise<void>} mutator 突变
 * @returns {Promise<void>}
 */
function mutateReputation(mutator) {
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
	if (reputationCache) return reputationCache
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
	const id = String(peerNodeHash || '').trim()
	if (!id) return Promise.resolve()
	const key = String(dedupeKey || `conn:${id}`).trim()
	return mutateReputation(data => {
		const now = Date.now()
		data.relayBumpSeen = data.relayBumpSeen.filter(hit => now - hit.t <= RELAY_BUMP_DEDUPE_MS)
		if (relayBumpIsDuplicate(data.relayBumpSeen, id, key, now)) return
		data.relayBumpSeen.push({ peerNodeHash: id, key, t: now })
		const prev = Number(data.byNodeHash[id]?.score ?? 0)
		data.byNodeHash[id] = { score: clampReputationScore(prev + RELAY_REP_BUMP) }
	})
}

/**
 * @param {string} groupId 群 ID
 * @param {string} peerNodeHash 请求方
 * @returns {Promise<void>}
 */
export function recordGossipAllUnknownWant(groupId, peerNodeHash) {
	return mutateReputation(data => {
		const now = Date.now()
		data.wantUnknownHits = data.wantUnknownHits.filter(h => now - h.t <= WANT_UNKNOWN_WINDOW_MS)
		data.wantUnknownHits.push({ peerNodeHash, t: now })
		const recent = data.wantUnknownHits.filter(h => h.peerNodeHash === peerNodeHash)
		if (recent.length >= WANT_UNKNOWN_THRESHOLD) {
			adjustNodeReputation(data, peerNodeHash, groupId, -PENALTY_UNKNOWN_WANT)
			data.wantUnknownHits = data.wantUnknownHits.filter(h => h.peerNodeHash !== peerNodeHash)
			recordWantIdsBackoff(wantIdsPeerKey(groupId, peerNodeHash))
		}
	})
}

/**
 * @param {string} groupId 群 scope
 * @param {string} peerNodeHash 对端
 * @returns {void}
 */
export function recordMessageRateViolation(groupId, peerNodeHash) {
	const id = String(peerNodeHash || '').trim()
	if (!id) return
	void mutateReputation(data => {
		adjustNodeReputation(data, id, groupId, -PENALTY_MESSAGE_RATE)
	})
}

/**
 * @param {string} groupId 群 scope
 * @param {string} storagePeerKey 责任方
 * @returns {void}
 */
export function bumpChunkStorageReputation(groupId, storagePeerKey) {
	const id = String(storagePeerKey || '').trim()
	if (!id) return
	void mutateReputation(data => {
		adjustNodeReputation(data, id, groupId, CHUNK_STORE_REP_BUMP)
	})
}

/**
 * @param {string} groupId 群 scope
 * @param {string} blamePeerKey 责任方
 * @returns {void}
 */
export function penalizeChunkStorageFailure(groupId, blamePeerKey) {
	const id = String(blamePeerKey || '').trim()
	if (!id) return
	void mutateReputation(data => {
		adjustNodeReputation(data, id, groupId, -CHUNK_FETCH_FAIL_PENALTY)
	})
}

/**
 * @param {string} groupId 群 scope
 * @param {string} peerNodeHash 对端 nodeHash
 * @returns {void}
 */
export function penalizeArchiveServeMismatch(groupId, peerNodeHash) {
	const id = String(peerNodeHash || '').trim()
	if (!id) return
	void mutateReputation(data => {
		adjustNodeReputation(data, id, groupId, -ARCHIVE_SERVE_MISMATCH_PENALTY)
	})
}

/**
 * @param {object | null | undefined} groupSettings 群设置
 * @returns {number} 毫秒
 */
export function resolveSlashAlertTtlMs(groupSettings) {
	const n = Number(groupSettings?.slashAlertTtl)
	return Number.isFinite(n) && n > 0 ? Math.floor(n) : DEFAULT_SLASH_ALERT_TTL_MS
}

/**
 * @param {string} groupId 群 scope
 * @param {object} alert VOLATILE slash 载荷
 * @returns {boolean} 是否已应用
 */
export function applyVolatileSlashAlert(groupId, alert) {
	const expiresAt = Number(alert?.expiresAt)
	if (Number.isFinite(expiresAt) && Date.now() > expiresAt) return false
	const target = normalizeHex64(alert?.targetPubKeyHash)
	const sender = normalizeHex64(alert?.sender)
	if (!isHex64(target) || !isHex64(sender)) return false
	const claim = Number.isFinite(Number(alert?.claim)) ? Number(alert.claim) : 0.2
	void mutateReputation(data => {
		const repMaxEff = computeRepMaxEff(data)
		const repSender = Number(data.byNodeHash[sender]?.score ?? 0)
		const penalty = subjectiveSlashPenalty(claim, repSender, repMaxEff, false)
		adjustNodeReputation(data, target, groupId, -penalty)
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
	const claim = Number.isFinite(Number(content.claim)) ? Number(content.claim) : 0.2
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
		const repMaxEff = computeRepMaxEff(data)
		const repSender = Number(data.byNodeHash[sender]?.score ?? 0)
		const verified = content.verified && await verifySlashProof(username, groupId, content, readEvents)
		const claim = Number(content.claim ?? (verified ? 0.35 : 0.2))
		const penalty = subjectiveSlashPenalty(claim, repSender, repMaxEff, verified)
		adjustNodeReputation(data, target, groupId, -penalty)
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
	const target = targetPubKeyHash.trim().toLowerCase()
	const lambda = 0.07
	const delta = 0.62
	void mutateReputation(data => {
		let frontier = new Set([target])
		for (let hop = 1; hop <= 6; hop++) {
			const upstream = new Set()
			for (const edge of inviteEdges)
				if (frontier.has(edge.to)) upstream.add(edge.from)

			if (!upstream.size) break
			const dRep = lambda * delta ** hop
			for (const node of upstream) {
				const prev = Number(data.byNodeHash[node]?.score ?? 0)
				data.byNodeHash[node] = { score: clampReputationScore(prev - dRep) }
			}
			frontier = upstream
		}
	})
}

/**
 * @param {string} targetPubKeyHash 目标
 * @returns {void}
 */
export function applyReputationResetToScores(targetPubKeyHash) {
	const t = targetPubKeyHash.trim().toLowerCase()
	void mutateReputation(data => {
		data.byNodeHash[t] = { score: 0 }
	})
}

/**
 * @param {string} memberPubKeyHash 新成员
 * @param {string} [introducerPubKeyHash] 介绍者
 * @param {number} [repEdge] 边信任
 * @returns {void}
 */
export function seedMemberReputationFromIntroducer(memberPubKeyHash, introducerPubKeyHash, repEdge) {
	const memberKey = memberPubKeyHash.trim().toLowerCase()
	const introducerKey = introducerPubKeyHash?.trim().toLowerCase() || ''
	void mutateReputation(data => {
		if (data.byNodeHash[memberKey]) return
		const introducerReputation = introducerKey
			? Number(data.byNodeHash[introducerKey]?.score ?? 0)
			: 0
		data.byNodeHash[memberKey] = { score: seedReputationFromIntro(introducerReputation, repEdge) }
	})
}

/**
 * @param {string} nodeId 64 hex
 * @param {string} [groupId] 群 scope
 * @returns {number} 信誉分
 */
export function pickNodeScore(nodeId, groupId = '') {
	return pickNodeScoreFromReputation(loadReputation(), nodeId, groupId)
}
