import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'

import { reputationPath } from './paths.mjs'

/** 信誉标量闭区间 §0.3 */
const REP_MIN = -1
const REP_MAX = 1

/** §9 默认：5 分钟内同一邻居「整批 want 本地全无」累计次数 */
const WANT_UNKNOWN_WINDOW_MS = 5 * 60 * 1000
const WANT_UNKNOWN_THRESHOLD = 3
/** 单次恶意惩罚（主观标量） */
const PENALTY_UNKNOWN_WANT = 0.12

/**
 * @typedef {{
 *   schema: number
 *   byNodeId: Record<string, { score: number }>
 *   wantUnknownHits: Array<{ peerNodeId: string, t: number }>
 * }} ReputationFile
 */

/**
 * @param {number} x 任意标量
 * @returns {number} clamp 到 [-1,1]
 */
export function clampReputationScore(x) {
	return Math.min(REP_MAX, Math.max(REP_MIN, x))
}

/**
 * @param {unknown} raw 磁盘 JSON
 * @returns {ReputationFile} 规范化后的信誉文件对象
 */
function normalizeRepFile(raw) {
	if (!raw || typeof raw !== 'object') 
		return { schema: 1, byNodeId: {}, wantUnknownHits: [] }
	
	const o = /** @type {Record<string, unknown>} */ raw
	const byNodeId = typeof o.byNodeId === 'object' && o.byNodeId && !Array.isArray(o.byNodeId)
		? /** @type {Record<string, { score: number }>} */ o.byNodeId
		: {}
	for (const k of Object.keys(byNodeId)) {
		const s = Number(byNodeId[k]?.score)
		byNodeId[k] = { score: clampReputationScore(Number.isFinite(s) ? s : 0) }
	}
	const hits = Array.isArray(o.wantUnknownHits) ? o.wantUnknownHits.filter(
		h => h && typeof h === 'object' && typeof /** @type {{ peerNodeId?: unknown }} */ h.peerNodeId === 'string' && typeof /** @type {{ t?: unknown }} */ h.t === 'number',
	) : []
	return {
		schema: 1,
		byNodeId,
		wantUnknownHits: hits.map(h => ({
			peerNodeId: String(/** @type {{ peerNodeId: string }} */ h.peerNodeId),
			t: Number(/** @type {{ t: number }} */ h.t),
		})),
	}
}

/**
 * 读取群本地信誉文件；不存在时返回默认空表。
 * @param {string} username 用户名
 * @param {string} groupId 群 ID
 * @returns {Promise<ReputationFile>} 规范化后的信誉表对象
 */
export async function loadReputation(username, groupId) {
	const p = reputationPath(username, groupId)
	try {
		const text = await readFile(p, 'utf8')
		return normalizeRepFile(JSON.parse(text))
	}
	catch {
		return normalizeRepFile(null)
	}
}

/**
 * 写入群本地信誉文件。
 * @param {string} username 用户名
 * @param {string} groupId 群 ID
 * @param {ReputationFile} data 信誉表
 * @returns {Promise<void>}
 */
export async function saveReputation(username, groupId, data) {
	const p = reputationPath(username, groupId)
	await mkdir(dirname(p), { recursive: true })
	const clean = normalizeRepFile(data)
	const now = Date.now()
	clean.wantUnknownHits = clean.wantUnknownHits.filter(h => now - h.t <= WANT_UNKNOWN_WINDOW_MS)
	await writeFile(p, JSON.stringify(clean, null, '\t'), 'utf8')
}

/**
 * 邻居整批 want 的 ID 在本节点均不存在时记录；窗口内达阈值则扣信誉（§9）。
 * @param {string} username 用户名
 * @param {string} groupId 群 ID
 * @param {string} peerNodeId 请求方节点 id
 * @returns {Promise<void>}
 */
