/**
 * 信誉纯内存算子（模拟器与磁盘 store 共用）。
 */
import reputationTunables from './reputation.tunables.json' with { type: 'json' }
import {
	clampReputationScore,
	computeRepMaxEff,
	seedReputationFromIntro,
	subjectiveSlashPenalty,
} from './reputation_math.mjs'
import { relayBumpIsDuplicate } from './reputation_relay_dedupe.mjs'

/** @typedef {import('./reputation_store.mjs').ReputationFile} ReputationFile */

/**
 * @returns {typeof reputationTunables} 默认 reputation tunables 副本
 */
export function defaultReputationTunables() {
	return reputationTunables
}

/**
 * @param {ReputationFile} data 信誉表
 * @param {string} nodeId 64 hex
 * @returns {{ score: number, socialBlocks?: Record<string, object> }} 节点行
 */
function repRow(data, nodeId) {
	const row = data.byNodeHash[nodeId] || { score: 0 }
	const out = { score: Number(row.score ?? 0) }
	if (row.socialBlocks && typeof row.socialBlocks === 'object')
		out.socialBlocks = row.socialBlocks
	return out
}

/**
 * @param {ReputationFile} data 信誉表
 * @param {string} nodeId 64 hex
 * @param {number} delta 增量
 * @returns {void}
 */
export function adjustNodeReputation(data, nodeId, delta) {
	const row = repRow(data, nodeId)
	row.score = clampReputationScore(row.score + delta)
	data.byNodeHash[nodeId] = row
}

/**
 * @param {ReputationFile} data 磁盘 JSON（可信）
 * @returns {ReputationFile} 补齐字段后的同一对象
 */
export function ensureReputationShape(data) {
	data.byNodeHash ??= {}
	data.wantUnknownHits ??= []
	data.relayBumpSeen ??= []
	return data
}

/**
 * @param {ReputationFile} data 信誉表
 * @param {typeof reputationTunables} [tunables] tunables
 * @returns {ReputationFile} 裁剪后的同一对象
 */
export function pruneReputationFile(data, tunables = reputationTunables) {
	const now = Date.now()
	data.wantUnknownHits = data.wantUnknownHits.filter(hit => now - hit.t <= tunables.wantUnknownWindowMs)
	data.relayBumpSeen = data.relayBumpSeen.filter(hit => now - hit.t <= tunables.relayBumpDedupeMs)
	if (data.relayBumpSeen.length > tunables.maxRelayBumpSeen)
		data.relayBumpSeen = data.relayBumpSeen.slice(-tunables.maxRelayBumpSeen)
	return data
}

/**
 * @param {ReputationFile} data 信誉表
 * @param {string} peerNodeHash 对端节点
 * @param {string} [dedupeKey] 去重键
 * @param {number} [now] 当前时间
 * @param {typeof reputationTunables} [tunables] tunables
 * @returns {boolean} 是否已加分
 */
export function bumpReputationOnRelayPure(data, peerNodeHash, dedupeKey, now = Date.now(), tunables = reputationTunables) {
	const id = String(peerNodeHash || '').trim()
	if (!id) return false
	const key = String(dedupeKey || `conn:${id}`).trim()
	data.relayBumpSeen = data.relayBumpSeen.filter(hit => now - hit.t <= tunables.relayBumpDedupeMs)
	if (relayBumpIsDuplicate(data.relayBumpSeen, id, key, now, tunables.relayBumpDedupeMs)) return false
	data.relayBumpSeen.push({ peerNodeHash: id, key, t: now })
	const prev = Number(data.byNodeHash[id]?.score ?? 0)
	data.byNodeHash[id] = { score: clampReputationScore(prev + tunables.relayRepBump) }
	return true
}

/**
 * @param {ReputationFile} data 信誉表
 * @param {string} peerNodeHash 请求方
 * @param {number} [now] 当前时间
 * @param {typeof reputationTunables} [tunables] tunables
 * @returns {boolean} 是否触发惩罚
 */
export function recordGossipAllUnknownWantPure(data, peerNodeHash, now = Date.now(), tunables = reputationTunables) {
	data.wantUnknownHits = data.wantUnknownHits.filter(h => now - h.t <= tunables.wantUnknownWindowMs)
	data.wantUnknownHits.push({ peerNodeHash, t: now })
	const recent = data.wantUnknownHits.filter(h => h.peerNodeHash === peerNodeHash)
	if (recent.length >= tunables.wantUnknownThreshold) {
		adjustNodeReputation(data, peerNodeHash, -tunables.penaltyUnknownWant)
		data.wantUnknownHits = data.wantUnknownHits.filter(h => h.peerNodeHash !== peerNodeHash)
		return true
	}
	return false
}

/**
 * @param {ReputationFile} data 信誉表
 * @param {string} peerNodeHash 对端
 * @param {typeof reputationTunables} [tunables] tunables
 * @returns {void}
 */
export function recordMessageRateViolationPure(data, peerNodeHash, tunables = reputationTunables) {
	const id = String(peerNodeHash || '').trim()
	if (!id) return
	adjustNodeReputation(data, id, -tunables.penaltyMessageRate)
}

