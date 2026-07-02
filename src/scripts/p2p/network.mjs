import { loadDenylist } from './denylist.mjs'
import { isHex64, normalizeHex64 } from './hexIds.mjs'
import { isNodeInitialized } from './node/instance.mjs'
import { readNodeJsonSync, writeNodeJsonSync } from './node/storage.mjs'
import { invalidateTrustGraphCache } from './trust_graph_cache.mjs'

/**
 * @typedef {{
 *   trustedPeers: string[]
 *   explorePeers: string[]
 *   blockedPeers: string[]
 *   lastRosterAt: number
 *   hintSources?: Map<string, string>
 * }} PeerPoolView
 */

const DATA_NAME = 'network'
const MAX_EXPLORE = 500
const MAX_HINTS = 256
const MAX_HINTS_PER_SOURCE = 12
const DEFAULT_EXPLORE_TTL_MS = 7 * 24 * 60 * 60 * 1000

/**
 * @typedef {{ nodeHash: string, source: string, kind: string, weight?: number, expiresAt: number, groupId?: string }} NetworkHint
 */

/**
 * @param {unknown} raw 磁盘 JSON
 * @returns {{ trustedPeers: string[], explorePeers: string[], hints: NetworkHint[], lastRosterAt: number }} 规范化网络表
 */
export function normalizeNetwork(raw) {
	const file = raw ?? {}
	/**
	 * @param {string} key 字段名
	 * @returns {string[]} 去重 nodeHash 列表
	 */
	const pickIds = key => [...new Set(
		(Array.isArray(file[key]) ? file[key] : [])
			.map(id => normalizeHex64(id) || String(id).trim())
			.filter(id => isHex64(id)),
	)]
	const hints = (Array.isArray(file.hints) ? file.hints : [])
		.map(hint => ({
			nodeHash: normalizeHex64(hint?.nodeHash) || '',
			source: String(hint?.source || '').trim(),
			kind: String(hint?.kind || '').trim(),
			weight: Number.isFinite(Number(hint?.weight)) ? Number(hint.weight) : 0.1,
			expiresAt: Number(hint?.expiresAt) || 0,
			...hint?.groupId ? { groupId: String(hint.groupId).trim() } : {},
		}))
		.filter(hint => isHex64(hint.nodeHash))
	return {
		trustedPeers: pickIds('trustedPeers'),
		explorePeers: pickIds('explorePeers'),
		hints,
		lastRosterAt: Number.isFinite(file.lastRosterAt) ? Number(file.lastRosterAt) : 0,
	}
}

/**
 * @returns {{ trustedPeers: string[], explorePeers: string[], hints: NetworkHint[], lastRosterAt: number }} 节点级 P2P 网络
 */
export function loadNetwork() {
	return normalizeNetwork(readNodeJsonSync(DATA_NAME))
}

/**
 * 限制同一 source 的 hint 数量，防止 PEX/单源灌满 explore。
 * @param {NetworkHint[]} hints hint 列表
 * @param {number} [maxPerSource=MAX_HINTS_PER_SOURCE] 每源上限
 * @returns {NetworkHint[]} 裁剪后列表（保留较新条目）
 */
export function capHintsBySource(hints, maxPerSource = MAX_HINTS_PER_SOURCE) {
	/** @type {Map<string, number>} */
	const counts = new Map()
	const out = []
	for (const hint of [...hints].reverse()) {
		const src = String(hint.source || 'unknown')
		const n = counts.get(src) ?? 0
		if (n >= maxPerSource) continue
		counts.set(src, n + 1)
		out.unshift(hint)
	}
	return out
}

/**
 * @param {ReturnType<typeof normalizeNetwork>} data 网络表
 * @returns {void}
 */
export function saveNetwork(data) {
	const clean = normalizeNetwork(data)
	const now = Date.now()
	clean.hints = capHintsBySource(clean.hints.filter(h => !h.expiresAt || h.expiresAt > now)).slice(-MAX_HINTS)
	clean.explorePeers = clean.explorePeers.slice(-MAX_EXPLORE)
	writeNodeJsonSync(DATA_NAME, clean)
	invalidateTrustGraphCache()
}

/**
 * @param {string} nodeHash 64 hex
 * @param {'trusted' | 'explore'} tier 池档位
 * @returns {void}
 */
export function addNetworkPeer(nodeHash, tier = 'explore') {
	const id = normalizeHex64(nodeHash)
	if (!isHex64(id)) return
	const net = loadNetwork()
	const list = tier === 'trusted' ? net.trustedPeers : net.explorePeers
	if (!list.includes(id)) list.push(id)
	saveNetwork(net)
}

/**
 * @param {{ nodeHash: string, source: string, kind: string, weight?: number, expiresAt?: number, ttlMs?: number, groupId?: string }} hint 扩边 hint
 * @returns {void}
 */
