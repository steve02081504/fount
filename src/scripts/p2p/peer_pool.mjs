/**
 * 稀疏连接池纯计算逻辑（§0、§4）：
 * Top-K 信任连接 + M 随机探索，可被 chat shell 与 subfounts 共用。
 * 不含文件 I/O；I/O 层由调用方注入。
 */

import { clampReputationScore } from './reputation.mjs'

/**
 * 解析联邦池槽位参数（从 groupSettings 读取，含低功耗缩减）。
 * @param {object | undefined} groupSettings 群设置
 * @returns {{
 *   trustedSlots: number,
 *   exploreSlots: number,
 *   maxPeers: number,
 *   gossipTtl: number,
 *   wantIdsBudget: number,
 *   batterySaver: boolean,
 * }} 解析后的联邦池参数
 */
export function resolveFederationPoolLimits(groupSettings = {}) {
	const battery = !!groupSettings.batterySaver
	const trustedSlots = battery
		? 2
		: Math.max(1, Math.min(32, Number(groupSettings.trustedPeerSlots) || 8))
	const exploreSlots = battery
		? 1
		: Math.max(0, Math.min(16, Number(groupSettings.explorePeerSlots) || 4))
	const maxPeersRaw = Number(groupSettings.maxPeers)
	const maxPeers = Number.isFinite(maxPeersRaw) && maxPeersRaw > 0
		? Math.min(64, Math.floor(maxPeersRaw))
		: Math.min(64, Math.max(trustedSlots + exploreSlots, 24))
	let trustedOut = trustedSlots
	let exploreOut = exploreSlots
	if (trustedOut + exploreOut > maxPeers) {
		trustedOut = Math.min(trustedOut, maxPeers)
		exploreOut = Math.min(exploreOut, Math.max(0, maxPeers - trustedOut))
	}
	const gossipTtl = Math.max(0, Math.min(8, Number.isFinite(Number(groupSettings.gossipTtl)) ? Number(groupSettings.gossipTtl) : 2))
	const wantIdsBudget = Math.max(4, Math.min(128, Number(groupSettings.wantIdsBudget) || 16))
	return {
		trustedSlots: trustedOut,
		exploreSlots: exploreOut,
		maxPeers,
		gossipTtl,
		wantIdsBudget,
		batterySaver: battery,
	}
}

/**
 * @param {string} nodeId 节点 id
 * @param {{ byNodeHash?: Record<string, { score?: number }> }} rep 信誉表
 * @returns {number} 排序分
 */
function repScore(nodeId, rep) {
	const score = Number(rep.byNodeHash?.[nodeId]?.score ?? 0)
	return clampReputationScore(Number.isFinite(score) ? score : 0)
}

/**
 * 稀疏连接池纯选取：给定在线列表、已持久化 peers 状态与信誉表，
 * 输出按 Top-K trusted + M random explore + 剩余按信誉补至 maxPeers 的 peerId 列表。
 *
 * @param {{
 *   roster: Array<{ peerId: string, remoteNodeHash?: string }>,
 *   peers: { trustedPeers: string[], explorePeers: string[], blockedPeers: string[] },
 *   rep: { byNodeHash?: Record<string, { score?: number }> },
 *   limits: ReturnType<typeof resolveFederationPoolLimits>,
 *   selfNodeHash: string,
 *   inRoomNodeHashes?: Set<string> | string[] 群内在线 node_id；有则优先，仅全不可达时用 explore 中非房内节点
 * }} opts 选取参数（roster、peers、rep、limits、selfNodeHash）
 * @returns {string[]} 目标 Trystero peerId 列表（去重，长度 ≤ maxPeers）
 */