/**
 * @param {ReputationFile} data 信誉表
 * @param {string} storagePeerKey 责任方
 * @param {typeof reputationTunables} [tunables] tunables
 * @returns {void}
 */
export function bumpChunkStorageReputationPure(data, storagePeerKey, tunables = reputationTunables) {
	const id = String(storagePeerKey || '').trim()
	if (!id) return
	adjustNodeReputation(data, id, tunables.chunkStoreRepBump)
}

/**
 * @param {ReputationFile} data 信誉表
 * @param {string} blamePeerKey 责任方
 * @param {typeof reputationTunables} [tunables] tunables
 * @returns {void}
 */
export function penalizeChunkStorageFailurePure(data, blamePeerKey, tunables = reputationTunables) {
	const id = String(blamePeerKey || '').trim()
	if (!id) return
	adjustNodeReputation(data, id, -tunables.chunkFetchFailPenalty)
}

/**
 * @param {ReputationFile} data 信誉表
 * @param {string} peerNodeHash 对端 nodeHash
 * @param {typeof reputationTunables} [tunables] tunables
 * @returns {void}
 */
export function penalizeArchiveServeMismatchPure(data, peerNodeHash, tunables = reputationTunables) {
	const id = String(peerNodeHash || '').trim()
	if (!id) return
	adjustNodeReputation(data, id, -tunables.archiveServeMismatchPenalty)
}

/**
 * @param {ReputationFile} data 信誉表
 * @param {string} target 目标 nodeHash
 * @param {string} sender 发送方 nodeHash
 * @param {number} claim 主张强度
 * @param {boolean} verified 是否可验证
 * @param {typeof reputationTunables} [tunables] tunables
 * @returns {void}
 */
export function applySubjectiveSlashPure(data, target, sender, claim, verified, tunables = reputationTunables) {
	const repMaxEff = computeRepMaxEff(data)
	const repSender = Number(data.byNodeHash[sender]?.score ?? 0)
	const penalty = subjectiveSlashPenalty(claim, repSender, repMaxEff, verified, tunables)
	adjustNodeReputation(data, target, -penalty)
}

/**
 * @param {ReputationFile} data 信誉表
 * @param {string} targetPubKeyHash 目标
 * @param {Array<{ from?: string, to?: string }>} inviteEdges 邀请边
 * @param {typeof reputationTunables} [tunables] tunables
 * @returns {Array<{ hop: number, node: string, dRep: number }>} 已应用的上游惩罚
 */
export function applyDecayCollusionAfterSlashPure(data, targetPubKeyHash, inviteEdges, tunables = reputationTunables) {
	const target = targetPubKeyHash.trim().toLowerCase()
	/** @type {Array<{ hop: number, node: string, dRep: number }>} */
	const applied = []
	let frontier = new Set([target])
	for (let hop = 1; hop <= tunables.collusionMaxHop; hop++) {
		const upstream = new Set()
		for (const edge of inviteEdges)
			if (frontier.has(edge.to)) upstream.add(edge.from)

		if (!upstream.size) break
		const dRep = tunables.collusionLambda * tunables.collusionDelta ** hop
		for (const node of upstream) {
			const prev = Number(data.byNodeHash[node]?.score ?? 0)
			data.byNodeHash[node] = { score: clampReputationScore(prev - dRep) }
			applied.push({ hop, node, dRep })
		}
		frontier = upstream
	}
	return applied
}

/**
 * @param {ReputationFile} data 信誉表
 * @param {string} targetPubKeyHash 目标
 * @returns {void}
 */
export function applyReputationResetToScoresPure(data, targetPubKeyHash) {
	const t = targetPubKeyHash.trim().toLowerCase()
	data.byNodeHash[t] = { score: 0 }
}

/**
 * @param {ReputationFile} data 信誉表
 * @param {string} memberPubKeyHash 新成员
 * @param {string} [introducerPubKeyHash] 介绍者
 * @param {number} [repEdge] 边信任
 * @returns {void}
 */
export function seedMemberReputationFromIntroducerPure(data, memberPubKeyHash, introducerPubKeyHash, repEdge) {
	const memberKey = memberPubKeyHash.trim().toLowerCase()
	const introducerKey = introducerPubKeyHash?.trim().toLowerCase() || ''
	if (data.byNodeHash[memberKey]) return
	const introducerReputation = introducerKey
		? Number(data.byNodeHash[introducerKey]?.score ?? 0)
		: 0
	data.byNodeHash[memberKey] = { score: seedReputationFromIntro(introducerReputation, repEdge) }
}

/**
 * @param {object | null | undefined} groupSettings 群设置
 * @param {typeof reputationTunables} [tunables] tunables
 * @returns {number} 毫秒
 */
export function resolveSlashAlertTtlMsPure(groupSettings, tunables = reputationTunables) {
	const n = Number(groupSettings?.slashAlertTtl)
	return Number.isFinite(n) && n > 0 ? Math.floor(n) : tunables.defaultSlashAlertTtlMs
}