export async function recordGossipAllUnknownWant(username, groupId, peerNodeId) {
	const now = Date.now()
	const data = await loadReputation(username, groupId)
	data.wantUnknownHits = data.wantUnknownHits.filter(h => now - h.t <= WANT_UNKNOWN_WINDOW_MS)
	data.wantUnknownHits.push({ peerNodeId, t: now })
	const recent = data.wantUnknownHits.filter(h => h.peerNodeId === peerNodeId)
	if (recent.length >= WANT_UNKNOWN_THRESHOLD) {
		const cur = data.byNodeId[peerNodeId]?.score ?? 0
		data.byNodeId[peerNodeId] = { score: clampReputationScore(cur - PENALTY_UNKNOWN_WANT) }
		data.wantUnknownHits = data.wantUnknownHits.filter(h => h.peerNodeId !== peerNodeId)
	}
	await saveReputation(username, groupId, data)
}

/**
 * 合并存档摘要：事件条数、末条 id、checkpoint 尖（用于 §9 want 前握手；对端可据此判定前缀/分叉）。
 * @param {object[]} events 本地 DAG 事件
 * @param {object | null} checkpoint `checkpoint.json` 解析结果或 null
 * @returns {{ hash: string, n: number, tip: string, cp: string }} 摘要哈希、条数、末事件 id、checkpoint 尖
 */
export function computeArchiveSummary(events, checkpoint) {
	const tip = events.length ? String(events[events.length - 1]?.id ?? '') : ''
	const cp = checkpoint && typeof checkpoint === 'object' && checkpoint.checkpoint_event_id
		? String(checkpoint.checkpoint_event_id)
		: ''
	const n = events.length
	const payload = JSON.stringify({ v: 1, n, tip, cp })
	const hash = createHash('sha256').update(payload, 'utf8').digest('hex')
	return { hash, n, tip, cp }
}

/** §0.1：与信誉标量解耦的正标量护栏 ε */
const REP_MAX_EFF_EPS = 1e-12

/**
 * 本群 `reputation.json` 中已记录主体的最大信誉标量（§0.1 `rep_max`）。
 * @param {ReputationFile} data 信誉文件
 * @returns {number} 当前主观表内各主体分数的上确界（已 clamp）
 */
export function computeRepMax(data) {
	let m = /** @type {number | null} */ null
	for (const k of Object.keys(data.byNodeId)) {
		const s = Number(data.byNodeId[k]?.score)
		if (Number.isFinite(s)) m = m === null ? s : Math.max(m, s)
	}
	return m === null ? 0 : clampReputationScore(m)
}

/**
 * @param {ReputationFile} data 群本地信誉文件
 * @returns {number} `max(rep_max, ε)`，用于 Slash 分母（§0.1）
 */
export function computeRepMaxEff(data) {
	return Math.max(computeRepMax(data), REP_MAX_EFF_EPS)
}

/**
 * 不可验证主观 Slash：对目标扣分 `|claim| * rep(sender) / rep_max_eff`（§0.1）；可验证类仅占位为固定权重。
 * @param {string} username 用户
 * @param {string} groupId 群
 * @param {object} ev DAG 事件
 * @returns {Promise<void>}
 */
export async function applySubjectiveSlashFromEvent(username, groupId, ev) {
	if (!ev || ev.type !== 'reputation_slash') return
	const c = ev.content && typeof ev.content === 'object' ? ev.content : {}
	const target = typeof c.targetPubKeyHash === 'string' ? c.targetPubKeyHash.trim().toLowerCase() : ''
	const sender = typeof ev.sender === 'string' ? ev.sender.trim().toLowerCase() : ''
	if (!/^[0-9a-f]{64}$/iu.test(target) || !/^[0-9a-f]{64}$/iu.test(sender)) return

	const data = await loadReputation(username, groupId)
	const repMaxEff = computeRepMaxEff(data)
	const repSender = Number(data.byNodeId[sender]?.score ?? 0)
	const verified = !!c.verified
	const rawClaim = Number(c.claim ?? c.unverifiedClaim ?? (verified ? 0.35 : 0.2))
	const claim = Number.isFinite(rawClaim) ? rawClaim : 0.2
	const effective = (claim * repSender) / repMaxEff
	const penalty = verified ? Math.abs(claim) * 0.4 : Math.abs(effective)
	const prev = Number(data.byNodeId[target]?.score ?? 0)
	data.byNodeId[target] = { score: clampReputationScore(prev - penalty) }
	await saveReputation(username, groupId, data)
}

