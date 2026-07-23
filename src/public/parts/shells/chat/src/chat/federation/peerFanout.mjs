/**
 * 群联邦稀疏扩号策略（chat 语义）：基于公开的 node/network + reputation，
 * 从 roster 选出 fanout 目标。建链本身由 createGroupLinkSet 负责，此处不碰 transport 内部。
 */
import { loadPeerPoolView, mergeNetworkPeerPools } from 'npm:@steve02081504/fount-p2p/node/network'
import { loadReputation } from 'npm:@steve02081504/fount-p2p/node/reputation_store'
import { clampReputationScore } from 'npm:@steve02081504/fount-p2p/reputation/math'
import { shuffleInPlace } from 'npm:@steve02081504/fount-p2p/utils/shuffle'

/** explore 选取时单 source 上限 */
const EXPLORE_MAX_PER_SOURCE = 3

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
 * trusted 锚点优先保留，再按信誉填充剩余槽位。
 * @param {string[]} existingTrusted 既有 trusted
 * @param {string[]} rankedCandidates 信誉排序候选
 * @param {ReturnType<typeof resolveFederationPoolLimits>} limits 槽位
 * @param {string[]} [blockedPeers] 拉黑列表
 * @returns {string[]} 新 trusted 列表
 */
function mergeTrustedWithAnchors(existingTrusted, rankedCandidates, limits, blockedPeers = []) {
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
function selectExploreWithSourceQuota(exploreIds, exploreSources, k, maxPerSource = EXPLORE_MAX_PER_SOURCE) {
	if (k <= 0 || !exploreIds.length) return []
	if (!exploreSources?.size)
		return shuffleInPlace([...exploreIds]).slice(0, k)
	/** @type {Map<string, string[]>} */
	const bySource = new Map()
	for (const id of exploreIds) {
		const source = exploreSources.get(id) || 'unknown'
		if (!bySource.has(source)) bySource.set(source, [])
		bySource.get(source).push(id)
	}
	for (const ids of bySource.values()) shuffleInPlace(ids)
	const out = []
	/** @type {Map<string, number>} */
	const picked = new Map()
	while (out.length < k) {
		let progressed = false
		for (const [source, ids] of bySource) {
			if (out.length >= k) break
			const index = picked.get(source) ?? 0
			if (index >= maxPerSource || index >= ids.length) continue
			out.push(ids[index])
			picked.set(source, index + 1)
			progressed = true
		}
		if (!progressed) break
	}
	return out
}

/**
 * 稀疏扩号纯选取：Top-K trusted + M explore + 其余按信誉补至 maxPeers。
 * @param {{
 *   roster: Array<{ peerId: string, remoteNodeHash?: string }>,
 *   peers: { trustedPeers: string[], explorePeers: string[], blockedPeers: string[] },
 *   rep: { byNodeHash?: Record<string, { score?: number }> },
 *   limits: ReturnType<typeof resolveFederationPoolLimits>,
 *   selfNodeHash: string,
 *   inRoomNodeHashes?: Set<string> | string[],
 *   hintSources?: Map<string, string>,
 * }} options 选取参数
 * @returns {string[]} 目标 peerId 列表
 */
export function selectPeerIdsFromPool({ roster, peers, rep, limits, selfNodeHash, inRoomNodeHashes, hintSources }) {
	const blocked = new Set(peers.blockedPeers)
	const roomSet = inRoomNodeHashes instanceof Set
		? inRoomNodeHashes
		: new Set(inRoomNodeHashes || [])
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
	for (const nodeId of mergeTrustedWithAnchors(
		anchoredTrusted,
		[...trustedSet].sort((a, b) => repScore(b, rep) - repScore(a, rep)),
		limits,
	)) {
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
 * @param {{
 *   peers: { trustedPeers: string[], explorePeers: string[], blockedPeers: string[] },
 *   rep: { byNodeHash?: Record<string, { score?: number }> },
 *   addIds: Iterable<string>,
 *   limits: ReturnType<typeof resolveFederationPoolLimits>,
 * }} options 池状态与增量
 * @returns {{ trustedPeers: string[], explorePeers: string[] }} 重算后的 trusted/explore
 */
function rebuildExploreAndTrusted(options) {
	const { peers, rep, addIds, limits } = options
	const blocked = new Set(peers.blockedPeers)
	const explore = new Set(peers.explorePeers)
	for (const id of addIds)
		if (id && !blocked.has(id)) explore.add(id)
	const newExplorePeers = [...explore].filter(id => !blocked.has(id)).slice(-500)
	const ranked = [...new Set([...peers.trustedPeers, ...newExplorePeers])]
		.filter(id => !blocked.has(id))
		.sort((a, b) => repScore(b, rep) - repScore(a, rep))
	return {
		trustedPeers: mergeTrustedWithAnchors(peers.trustedPeers, ranked, limits, peers.blockedPeers),
		explorePeers: newExplorePeers,
	}
}

/**
 * 稀疏扩号：优先 trusted，再 explore，再其余在线节点。
 * @param {string} groupId 群
 * @param {{ peerId: string, remoteNodeHash?: string }[]} roster 在线表
 * @param {object} groupSettings 物化群设置
 * @param {string} selfNodeHash 本机 node_id
 * @returns {string[]} 目标 peerId
 */
export function pickFederationTargetPeerIds(groupId, roster, groupSettings, selfNodeHash) {
	const limits = resolveFederationPoolLimits(groupSettings)
	const peers = loadPeerPoolView(groupId)
	const rep = loadReputation()
	return selectPeerIdsFromPool({
		roster,
		peers,
		rep,
		limits,
		selfNodeHash,
		inRoomNodeHashes: roster.map(entry => entry.remoteNodeHash).filter(Boolean),
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
	const { trustedPeers, explorePeers } = rebuildExploreAndTrusted({
		peers, rep, limits,
		addIds: hints || [],
	})
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
	const { trustedPeers, explorePeers } = rebuildExploreAndTrusted({
		peers, rep, limits,
		addIds: roster.map(entry => entry.remoteNodeHash).filter(Boolean),
	})
	mergeNetworkPeerPools({ trustedPeers, explorePeers })
}
