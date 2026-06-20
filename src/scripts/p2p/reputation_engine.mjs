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
 * @returns {{ score: number, offenseStreak?: number, lastOffenseAt?: number, socialBlocks?: Record<string, object> }} 节点行
 */
function repRow(data, nodeId) {
	const row = data.byNodeHash[nodeId] || { score: 0 }
	const out = { score: Number(row.score ?? 0) }
	if (Number.isFinite(row.offenseStreak))
		out.offenseStreak = row.offenseStreak
	if (Number.isFinite(row.lastOffenseAt))
		out.lastOffenseAt = row.lastOffenseAt
	if (row.socialBlocks && typeof row.socialBlocks === 'object')
		out.socialBlocks = row.socialBlocks
	if (row.socialSuspects && typeof row.socialSuspects === 'object')
		out.socialSuspects = row.socialSuspects
	if (row.baseline && typeof row.baseline === 'object')
		out.baseline = row.baseline
	if (Number.isFinite(row.quarantinedUntil))
		out.quarantinedUntil = row.quarantinedUntil
	return out
}

/**
 * @param {number} streak 连续作恶次数
 * @param {typeof reputationTunables} tunables tunables
 * @returns {number} 惩罚乘子 ≥ 1
 */
export function computeRecidivismMultiplier(streak, tunables = reputationTunables) {
	const step = Number(tunables.recidivismMultiplierStep ?? 0)
	const maxMult = Number(tunables.recidivismMax ?? 1)
	if (!Number.isFinite(streak) || streak <= 0 || step <= 0 || maxMult <= 1)
		return 1
	return Math.min(maxMult, 1 + step * streak)
}

/**
 * @param {ReputationFile} data 信誉表
 * @param {string} nodeId 64 hex
 * @returns {NonNullable<ReputationFile['byNodeHash'][string]>} 节点行（可变引用）
 */
function ensureRow(data, nodeId) {
	if (!data.byNodeHash[nodeId]) data.byNodeHash[nodeId] = { score: 0 }
	return data.byNodeHash[nodeId]
}

/**
 * @param {number} badCount 坏邀请计数
 * @param {typeof reputationTunables} tunables tunables
 * @returns {number} 惩罚乘子 ≥ 1
 */
export function computeInviteEscalation(badCount, tunables = reputationTunables) {
	const step = Number(tunables.inviteBadEscalationStep ?? 0)
	const maxMult = Number(tunables.inviteBadEscalationMax ?? 1)
	if (!Number.isFinite(badCount) || badCount <= 0 || step <= 0 || maxMult <= 1)
		return 1
	return Math.min(maxMult, 1 + step * badCount)
}

/**
 * @param {object} row byNodeHash 行
 * @param {number} gain 正向收益
 * @param {typeof reputationTunables} tunables tunables
 * @returns {void}
 */
function applyRedemptionFromGain(row, gain, tunables = reputationTunables) {
	if (!Number.isFinite(gain) || gain <= 0) return
	const perStreak = Number(tunables.redemptionCreditPerStreakLevel ?? 0)
	const perBad = Number(tunables.inviteRedemptionCreditPerBad ?? 0)
	row.redemptionCredit = Number(row.redemptionCredit ?? 0) + gain
	if (perStreak > 0) {
		while ((row.offenseStreak ?? 0) > 0 && row.redemptionCredit >= perStreak) {
			row.redemptionCredit -= perStreak
			row.offenseStreak = Math.max(0, (row.offenseStreak ?? 0) - 1)
		}
		if ((row.offenseStreak ?? 0) <= 0) {
			delete row.offenseStreak
			delete row.lastOffenseAt
		}
	}
	if (perBad > 0) {
		while ((row.badInviteeCount ?? 0) > 0 && row.redemptionCredit >= perBad) {
			row.redemptionCredit -= perBad
			row.badInviteeCount = Math.max(0, (row.badInviteeCount ?? 0) - 1)
		}
		if ((row.badInviteeCount ?? 0) <= 0)
			delete row.badInviteeCount
	}
	if (!Number.isFinite(row.redemptionCredit) || row.redemptionCredit <= 1e-9)
		delete row.redemptionCredit
}