/**
 * §0.3 衰减连坐：沿 `inviteEdges` 从被 slash 成员向上游 introducer 递减扣分。
 * @param {string} username 用户
 * @param {string} groupId 群
 * @param {string} targetPubKeyHash 被惩罚成员公钥哈希
 * @param {Array<{ from?: string, to?: string }>} inviteEdges 邀请边
 * @returns {Promise<void>}
 */
export async function applyDecayCollusionAfterSlash(username, groupId, targetPubKeyHash, inviteEdges) {
	const t = String(targetPubKeyHash || '').trim().toLowerCase()
	if (!/^[0-9a-f]{64}$/iu.test(t)) return
	const edges = Array.isArray(inviteEdges) ? inviteEdges : []
	const lambda = 0.07
	const delta = 0.62
	const data = await loadReputation(username, groupId)
	let frontier = new Set([t])
	for (let hop = 1; hop <= 6; hop++) {
		const upstream = new Set()
		for (const e of edges) {
			const from = typeof e.from === 'string' ? e.from.trim().toLowerCase() : ''
			const to = typeof e.to === 'string' ? e.to.trim().toLowerCase() : ''
			if (from && to && frontier.has(to)) upstream.add(from)
		}
		if (!upstream.size) break
		const dRep = lambda * delta ** hop
		for (const node of upstream) {
			const prev = Number(data.byNodeId[node]?.score ?? 0)
			data.byNodeId[node] = { score: clampReputationScore(prev - dRep) }
		}
		frontier = upstream
	}
	await saveReputation(username, groupId, data)
}

/**
 * `reputation_reset` 后同步主观表：目标条目归零（§6.3 本地解封语义简化）。
 * @param {string} username 用户
 * @param {string} groupId 群
 * @param {string} targetPubKeyHash 目标公钥哈希
 * @returns {Promise<void>}
 */
export async function applyReputationResetToScores(username, groupId, targetPubKeyHash) {
	const t = String(targetPubKeyHash || '').trim().toLowerCase()
	if (!/^[0-9a-f]{64}$/iu.test(t)) return
	const data = await loadReputation(username, groupId)
	data.byNodeId[t] = { score: 0 }
	await saveReputation(username, groupId, data)
}

/**
 * §0.3：新成员首次写入主观信誉 `rep_local(intro) * rep_edge` 再 clamp。
 * @param {string} username 用户
 * @param {string} groupId 群
 * @param {string} memberPubKeyHash 新成员
 * @param {string} [introducerPubKeyHash] 介绍者
 * @param {number} [repEdge] 边信任，缺省 1
 * @returns {Promise<void>}
 */
export async function seedMemberReputationFromIntroducer(username, groupId, memberPubKeyHash, introducerPubKeyHash, repEdge) {
	const m = String(memberPubKeyHash || '').trim().toLowerCase()
	if (!/^[0-9a-f]{64}$/iu.test(m)) return
	const intro = String(introducerPubKeyHash || '').trim().toLowerCase()
	const edge = typeof repEdge === 'number' && Number.isFinite(repEdge) ? clampReputationScore(repEdge) : 1
	const data = await loadReputation(username, groupId)
	if (data.byNodeId[m]) return
	const introRep = /^[0-9a-f]{64}$/iu.test(intro)
		? Number(data.byNodeId[intro]?.score ?? 0)
		: 0
	const repNew = clampReputationScore(introRep * edge)
	data.byNodeId[m] = { score: repNew }
	await saveReputation(username, groupId, data)
}

