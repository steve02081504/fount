import { loadData, saveData } from '../../server/setting_loader.mjs'

import { loadBlocklist } from './blocklist.mjs'
import { isHex64, normalizeHex64 } from './hexIds.mjs'
import { invalidateTrustGraphCache } from './trust_graph_cache.mjs'

/**
 * @typedef {{
 *   trustedPeers: string[]
 *   explorePeers: string[]
 *   blockedPeers: string[]
 *   lastRosterAt: number
 * }} PeerPoolView
 */

const DATA_NAME = 'network'
const MAX_EXPLORE = 500
const MAX_HINTS = 256
const DEFAULT_EXPLORE_TTL_MS = 7 * 24 * 60 * 60 * 1000
const NETWORK_SAVE_DEBOUNCE_MS = 300

/** @type {Map<string, ReturnType<typeof setTimeout>>} */
const networkSaveTimers = new Map()

/**
 * 防抖落盘 network.json，避免 roster 高频变动阻塞主线程。
 * @param {string} username replica 登录名
 * @returns {void}
 */
function scheduleNetworkSave(username) {
	if (networkSaveTimers.has(username)) return
	const timer = setTimeout(() => {
		networkSaveTimers.delete(username)
		saveData(username, DATA_NAME)
		invalidateTrustGraphCache(username)
	}, NETWORK_SAVE_DEBOUNCE_MS)
	networkSaveTimers.set(username, timer)
	if (typeof timer.unref === 'function') timer.unref()
}

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
 * @param {string} username replica 登录名
 * @returns {{ trustedPeers: string[], explorePeers: string[], hints: NetworkHint[], lastRosterAt: number }} 用户级 P2P 网络
 */
export function loadNetwork(username) {
	return normalizeNetwork(loadData(username, DATA_NAME))
}

/**
 * @param {string} username replica 登录名
 * @param {ReturnType<typeof normalizeNetwork>} data 网络表
 * @returns {void}
 */
export function saveNetwork(username, data) {
	const clean = normalizeNetwork(data)
	const now = Date.now()
	clean.hints = clean.hints.filter(h => !h.expiresAt || h.expiresAt > now).slice(-MAX_HINTS)
	clean.explorePeers = clean.explorePeers.slice(-MAX_EXPLORE)
	const store = loadData(username, DATA_NAME)
	Object.assign(store, clean)
	scheduleNetworkSave(username)
}

/**
 * @param {string} username replica 登录名
 * @param {string} nodeHash 64 hex
 * @param {'trusted' | 'explore'} tier 池档位
 * @returns {void}
 */
export function addNetworkPeer(username, nodeHash, tier = 'explore') {
	const id = normalizeHex64(nodeHash)
	if (!isHex64(id)) return
	const net = loadNetwork(username)
	const list = tier === 'trusted' ? net.trustedPeers : net.explorePeers
	if (!list.includes(id)) list.push(id)
	saveNetwork(username, net)
}

/**
 * @param {string} username replica 登录名
 * @param {{ nodeHash: string, source: string, kind: string, weight?: number, expiresAt?: number, ttlMs?: number, groupId?: string }} hint 扩边 hint
 * @returns {void}
 */
export function applyNetworkHint(username, hint) {
	const nodeHash = normalizeHex64(hint?.nodeHash)
	if (!isHex64(nodeHash)) return
	const net = loadNetwork(username)
	const now = Date.now()
	const ttlMs = Number.isFinite(hint.ttlMs) ? hint.ttlMs : DEFAULT_EXPLORE_TTL_MS
	const expiresAt = Number.isFinite(hint.expiresAt) ? hint.expiresAt : now + ttlMs
	if (!net.explorePeers.includes(nodeHash))
		net.explorePeers.push(nodeHash)
	net.hints = net.hints.filter(h => h.nodeHash !== nodeHash || h.kind !== hint.kind)
	net.hints.push({
		nodeHash,
		source: String(hint.source || 'unknown'),
		kind: String(hint.kind || 'hint'),
		weight: Number.isFinite(hint.weight) ? hint.weight : 0.1,
		expiresAt,
		...hint.groupId ? { groupId: String(hint.groupId).trim() } : {},
	})
	saveNetwork(username, net)
}

/**
 * @param {string} username replica 登录名
 * @param {{ remoteNodeHash?: string }[]} roster Trystero roster
 * @param {string} [groupId] 来源群
 * @param {string} [source='roster'] hint 来源标签
 * @returns {void}
 */
export function recordExplorePeersFromRoster(username, roster, groupId = '', source = 'roster') {
	if (!roster?.length) return
	const net = loadNetwork(username)
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
	net.hints = net.hints.slice(-MAX_HINTS)
	net.lastRosterAt = now
	saveNetwork(username, net)
}

/**
 * 增量合并 trusted/explore 池（不覆盖已有全局池）。
 * @param {string} username replica 登录名
 * @param {{ trustedPeers?: string[], explorePeers?: string[] }} patch 增量
 * @returns {void}
 */
export function mergeNetworkPeerPools(username, patch = {}) {
	const net = loadNetwork(username)
	for (const raw of patch.trustedPeers || []) {
		const id = normalizeHex64(raw)
		if (isHex64(id) && !net.trustedPeers.includes(id)) net.trustedPeers.push(id)
	}
	for (const raw of patch.explorePeers || []) {
		const id = normalizeHex64(raw)
		if (isHex64(id) && !net.explorePeers.includes(id)) net.explorePeers.push(id)
	}
	net.lastRosterAt = Date.now()
	saveNetwork(username, net)
}

/**
 * @param {string} username replica 登录名
 * @param {string[]} nodeHashes trusted 候选
 * @returns {void}
 */
export function mergeTrustedPeers(username, nodeHashes) {
	mergeNetworkPeerPools(username, { trustedPeers: nodeHashes })
}

/**
 * 用户级 network + 群 scope blocklist 视图（供 peer_pool 选取）。
 * @param {string} username replica 登录名
 * @param {string} [groupId] 群 scope；空则仅全局拉黑
 * @returns {PeerPoolView} 连接池视图
 */
export function loadPeerPoolView(username, groupId = '') {
	const net = loadNetwork(username)
	const gid = String(groupId || '').trim()
	const blockedPeers = loadBlocklist(username).blocked
		.filter(entry => !entry.groupId || !gid || entry.groupId === gid)
		.map(entry => entry.value)
	return {
		trustedPeers: net.trustedPeers,
		explorePeers: net.explorePeers,
		blockedPeers: [...new Set(blockedPeers)],
		lastRosterAt: net.lastRosterAt,
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
