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

/** @type {PeersFile} */
const EMPTY_PEERS = {
	schema: 1,
	trustedPeers: [],
	explorePeers: [],
	blockedPeers: [],
	lastRosterAt: 0,
}

/**
 * @param {unknown} raw 磁盘 JSON
 * @returns {PeersFile} peers 视图（§7.2 / §19）
 */
function normalizePeersFile(raw) {
	if (!raw || typeof raw !== 'object') return { ...EMPTY_PEERS }
	const file = /** @type {Record<string, unknown>} */ raw
	/**
	 * @param {string} key peers 字段名
	 * @returns {string[]} 去重后的 id 列表
	 */
	const pickIds = key => [...new Set(
		(Array.isArray(file[key]) ? file[key] : [])
			.filter(id => typeof id === 'string' && id.trim())
			.map(id => id.trim()),
	)]
	return {
		schema: 1,
		trustedPeers: pickIds('trustedPeers'),
		explorePeers: pickIds('explorePeers'),
		blockedPeers: pickIds('blockedPeers'),
		lastRosterAt: Number.isFinite(file.lastRosterAt) ? file.lastRosterAt : 0,
	}
}

/**
 * 读取群本地 PEX / 连接池线索（不存在则空表）。
 * @param {string} username 用户
 * @param {string} groupId 群
 * @returns {Promise<PeersFile>} 解析后的 peers 文件
 */
export async function loadPeers(username, groupId) {
	try {
		return normalizePeersFile(JSON.parse(await readFile(peersPath(username, groupId), 'utf8')))
	}
	catch {
		return { ...EMPTY_PEERS }
	}
}

/**
 * 写入 peers.json。
 * @param {string} username 用户
 * @param {string} groupId 群
 * @param {PeersFile} data 数据
 * @returns {Promise<void>}
 */
export async function savePeers(username, groupId, data) {
	const path = peersPath(username, groupId)
	await mkdir(dirname(path), { recursive: true })
	await writeFile(path, JSON.stringify({ ...normalizePeersFile(data), lastRosterAt: Date.now() }, null, '\t'), 'utf8')
}

/**
 * 将主体加入本群 `blockedPeers`（踢人/拉黑后拒绝联邦中继，§11.0）。
 * @param {string} username 用户
 * @param {string} groupId 群
 * @param {string} peerKey 节点 id 或成员 pubKeyHash
 * @returns {Promise<void>}
 */
export async function addBlockedPeer(username, groupId, peerKey) {
	const id = String(peerKey).trim()
	if (!id) return
	const peers = await loadPeers(username, groupId)
	if (!peers.blockedPeers.includes(id))
		peers.blockedPeers.push(id)
	await savePeers(username, groupId, peers)
}

/**
 * @param {PeersFile} peers peers.json 内容
 * @param {string} subject 发送方 pubKeyHash 或 remoteNodeId
 * @returns {boolean} 是否已拉黑
 */
export function isSubjectBlocked(peers, subject) {
	const key = String(subject).trim()
	return key ? peers.blockedPeers.includes(key) : false
}

/**
 * 将 Trystero roster 中的 `remoteNodeId` 并入 `explorePeers`（稀疏池探索集，§0、§4）。
 * @param {string} username 用户
 * @param {string} groupId 群
 * @param {{ remoteNodeId?: string }[]} roster 联邦对等端列表
 * @returns {Promise<void>}
 */
export async function recordExplorePeersFromRoster(username, groupId, roster) {
	if (!roster.length) return
	const peers = await loadPeers(username, groupId)
	const exploreIds = new Set(peers.explorePeers)
	for (const peer of roster) {
		const nodeId = peer.remoteNodeId?.trim()
		if (nodeId) exploreIds.add(nodeId)
	}
	peers.explorePeers = [...exploreIds].slice(-500)
	await savePeers(username, groupId, peers)
}
