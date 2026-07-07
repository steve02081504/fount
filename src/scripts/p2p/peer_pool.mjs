/**
 * 稀疏连接池纯计算逻辑（§0、§4）：
 * Top-K 信任连接 + M 随机探索，可被 chat shell 与 subfounts 共用。
 * 不含文件 I/O；I/O 层由调用方注入。
 */

import { loadPeerPoolView, mergeNetworkPeerPools } from './network.mjs'
import { isQuarantinedPure } from './reputation_engine.mjs'
import { clampReputationScore } from './reputation_math.mjs'
import { loadReputation } from './reputation_store.mjs'

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

/** explore 选取时单 source 上限 */
export const EXPLORE_MAX_PER_SOURCE = 3

/**
 * trusted 锚点优先保留，再按信誉填充剩余槽位。
 * @param {string[]} existingTrusted 既有 trusted
 * @param {string[]} rankedCandidates 信誉排序候选
 * @param {ReturnType<typeof resolveFederationPoolLimits>} limits 槽位
 * @param {string[]} [blockedPeers] 拉黑列表
 * @returns {string[]} 新 trusted 列表
 */
export function mergeTrustedWithAnchors(existingTrusted, rankedCandidates, limits, blockedPeers = []) {
	const blocked = new Set(blockedPeers)
	const candidateSet = new Set(rankedCandidates.filter(id => id && !blocked.has(id)))
	const anchored = existingTrusted.filter(id => id && !blocked.has(id) && candidateSet.has(id))
	const anchoredSet = new Set(anchored)
	const fill = rankedCandidates.filter(id => id && !blocked.has(id) && !anchoredSet.has(id))
	return [...anchored, ...fill].slice(0, limits.trustedSlots)
}

/**
 * 按 source 轮询选取 explore，限制单源占比。
 * @param {string[]} exploreIds 候选 nodeHash
 * @param {Map<string, string> | undefined} exploreSources nodeHash → source
 * @param {number} k 选取数量
 * @param {number} [maxPerSource=EXPLORE_MAX_PER_SOURCE] 每源上限
 * @returns {string[]} 选取结果
 */
export function selectExploreWithSourceQuota(exploreIds, exploreSources, k, maxPerSource = EXPLORE_MAX_PER_SOURCE) {
	if (k <= 0 || !exploreIds.length) return []
	if (!exploreSources?.size) {
		const copy = [...exploreIds]
		for (let i = copy.length - 1; i > 0; i--) {
			const j = Math.floor(Math.random() * (i + 1))
				;[copy[i], copy[j]] = [copy[j], copy[i]]
		}
		return copy.slice(0, k)
	}
	/** @type {Map<string, string[]>} */
	const bySource = new Map()
	for (const id of exploreIds) {
		const src = exploreSources.get(id) || 'unknown'
		if (!bySource.has(src)) bySource.set(src, [])
		bySource.get(src).push(id)
	}
	for (const ids of bySource.values())
		for (let i = ids.length - 1; i > 0; i--) {
			const j = Math.floor(Math.random() * (i + 1))
				;[ids[i], ids[j]] = [ids[j], ids[i]]
		}
	const out = []
	/** @type {Map<string, number>} */
	const picked = new Map()
	while (out.length < k) {
		let progressed = false
		for (const [src, ids] of bySource) {
			if (out.length >= k) break
			const idx = picked.get(src) ?? 0
			if (idx >= maxPerSource || idx >= ids.length) continue
			out.push(ids[idx])
			picked.set(src, idx + 1)
			progressed = true
		}
		if (!progressed) break
	}
	return out
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
 *   hintSources?: Map<string, string> explore 节点来源（用于配额）
 * }} opts 选取参数（roster、peers、rep、limits、selfNodeHash）
 * @returns {string[]} 目标 Trystero peerId 列表（去重，长度 ≤ maxPeers）
 */
