import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'

import { peersPath } from './paths.mjs'

/**
 * @typedef {{
 *   schema: number
 *   trustedPeers: string[]
 *   explorePeers: string[]
 *   blockedPeers: string[]
 *   lastRosterAt: number
 * }} PeersFile
 */

/**
 * @param {unknown} raw 磁盘 JSON
 * @returns {PeersFile} 规范化后的 peers 视图（§7.2 / §19）
 */
function normalizePeersFile(raw) {
	const base = {
		schema: 1,
		trustedPeers: [],
		explorePeers: [],
		blockedPeers: [],
		lastRosterAt: 0,
	}
	if (!raw || typeof raw !== 'object') return base
	const o = /** @type {Record<string, unknown>} */ raw
	/**
	 * @param {string} k 字段名
	 * @returns {string[]} 去重后的非空字符串数组
	 */
	const pickStrArr = k => {
		const v = o[k]
		if (!Array.isArray(v)) return []
		return [...new Set(v.filter(x => typeof x === 'string' && x.trim()).map(x => String(x).trim()))]
	}
	return {
		schema: 1,
		trustedPeers: pickStrArr('trustedPeers'),
		explorePeers: pickStrArr('explorePeers'),
		blockedPeers: pickStrArr('blockedPeers'),
		lastRosterAt: typeof o.lastRosterAt === 'number' && Number.isFinite(o.lastRosterAt) ? o.lastRosterAt : 0,
	}
}

/**
 * 读取群本地 PEX / 连接池线索（不存在则空表）。
 * @param {string} username 用户
 * @param {string} groupId 群
 * @returns {Promise<PeersFile>} 解析后的 `peers.json` 内容
 */
export async function loadPeers(username, groupId) {
	const p = peersPath(username, groupId)
	try {
		const text = await readFile(p, 'utf8')
		return normalizePeersFile(JSON.parse(text))
	}
	catch {
		return normalizePeersFile(null)
	}
}

/**
 * 写入 peers.json（原子替换）。
 * @param {string} username 用户
 * @param {string} groupId 群
 * @param {PeersFile} data 数据
 * @returns {Promise<void>}
 */
export async function savePeers(username, groupId, data) {
	const p = peersPath(username, groupId)
	await mkdir(dirname(p), { recursive: true })
	const clean = normalizePeersFile(data)
	clean.lastRosterAt = Date.now()
	await writeFile(p, JSON.stringify(clean, null, '\t'), 'utf8')
}

/**
 * 将主体加入本群 `blockedPeers`（踢人/拉黑后拒绝联邦中继，§11.0）。
 * @param {string} username 用户
 * @param {string} groupId 群
 * @param {string} peerKey 节点 id 或成员 pubKeyHash
 * @returns {Promise<void>}
 */
export async function addBlockedPeer(username, groupId, peerKey) {
	const id = String(peerKey || '').trim()
	if (!id) return
	const cur = await loadPeers(username, groupId)
	if (!cur.blockedPeers.includes(id))
		cur.blockedPeers.push(id)
	await savePeers(username, groupId, cur)
}

/**
 * @param {PeersFile} peers peers.json 内容
 * @param {string} subject 发送方 pubKeyHash 或 remoteNodeId
 * @returns {boolean} 是否已拉黑
 */
export function isSubjectBlocked(peers, subject) {
	const s = String(subject || '').trim()
	if (!s) return false
	return peers.blockedPeers.includes(s)
}

/**
 * 将 Trystero roster 中的 `remoteNodeId` 并入 `explorePeers`（稀疏池探索集，§0、§4）。
 * @param {string} username 用户
 * @param {string} groupId 群
 * @param {{ remoteNodeId?: string }[]} roster 联邦对等端列表
 * @returns {Promise<void>}
 */
export async function recordExplorePeersFromRoster(username, groupId, roster) {
	if (!Array.isArray(roster) || !roster.length) return
	const cur = await loadPeers(username, groupId)
	const ids = new Set(cur.explorePeers)
	for (const p of roster) {
		const id = p && typeof p.remoteNodeId === 'string' ? p.remoteNodeId.trim() : ''
		if (id) ids.add(id)
	}
	const merged = [...ids]
	const cap = 500
	cur.explorePeers = merged.slice(Math.max(0, merged.length - cap))
	await savePeers(username, groupId, cur)
}