/**
 * @param {ReputationFile} data 信誉表
 * @param {string} nodeId 64 hex
 * @param {number} delta 增量
 * @param {number} [now] 当前时间
 * @param {typeof reputationTunables} [tunables] tunables
 * @returns {void}
 */
export function adjustNodeReputation(data, nodeId, delta, now = Date.now(), tunables = reputationTunables) {
	const row = ensureRow(data, nodeId)
	let effectiveDelta = delta
	if (delta < 0) {
		const streak = (row.offenseStreak ?? 0) + 1
		row.offenseStreak = streak
		row.lastOffenseAt = now
		effectiveDelta = delta * computeRecidivismMultiplier(streak, tunables)
	}
	else if (delta > 0)
		applyRedemptionFromGain(row, delta, tunables)

	row.score = clampReputationScore(Number(row.score ?? 0) + effectiveDelta)
}

/**
 * @param {ReputationFile} data 信誉表
 * @param {string} nodeId 64 hex
 * @param {number} badDelta 坏邀请计数增量
 * @param {typeof reputationTunables} [tunables] tunables
 * @returns {void}
 */
export function incrementBadInviteeCount(data, nodeId, badDelta = 1, tunables = reputationTunables) {
	if (badDelta <= 0) return
	const row = ensureRow(data, nodeId)
	row.badInviteeCount = Math.max(0, Math.floor(Number(row.badInviteeCount ?? 0) + badDelta))
	void tunables
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
 * @param {number} [now] 当前时间
 * @returns {ReputationFile} 裁剪后的同一对象
 */
export function pruneReputationFile(data, tunables = reputationTunables, now = Date.now()) {
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
	adjustNodeReputation(data, id, tunables.relayRepBump, now, tunables)
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
	let maxBadSeen = 0
	const baseMaxHop = Number(tunables.collusionMaxHop ?? 6)
	const hopBonusEvery = Math.max(1, Number(tunables.inviteHopBonusEvery ?? 2))
	const hopBonusMax = Number(tunables.inviteHopBonusMax ?? 0)
	const deltaBoostPerBad = Number(tunables.inviteDeltaBoostPerBad ?? 0)
	const deltaBoostMax = Number(tunables.inviteDeltaBoostMax ?? 0)

	/**
	 * @returns {number} 当前有效最大跳数
	 */
	function effectiveMaxHop() {
		return baseMaxHop + Math.min(hopBonusMax, Math.floor(maxBadSeen / hopBonusEvery))
	}

	for (let hop = 1; hop <= effectiveMaxHop(); hop++) {
		const upstream = new Set()
		for (const edge of inviteEdges) {
			const to = String(edge.to ?? '').trim().toLowerCase()
			const from = String(edge.from ?? '').trim().toLowerCase()
			if (frontier.has(to) && from) upstream.add(from)
		}
		if (!upstream.size) break

		for (const node of upstream) {
			incrementBadInviteeCount(data, node, 1, tunables)
			const row = ensureRow(data, node)
			const badCount = Number(row.badInviteeCount ?? 0)
			maxBadSeen = Math.max(maxBadSeen, badCount)
			const boostedDelta = Math.min(1, Number(tunables.collusionDelta ?? 0.62) + Math.min(deltaBoostMax, deltaBoostPerBad * badCount))
			const baseDRep = Number(tunables.collusionLambda ?? 0.07) * boostedDelta ** hop
			const dRep = baseDRep * computeInviteEscalation(badCount, tunables)
			const before = Number(row.score ?? 0)
			adjustNodeReputation(data, node, -dRep, Date.now(), tunables)
			const after = Number(data.byNodeHash[node]?.score ?? 0)
			applied.push({ hop, node, dRep: before - after })
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
	const row = repRow(data, t)
	row.score = 0
	delete row.offenseStreak
	delete row.lastOffenseAt
	delete row.badInviteeCount
	delete row.redemptionCredit
	data.byNodeHash[t] = row
}

/**
 * @param {ReputationFile} data 信誉表
 * @param {string} memberPubKeyHash 新成员
 * @param {string} [introducerPubKeyHash] 介绍者
 * @param {number} [repEdge] 边信任；省略则用 tunable introducerSeedEdge
 * @param {typeof reputationTunables} [tunables] tunables
 * @param {number} [powBonus=0] 入群 PoW 自愿封顶加成
 * @returns {void}
 */
export function seedMemberReputationFromIntroducerPure(data, memberPubKeyHash, introducerPubKeyHash, repEdge, tunables = reputationTunables, powBonus = 0) {
	const memberKey = memberPubKeyHash.trim().toLowerCase()
	const introducerKey = introducerPubKeyHash?.trim().toLowerCase() || ''
	if (data.byNodeHash[memberKey]) return
	const introducerReputation = introducerKey
		? Number(data.byNodeHash[introducerKey]?.score ?? 0)
		: 0
	data.byNodeHash[memberKey] = { score: seedReputationFromIntro(introducerReputation, repEdge, tunables, powBonus) }
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

/**
 * @param {object} row byNodeHash 行
 * @returns {{ mean: number, m2: number, count: number }} 行为基线
 */
function baselineRow(row) {
	const baseline = row.baseline || { mean: 0, m2: 0, count: 0 }
	return {
		mean: Number(baseline.mean ?? 0),
		m2: Number(baseline.m2 ?? 0),
		count: Number(baseline.count ?? 0),
	}
}

/**
 * @param {ReputationFile} data 信誉表
 * @param {string} peerNodeHash 对端
 * @param {number} sample 观测值
 * @param {number} [now] 当前时间
 * @param {typeof reputationTunables} [tunables] tunables
 * @returns {{ z: number, anomaly: boolean }} 偏离度
 */
export function observeBehaviorSamplePure(data, peerNodeHash, sample, now = Date.now(), tunables = reputationTunables) {
	const id = String(peerNodeHash || '').trim()
	if (!id) return { z: 0, anomaly: false }
	const row = repRow(data, id)
	const baseline = baselineRow(row)
	const alpha = Number(tunables.baselineAlpha ?? 0.08)
	const value = Number(sample)
	if (!Number.isFinite(value)) return { z: 0, anomaly: false }

	const prevMean = baseline.mean
	const prevCount = baseline.count
	const newCount = prevCount + 1
	const newMean = prevCount === 0 ? value : prevMean + alpha * (value - prevMean)
	const diff = value - newMean
	const newM2 = prevCount === 0 ? 0 : (1 - alpha) * (baseline.m2 + alpha * (value - prevMean) ** 2)
	row.baseline = { mean: newMean, m2: newM2, count: newCount }
	data.byNodeHash[id] = row

	const variance = newCount > 1 ? Math.max(newM2, 1e-6) : 0
	const std = Math.sqrt(variance)
	const z = std > 0 ? Math.abs(value - newMean) / std : 0
	const minSamples = Number(tunables.baselineMinSamples ?? 6)
	const anomaly = newCount >= minSamples && z >= Number(tunables.anomalyZThreshold ?? 2.8)
	if (anomaly)
		applyQuarantinePure(data, id, now, tunables)
	return { z, anomaly }
}

/**
 * @param {ReputationFile} data 信誉表
 * @param {string} peerNodeHash 对端
 * @param {number} [now] 当前时间
 * @param {typeof reputationTunables} [tunables] tunables
 * @returns {void}
 */
export function applyQuarantinePure(data, peerNodeHash, now = Date.now(), tunables = reputationTunables) {
	const id = String(peerNodeHash || '').trim()
	if (!id) return
	const row = repRow(data, id)
	row.quarantinedUntil = now + Number(tunables.quarantineTtlMs ?? 900_000)
	data.byNodeHash[id] = row
}

/**
 * @param {ReputationFile} data 信誉表
 * @param {string} peerNodeHash 对端
 * @param {number} [now] 当前时间
 * @returns {boolean} 是否处于本地隔离
 */
export function isQuarantinedPure(data, peerNodeHash, now = Date.now()) {
	const id = String(peerNodeHash || '').trim()
	const until = Number(data.byNodeHash?.[id]?.quarantinedUntil ?? 0)
	return Number.isFinite(until) && until > now
}

/**
 * @param {ReputationFile} data 信誉表
 * @param {string} peerNodeHash 对端
 * @param {number} [now] 当前时间
 * @param {typeof reputationTunables} [tunables] tunables
 * @returns {boolean} 是否检测到异常并触发隔离
 */
export function detectAnomalyPure(data, peerNodeHash, now = Date.now(), tunables = reputationTunables) {
	return isQuarantinedPure(data, peerNodeHash, now)
}