export function selectPeerIdsFromPool({ roster, peers, rep, limits, selfNodeHash, inRoomNodeHashes, hintSources }) {
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

	const anchoredTrusted = peers.trustedPeers.filter(nodeHash => trustedSet.has(nodeHash))
	const extraTrusted = [...trustedSet]
		.filter(nodeHash => !anchoredTrusted.includes(nodeHash))
		.sort((a, b) => repScore(b, rep) - repScore(a, rep))
	for (const nodeId of [...anchoredTrusted, ...extraTrusted].slice(0, limits.trustedSlots)) {
		if (outPeerIds.size >= limits.maxPeers) break
		pushNode(nodeId)
	}

	const exploreArray = [...exploreSet]
	for (const nodeId of selectExploreWithSourceQuota(exploreArray, hintSources, limits.exploreSlots)) {
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
 * 从群成员集合选出应主动建链的 nodeHash（top-K 信任 + M 随机 explore + 强制锚点必连）。
 * 与 selectPeerIdsFromPool 不同：候选是"已知成员 nodeHash"（未必在线），输出用于 ensureLinkToNode 的 nodeHash。
 * 这让大群不再全网状 autoconnect，而是每节点只连少数信任节点 + 随机若干条以保图连通。
 *
 * @param {{
 *   members: Iterable<string>,
 *   selfNodeHash: string,
 *   rep: { byNodeHash?: Record<string, { score?: number, quarantinedUntil?: number }> },
 *   peers: { trustedPeers: string[], explorePeers: string[], blockedPeers: string[], hintSources?: Map<string, string> },
 *   limits: ReturnType<typeof resolveFederationPoolLimits>,
 *   anchors?: Iterable<string>,
 * }} opts 选取参数（members、selfNodeHash、rep、peers、limits、anchors）
 * @returns {string[]} 应建链的 nodeHash 列表（去重）
 */
export function selectLinkTargetsFromMembers({ members, selfNodeHash, rep, peers, limits, anchors = [] }) {
	const self = String(selfNodeHash || '')
	const blocked = new Set(peers?.blockedPeers || [])
	const now = Date.now()
	const candidates = [...new Set([...members].map(id => String(id)))]
		.filter(id => id && id !== self && !blocked.has(id) && !isQuarantinedPure(rep, id, now))
	const ranked = candidates.slice().sort((a, b) => repScore(b, rep) - repScore(a, rep))
	const candidateSet = new Set(candidates)
	// 锚点（如 introducer/creator/seed）必连、且不占 trustedSlots——保证引导期连通。
	const forced = [...new Set([...anchors].map(id => String(id)))].filter(id => candidateSet.has(id))
	const chosen = new Set(forced)
	// trusted 槽只从非锚点候选填：既有 trusted 优先保留，再按信誉补至 trustedSlots。
	const nonForced = ranked.filter(id => !chosen.has(id))
	for (const id of mergeTrustedWithAnchors(peers?.trustedPeers || [], nonForced, limits))
		chosen.add(id)
	const remaining = ranked.filter(id => !chosen.has(id))
	for (const id of selectExploreWithSourceQuota(remaining, peers?.hintSources, limits.exploreSlots))
		chosen.add(id)
	return [...chosen]
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
		trustedPeers: mergeTrustedWithAnchors(peers.trustedPeers, ranked, limits, peers.blockedPeers),
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
		trustedPeers: mergeTrustedWithAnchors(peers.trustedPeers, candidates, limits, peers.blockedPeers),
		explorePeers: newExplorePeers,
	}
}

/**
 * 稀疏连接池：优先 trusted，再 explore，再其余在线节点。
 * @param {string} groupId 群
 * @param {{ peerId: string, remoteNodeHash?: string }[]} roster Trystero 在线表
 * @param {object} groupSettings 物化群设置
 * @param {string} selfNodeHash 本机 node_id
 * @returns {string[]} 目标 Trystero peerId（去重）
 */
export function pickFederationTargetPeerIds(groupId, roster, groupSettings, selfNodeHash) {
	const limits = resolveFederationPoolLimits(groupSettings)
	const peers = loadPeerPoolView(groupId)
	const rep = loadReputation()
	const inRoomNodeHashes = roster
		.map(p => p.remoteNodeHash)
		.map(id => String(id).trim())
		.filter(Boolean)
	return selectPeerIdsFromPool({
		roster,
		peers,
		rep,
		limits,
		selfNodeHash,
		inRoomNodeHashes,
		hintSources: peers.hintSources,
	})
}

/**
 * 合并 PEX 提示并提升长期高信誉节点为 trusted。
 * @param {string} groupId 群
 * @param {string[]} hints 节点 id 列表
 * @param {object} groupSettings 群设置
 * @returns {void}
 */
export function mergePexNodeHints(groupId, hints, groupSettings) {
	const limits = resolveFederationPoolLimits(groupSettings)
	const peers = loadPeerPoolView(groupId)
	const rep = loadReputation()
	const { trustedPeers, explorePeers } = applyPexHints({ peers, rep, hints, limits })
	mergeNetworkPeerPools({ trustedPeers, explorePeers })
}

/**
 * roster 观测：将在线节点并入 explore，并按信誉填充 trusted 槽位。
 * @param {string} groupId 群
 * @param {{ remoteNodeHash?: string }[]} roster 在线表
 * @param {object} groupSettings 群设置
 * @returns {void}
 */
export function reconcilePeerPoolFromRoster(groupId, roster, groupSettings) {
	if (!roster.length) return
	const limits = resolveFederationPoolLimits(groupSettings)
	const peers = loadPeerPoolView(groupId)
	const rep = loadReputation()
	const { trustedPeers, explorePeers } = applyRosterToPeerPool({ peers, rep, roster, limits })
	mergeNetworkPeerPools({ trustedPeers, explorePeers })
}