export function selectPeerIdsFromPool({ roster, peers, rep, limits, selfNodeHash, inRoomNodeHashes }) {
	const blocked = new Set(peers.blockedPeers)
	const roomSet = inRoomNodeHashes instanceof Set
		? inRoomNodeHashes
		: new Set(Array.isArray(inRoomNodeHashes) ? inRoomNodeHashes : [])
	const onlineAll = roster.filter(
		rosterEntry => rosterEntry.peerId
			&& rosterEntry.remoteNodeHash
			&& rosterEntry.remoteNodeHash !== selfNodeHash
			&& !blocked.has(rosterEntry.remoteNodeHash),
	)
	const onlineInRoom = roomSet.size
		? onlineAll.filter(rosterEntry => roomSet.has(rosterEntry.remoteNodeHash))
		: onlineAll
	const online = onlineInRoom.length ? onlineInRoom : onlineAll
	if (!online.length) return []

	const peerIdByNodeHash = new Map(online.map(rosterEntry => [rosterEntry.remoteNodeHash, rosterEntry.peerId]))
	const trustedSet = new Set(peers.trustedPeers.filter(nodeHash => peerIdByNodeHash.has(nodeHash)))
	const exploreSet = new Set(peers.explorePeers.filter(nodeHash => peerIdByNodeHash.has(nodeHash) && !trustedSet.has(nodeHash)))

	const outPeerIds = new Set()
	/**
	 * @param {string} nodeHash 远端节点 hash
	 */
	const pushNode = nodeHash => {
		const peerId = peerIdByNodeHash.get(nodeHash)
		if (peerId) outPeerIds.add(peerId)
	}

	const trustedSorted = [...trustedSet].sort((a, b) => repScore(b, rep) - repScore(a, rep))
	for (const nodeId of trustedSorted.slice(0, limits.trustedSlots)) {
		if (outPeerIds.size >= limits.maxPeers) break
		pushNode(nodeId)
	}

	// Fisher-Yates shuffle for uniform random explore selection
	const exploreArray = [...exploreSet]
	for (let index = exploreArray.length - 1; index > 0; index--) {
		const randomIndex = Math.floor(Math.random() * (index + 1))
			;[exploreArray[index], exploreArray[randomIndex]] = [exploreArray[randomIndex], exploreArray[index]]
	}
	for (const nodeId of exploreArray.slice(0, limits.exploreSlots)) {
		if (outPeerIds.size >= limits.maxPeers) break
		pushNode(nodeId)
	}

	const remainingNodeHashes = [...peerIdByNodeHash.keys()]
		.filter(nodeHash => !trustedSet.has(nodeHash) && !exploreSet.has(nodeHash))
		.sort((a, b) => repScore(b, rep) - repScore(a, rep))
	for (const nodeHash of remainingNodeHashes) {
		if (outPeerIds.size >= limits.maxPeers) break
		pushNode(nodeHash)
	}

	return [...outPeerIds].slice(0, limits.maxPeers)
}

/**
 * 将新 PEX 节点线索合并进 explore 池，并按信誉重新填充 trusted 槽。
 * 纯计算版本，不含 I/O：接受 peers 对象，返回新对象。
 *
 * @param {{
 *   peers: { trustedPeers: string[], explorePeers: string[], blockedPeers: string[] },
 *   rep: { byNodeHash?: Record<string, { score?: number }> },
 *   hints: string[],
 *   limits: ReturnType<typeof resolveFederationPoolLimits>,
 * }} opts 合并参数（peers、rep、hints、limits）
 * @returns {{ trustedPeers: string[], explorePeers: string[] }} 更新后的 trusted/explore 列表
 */
export function applyPexHints({ peers, rep, hints, limits }) {
	const ids = [...new Set(
		(Array.isArray(hints) ? hints : [])
			.map(id => String(id).trim())
			.filter(Boolean),
	)]
	const explore = new Set(peers.explorePeers)
	for (const id of ids)
		if (!peers.blockedPeers.includes(id)) explore.add(id)
	const newExplorePeers = [...explore].slice(-500)
	const ranked = [...new Set([...peers.trustedPeers, ...newExplorePeers])]
		.filter(id => !peers.blockedPeers.includes(id))
		.sort((a, b) => repScore(b, rep) - repScore(a, rep))
	return {
		trustedPeers: ranked.slice(0, limits.trustedSlots),
		explorePeers: newExplorePeers,
	}
}

/**
 * 从 roster 观测中更新 explore 池并重新填充 trusted 槽（纯计算版本）。
 *
 * @param {{
 *   peers: { trustedPeers: string[], explorePeers: string[], blockedPeers: string[] },
 *   rep: { byNodeHash?: Record<string, { score?: number }> },
 *   roster: Array<{ remoteNodeHash?: string }>,
 *   limits: ReturnType<typeof resolveFederationPoolLimits>,
 * }} opts roster 更新参数（peers、rep、roster、limits）
 * @returns {{ trustedPeers: string[], explorePeers: string[] }} 更新后的 trusted/explore 列表
 */
export function applyRosterToPeerPool({ peers, rep, roster, limits }) {
	const explore = new Set(peers.explorePeers)
	for (const rosterEntry of roster) {
		const nodeId = rosterEntry.remoteNodeHash?.trim()
		if (nodeId && !peers.blockedPeers.includes(nodeId)) explore.add(nodeId)
	}
	const newExplorePeers = [...explore]
		.filter(id => !peers.blockedPeers.includes(id))
		.slice(-500)
	const candidates = [...new Set([...peers.trustedPeers, ...newExplorePeers])]
		.filter(id => !peers.blockedPeers.includes(id))
		.sort((a, b) => repScore(b, rep) - repScore(a, rep))
	return {
		trustedPeers: candidates.slice(0, limits.trustedSlots),
		explorePeers: newExplorePeers,
	}
}