export function applyNetworkHint(hint) {
	const nodeHash = normalizeHex64(hint?.nodeHash)
	if (!isHex64(nodeHash)) return
	const net = loadNetwork()
	const now = Date.now()
	const ttlMs = Number.isFinite(hint.ttlMs) ? hint.ttlMs : DEFAULT_EXPLORE_TTL_MS
	const expiresAt = Number.isFinite(hint.expiresAt) ? hint.expiresAt : now + ttlMs
	const source = String(hint.source || 'unknown')
	const priorSources = new Set(net.hints.filter(h => h.nodeHash === nodeHash).map(h => String(h.source || 'unknown')))
	priorSources.add(source)
	const multiSourceBoost = priorSources.size >= 2 ? 1.2 : 1
	const baseWeight = Number.isFinite(hint.weight) ? hint.weight : 0.1
	if (!net.explorePeers.includes(nodeHash))
		net.explorePeers.push(nodeHash)
	net.hints = net.hints.filter(h => h.nodeHash !== nodeHash || h.kind !== hint.kind)
	net.hints.push({
		nodeHash,
		source,
		kind: String(hint.kind || 'hint'),
		weight: baseWeight * multiSourceBoost,
		expiresAt,
		...hint.groupId ? { groupId: String(hint.groupId).trim() } : {},
	})
	saveNetwork(net)
}

/**
 * @param {{ remoteNodeHash?: string }[]} roster Trystero roster
 * @param {string} [groupId] 来源群
 * @param {string} [source='roster'] hint 来源标签
 * @returns {void}
 */
export function recordExplorePeersFromRoster(roster, groupId = '', source = 'roster') {
	if (!roster?.length) return
	const net = loadNetwork()
	const now = Date.now()
	for (const peer of roster) {
		const nodeHash = normalizeHex64(peer?.remoteNodeHash)
		if (!isHex64(nodeHash)) continue
		if (!net.explorePeers.includes(nodeHash))
			net.explorePeers.push(nodeHash)
		net.hints.push({
			nodeHash,
			source: String(source || 'roster'),
			kind: 'roster',
			weight: 0.1,
			expiresAt: now + 24 * 60 * 60 * 1000,
			...groupId ? { groupId: String(groupId).trim() } : {},
		})
	}
	net.hints = capHintsBySource(net.hints).slice(-MAX_HINTS)
	net.lastRosterAt = now
	saveNetwork(net)
}

/**
 * 疑似分区/eclipse 后：用 trusted 锚点加宽 explore，便于恢复联邦可达。
 * @returns {void}
 */
export function widenExploreFromTrustedAnchors() {
	if (!isNodeInitialized()) return
	const net = loadNetwork()
	const now = Date.now()
	for (const raw of net.trustedPeers.slice(0, 12)) {
		const nodeHash = normalizeHex64(raw)
		if (!isHex64(nodeHash)) continue
		if (!net.explorePeers.includes(nodeHash))
			net.explorePeers.push(nodeHash)
		net.hints.push({
			nodeHash,
			source: 'recovery:trusted',
			kind: 'partition_recovery',
			weight: 0.35,
			expiresAt: now + 6 * 60 * 60 * 1000,
		})
	}
	net.hints = capHintsBySource(net.hints).slice(-MAX_HINTS)
	net.explorePeers = net.explorePeers.slice(-MAX_EXPLORE)
	saveNetwork(net)
}

/**
 * 增量合并 trusted/explore 池（不覆盖已有全局池）。
 * @param {{ trustedPeers?: string[], explorePeers?: string[] }} patch 增量
 * @returns {void}
 */
export function mergeNetworkPeerPools(patch = {}) {
	const net = loadNetwork()
	for (const raw of patch.trustedPeers || []) {
		const id = normalizeHex64(raw)
		if (isHex64(id) && !net.trustedPeers.includes(id)) net.trustedPeers.push(id)
	}
	for (const raw of patch.explorePeers || []) {
		const id = normalizeHex64(raw)
		if (isHex64(id) && !net.explorePeers.includes(id)) net.explorePeers.push(id)
	}
	net.lastRosterAt = Date.now()
	saveNetwork(net)
}

/**
 * @param {string[]} nodeHashes trusted 候选
 * @returns {void}
 */
export function mergeTrustedPeers(nodeHashes) {
	mergeNetworkPeerPools({ trustedPeers: nodeHashes })
}

/**
 * 节点级 network + 群 scope denylist 视图（供 peer_pool 选取）。
 * @param {string} [groupId] 群 scope；空则仅全局拉黑
 * @returns {PeerPoolView} 连接池视图
 */
export function loadPeerPoolView(groupId = '') {
	const net = loadNetwork()
	const gid = String(groupId || '').trim()
	const blockedPeers = loadDenylist().blocked
		.filter(entry => !entry.groupId || !gid || entry.groupId === gid)
		.map(entry => entry.value)
	/** @type {Map<string, string>} */
	const hintSources = new Map()
	for (const hint of net.hints) 
		if (!hintSources.has(hint.nodeHash))
			hintSources.set(hint.nodeHash, hint.source)
	
	return {
		trustedPeers: net.trustedPeers,
		explorePeers: net.explorePeers,
		blockedPeers: [...new Set(blockedPeers)],
		lastRosterAt: net.lastRosterAt,
		hintSources,
	}
}

/**
 * @param {PeerPoolView} view 连接池视图
 * @param {string} key nodeHash / pubKeyHash / entityHash
 * @returns {boolean} 是否在 blockedPeers 中
 */
export function isPeerPoolKeyBlocked(view, key) {
	const normalized = String(key || '').trim().toLowerCase()
	return normalized ? view.blockedPeers.includes(normalized) : false
}
