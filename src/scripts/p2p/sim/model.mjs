/**
 * P2P 节点群体模拟回合引擎。
 */
import {
	applyDecayCollusionAfterSlashPure,
	applySubjectiveSlashPure,
	bumpChunkStorageReputationPure,
	bumpReputationOnRelayPure,
	ensureReputationShape,
	penalizeArchiveServeMismatchPure,
	penalizeChunkStorageFailurePure,
	recordGossipAllUnknownWantPure,
	recordMessageRateViolationPure,
	seedMemberReputationFromIntroducerPure,
} from '../reputation_engine.mjs'
import { applyFollowedBlockSignalPure } from '../reputation_social_engine.mjs'
import { pickTop } from '../trust_graph_engine.mjs'

import { runAttack } from './attacks.mjs'
import { createRng, fakeNodeHash, pickOne, randInt } from './rng.mjs'

/** @typedef {import('./attacks.mjs').AttackKind} AttackKind */
/** @typedef {import('./tunables_bundle.mjs').TunablesBundle} TunablesBundle */

/** @typedef {'social_only' | 'chat_only' | 'both' | 'wanderer'} NodeProfile */

/**
 * @typedef {{
 *   id: string,
 *   kind: 'honest' | 'relay' | 'lurker' | 'malicious',
 *   profile?: NodeProfile,
 *   attack?: AttackKind,
 *   clusterId?: string,
 *   introducerId?: string,
 *   whitewashStage?: number,
 * }} SimNode
 */

/**
 * @typedef {{
 *   id: string,
 *   reputation: import('../reputation_store.mjs').ReputationFile,
 *   trustedPeers: string[],
 *   explorePeers: string[],
 * }} SimObserver
 */

/** @type {NodeProfile[]} */
const PROFILE_ORDER = ['both', 'social_only', 'chat_only', 'wanderer']

/**
 * @param {import('./scenarios.mjs').ProfileMix | undefined} mix 画像占比
 * @param {() => number} rng 随机源
 * @returns {NodeProfile} 采样画像
 */
function pickProfile(mix, rng) {
	if (!mix || !Object.keys(mix).length) return 'both'
	const entries = PROFILE_ORDER
		.filter(p => (mix[p] ?? 0) > 0)
		.map(p => [p, mix[p] ?? 0])
	if (!entries.length) return 'both'
	const total = entries.reduce((s, [, w]) => s + w, 0)
	let roll = rng() * total
	for (const [profile, weight] of entries) {
		roll -= weight
		if (roll <= 0) return /** @type {NodeProfile} */ profile
	}
	return /** @type {NodeProfile} */ entries[entries.length - 1][0]
}

/**
 * @param {NodeProfile} profile 节点画像
 * @param {() => number} rng 随机源
 * @param {number} round 回合
 * @returns {'social' | 'chat'} 本回合活跃侧
 */
function activeSide(profile, rng, round) {
	switch (profile) {
		case 'social_only': return 'social'
		case 'chat_only': return 'chat'
		case 'wanderer': return rng() < 0.5 ? 'social' : 'chat'
		default: return round % 2 === 0 ? 'social' : 'chat'
	}
}

/**
 * @param {import('./scenarios.mjs').SimScenario} scenario 场景
 * @param {number} seed 种子
 * @returns {{ nodes: SimNode[], observers: SimObserver[], inviteEdges: Array<{ from: string, to: string }>, ctx: object }} 初始世界状态
 */
export function buildWorld(scenario, seed) {
	const rng = createRng(seed)
	/** @type {SimNode[]} */
	const nodes = []
	/** @type {Array<{ from: string, to: string }>} */
	const inviteEdges = []
	let idx = 1

	for (let i = 0; i < scenario.honestCount; i++) {
		const id = fakeNodeHash(idx++)
		const honestSoFar = nodes.filter(n => n.kind === 'honest')
		const introducer = honestSoFar[randInt(rng, 0, Math.max(1, honestSoFar.length))]?.id
		nodes.push({
			id,
			kind: 'honest',
			profile: pickProfile(scenario.profileMix, rng),
			introducerId: introducer,
		})
		if (introducer)
			inviteEdges.push({ from: introducer, to: id })
	}

	for (let i = 0; i < (scenario.relayCount ?? 0); i++) {
		const id = fakeNodeHash(idx++)
		const introducer = pickOne(rng, nodes.filter(n => n.kind === 'honest'))?.id
		nodes.push({ id, kind: 'relay', introducerId: introducer })
		if (introducer)
			inviteEdges.push({ from: introducer, to: id })
	}

	for (let i = 0; i < (scenario.lurkerCount ?? 0); i++) {
		const id = fakeNodeHash(idx++)
		const introducer = pickOne(rng, nodes.filter(n => n.kind === 'honest'))?.id
		nodes.push({ id, kind: 'lurker', introducerId: introducer })
		if (introducer)
			inviteEdges.push({ from: introducer, to: id })
	}

	for (const [attack, count] of Object.entries(scenario.attacks))
		for (let i = 0; i < (count || 0); i++) {
			const id = fakeNodeHash(idx++)
			const clusterId = `${attack}-${Math.floor(i / 3)}`
			const introducer = pickOne(rng, nodes.filter(n => n.kind === 'honest'))?.id
				|| pickOne(rng, nodes)?.id
			nodes.push({
				id,
				kind: 'malicious',
				attack: /** @type {AttackKind} */ attack,
				clusterId,
				introducerId: introducer,
			})
			if (introducer)
				inviteEdges.push({ from: introducer, to: id })
		}

	const observers = nodes
		.filter(n => n.kind === 'honest')
		.map(n => ({
			id: n.id,
			reputation: ensureReputationShape({ byNodeHash: {}, wantUnknownHits: [], relayBumpSeen: [] }),
			trustedPeers: nodes.filter(x => (x.kind === 'honest' || x.kind === 'relay') && x.id !== n.id).slice(0, 4).map(x => x.id),
			explorePeers: nodes.filter(x => x.id !== n.id).slice(0, 8).map(x => x.id),
		}))

	for (const obs of observers)
		for (const peer of [...obs.trustedPeers, ...obs.explorePeers])
			seedMemberReputationFromIntroducerPure(obs.reputation, peer, obs.id, 0.8)

	/**
	 * @param {SimNode} node Sybil 节点
	 * @returns {SimNode[]} 同簇 Sybil 节点
	 */
	function sybilCluster(node) {
		return nodes.filter(n => n.attack === 'sybil' && n.clusterId === node.clusterId)
	}

	/**
	 * @param {SimNode} node 共谋节点
	 * @returns {SimNode[]} 同环共谋节点
	 */
	function collusionRing(node) {
		return nodes.filter(n => n.attack === 'collusion' && n.clusterId === node.clusterId)
	}

	const ctx = {
		nodes,
		observers,
		inviteEdges,
		now: Date.now(),
		engine: {
			bumpReputationOnRelayPure,
			bumpChunkStorageReputationPure,
			penalizeArchiveServeMismatchPure,
			penalizeChunkStorageFailurePure,
			recordMessageRateViolationPure,
			recordGossipAllUnknownWantPure,
			applySubjectiveSlashPure,
			applyDecayCollusionAfterSlashPure,
			seedMemberReputationFromIntroducerPure,
		},
		socialEngine: { applyFollowedBlockSignalPure },
		sybilCluster,
		collusionRing,
	}

	return { nodes, observers, inviteEdges, ctx }
}

/**
 * @param {object} ctx 仿真上下文
 * @param {SimNode} peer 友善节点
 * @param {SimObserver} observer 观察者
 * @param {'social' | 'chat'} side 活跃侧
 * @param {number} round 回合
 * @param {TunablesBundle} tunables 参数
 * @returns {void}
 */
function runFriendlyBehavior(ctx, peer, observer, side, round, tunables) {
	if (peer.kind === 'relay') {
		bumpReputationOnRelayPure(observer.reputation, peer.id, `relay:${round}:${peer.id}`, ctx.now, tunables.reputation)
		return
	}
	if (peer.kind === 'lurker') {
		if (round % 4 === 0)
			bumpChunkStorageReputationPure(observer.reputation, peer.id, tunables.reputation)
		return
	}
	if (peer.kind !== 'honest' || !peer.profile) return

	if (side === 'social') {
		const other = ctx.nodes.find(n => n.kind === 'honest' && n.id !== peer.id && n.id !== observer.id)
		if (other && round % 6 === 0)
			applyFollowedBlockSignalPure(
				observer.reputation,
				{
					followerNodeHash: peer.id,
					targetNodeHash: other.id,
					voterKey: `${peer.id}entity`,
					action: 'unblock',
					selfTrust: false,
				},
				ctx.now,
				tunables.social,
			)
	}
	else {
		bumpReputationOnRelayPure(observer.reputation, peer.id, `chat:${round}:${peer.id}`, ctx.now, tunables.reputation)
		if (round % 3 === 0)
			bumpChunkStorageReputationPure(observer.reputation, peer.id, tunables.reputation)
	}
}

/**
 * @param {SimObserver} obs 观察者
 * @param {SimNode[]} nodes 全部节点
 * @param {TunablesBundle} tunables 参数
 * @param {(id: string) => number} scoreOf 信誉分
 * @returns {{ reach: number, cost: number }} 可达率与成本比
 */
function simulateMailbox(obs, nodes, tunables, scoreOf) {
	const maxHop = tunables.mailbox.maxHop
	const fanout = tunables.mailbox.relayFanoutTrusted
	const wantFanout = tunables.mailbox.wantFanout
	const friendly = new Set(nodes.filter(n => n.kind === 'honest' || n.kind === 'relay' || n.kind === 'lurker').map(n => n.id))
	const adj = new Map(nodes.map(n => [n.id, []]))
	for (const n of nodes) {
		const peers = nodes
			.filter(x => x.id !== n.id)
			.sort((a, b) => scoreOf(b.id) - scoreOf(a.id))
			.slice(0, fanout)
			.map(x => x.id)
		adj.set(n.id, peers)
	}

	const visited = new Set([obs.id])
	/** @type {string[]} */
	let frontier = [obs.id]
	let hops = 0
	let deliveries = 0
	while (frontier.length && hops < maxHop) {
		/** @type {string[]} */
		const next = []
		for (const id of frontier) {
			const peers = adj.get(id) ?? []
			for (const peer of peers.slice(0, wantFanout)) {
				if (visited.has(peer)) continue
				visited.add(peer)
				next.push(peer)
				if (friendly.has(peer)) deliveries++
			}
		}
		frontier = next
		hops++
	}

	const totalFriendly = Math.max(1, friendly.size - 1)
	return {
		reach: deliveries / totalFriendly,
		cost: visited.size / totalFriendly,
	}
}

/**
 * @param {SimNode[]} nodes 全部节点
 * @param {TunablesBundle} tunables 参数
 * @param {(id: string) => number} scoreOf 信誉分
 * @returns {number} 仲裁正确率 0..1
 */
function simulateArchiveQuorum(nodes, tunables, scoreOf) {
	const submitters = nodes.filter(n =>
		n.kind === 'honest' || n.kind === 'relay' || n.attack === 'archive_forger')
	const ifEmpty = submitters.length ? 0 : 1
	if (!submitters.length) return ifEmpty

	const ranked = [...submitters].sort((a, b) => scoreOf(b.id) - scoreOf(a.id))
	const peerMin = tunables.archive.archiveQuorumPeerMin
	const strictMin = tunables.archive.archiveQuorumPeerStrictMin
	const top = ranked.slice(0, Math.max(peerMin, strictMin, 3))

	let correctVotes = 0
	let wrongVotes = 0
	for (const n of top)
		if (n.attack === 'archive_forger') wrongVotes++
		else correctVotes++

	if (correctVotes >= peerMin && correctVotes >= strictMin) return 1
	if (wrongVotes >= peerMin && wrongVotes > correctVotes) return 0
	return correctVotes / Math.max(1, correctVotes + wrongVotes)
}

/**
 * @param {SimNode} node 节点
 * @param {(id: string) => number} scoreOf 信誉分
 * @param {number} hideThreshold 隐藏阈值
 * @returns {boolean} 信誉是否被保全（仅看分数，不看 fanout 名额）
 */
function isNodePreserved(node, scoreOf, hideThreshold) {
	return scoreOf(node.id) >= hideThreshold
}

/**
 * @param {SimNode} node 节点
 * @param {(id: string) => number} scoreOf 信誉分
 * @param {Set<string>} topSet topK
 * @param {number} hideThreshold 隐藏阈值
 * @returns {boolean} 是否被恶意抑制（低分或未获 fanout 放大）
 */
function isMaliciousSuppressed(node, scoreOf, topSet, hideThreshold) {
	const score = scoreOf(node.id)
	return score < hideThreshold || !topSet.has(node.id)
}

/**
 * @param {import('./scenarios.mjs').SimScenario} scenario 场景
 * @param {number} seed 种子
 * @param {TunablesBundle} tunables 候选参数
 * @returns {import('./metrics.mjs').SimSnapshot} 仿真结束快照
 */
export function runSimulation(scenario, seed, tunables) {
	const rng = createRng(seed)
	const { nodes, observers, inviteEdges, ctx } = buildWorld(scenario, seed)
	const rounds = scenario.rounds ?? 40
	const groupSize = scenario.groupSize ?? 8
	const malicious = nodes.filter(n => n.kind === 'malicious')
	const honest = nodes.filter(n => n.kind === 'honest')
	const friendly = nodes.filter(n => n.kind !== 'malicious')

	for (let round = 0; round < rounds; round++) {
		ctx.now += 60_000
		for (const obs of observers) {
			for (const peer of obs.trustedPeers.slice(0, 2))
				bumpReputationOnRelayPure(obs.reputation, peer, `trusted:${round}:${peer}`, ctx.now, tunables.reputation)

			for (const node of friendly.filter(n => n.id !== obs.id).slice(0, 4)) {
				const profile = node.kind === 'honest' ? node.profile ?? 'both' : 'both'
				const side = activeSide(profile, rng, round)
				runFriendlyBehavior(ctx, node, obs, side, round, tunables)
			}

			for (const mal of malicious)
				runAttack(ctx, mal, obs, rng, round, tunables)

			if (round % 5 === 0 && malicious.length) {
				const target = pickOne(rng, malicious)
				applyDecayCollusionAfterSlashPure(obs.reputation, target.id, inviteEdges, tunables.reputation)
			}

			for (const h of honest.filter(n => activeSide(n.profile ?? 'both', rng, round) === 'chat').slice(0, 2))
				bumpChunkStorageReputationPure(obs.reputation, h.id, tunables.reputation)
		}
	}

	return collectSnapshot(observers, nodes, tunables, groupSize)
}

/**
 * @param {SimObserver[]} observers 诚实观察者
 * @param {SimNode[]} nodes 全部节点
 * @param {TunablesBundle} tunables 候选参数
 * @param {number} groupSize 群规模
 * @returns {import('./metrics.mjs').SimSnapshot} 指标快照
 */
function collectSnapshot(observers, nodes, tunables, groupSize) {
	const malicious = nodes.filter(n => n.kind === 'malicious')
	const honest = nodes.filter(n => n.kind === 'honest')
	const relays = nodes.filter(n => n.kind === 'relay' || n.kind === 'lurker')
	const profiled = honest.filter(n => n.profile && n.profile !== 'both')
	const sybilNodes = malicious.filter(n => n.attack === 'sybil')
	const forgers = malicious.filter(n => n.attack === 'archive_forger')

	let malSuppressed = 0
	let malTotal = 0
	let honestSafe = 0
	let honestTotal = 0
	let falsePositive = 0
	let fanoutReach = 0
	let fanoutCost = 0
	let collusionCollapsed = 0
	let collusionTotal = 0
	let relaySafe = 0
	let relayTotal = 0
	let profileSafe = 0
	let profileTotal = 0
	let sybilContained = 0
	let sybilTotal = 0
	let archiveDefended = 0
	let archiveTotal = 0
	let mailboxReach = 0
	let mailboxCost = 0
	let archiveQuorum = 0
	const nodeKind = new Map(nodes.map(n => [n.id, n]))
	const hideThreshold = tunables.social.socialRepHideThreshold

	for (const obs of observers) {
		/**
		 * @param {string} id 64 hex nodeHash
		 * @returns {number} 观察者主观信誉分
		 */
		function scoreOf(id) {
			return obs.reputation.byNodeHash[id]?.score ?? 0
		}

		const top = pickTop({
			trustedPeers: obs.trustedPeers,
			explorePeers: obs.explorePeers,
			hints: [],
			roomRosters: [{
				scopeId: 'sim-group',
				nodeHashes: nodes.map(n => n.id),
				scoreOf,
			}],
			scoreOf,
		}, tunables.trustGraph.federationFanoutTopK, tunables.trustGraph)

		const topSet = new Set(top.map(n => n.nodeHash))
		// 可达率 = 选中集覆盖的诚实节点 / 全部诚实节点（覆盖广度），与成本天然对立；
		// 旧实现用「选中集纯度」，会让极小 fanout 虚高，掩盖冗余/韧性损失。
		const honestInTop = top.filter(n => nodeKind.get(n.nodeHash)?.kind === 'honest').length
		fanoutReach += honestInTop / Math.max(1, honest.length)
		fanoutCost += top.length / Math.max(1, honest.length)

		for (const m of malicious) {
			malTotal++
			if (isMaliciousSuppressed(m, scoreOf, topSet, hideThreshold))
				malSuppressed++
		}

		for (const h of honest) {
			honestTotal++
			if (isNodePreserved(h, scoreOf, hideThreshold))
				honestSafe++
			if (scoreOf(h.id) < hideThreshold)
				falsePositive++
		}

		for (const r of relays) {
			relayTotal++
			if (isNodePreserved(r, scoreOf, hideThreshold))
				relaySafe++
		}

		for (const p of profiled) {
			profileTotal++
			if (isNodePreserved(p, scoreOf, hideThreshold))
				profileSafe++
		}

		const honestScores = honest.map(h => scoreOf(h.id)).sort((a, b) => a - b)
		const honestMedian = honestScores.length
			? honestScores[Math.floor(honestScores.length / 2)]
			: 0

		const sybilClusters = new Map()
		for (const s of sybilNodes) {
			const key = s.clusterId ?? s.id
			if (!sybilClusters.has(key)) sybilClusters.set(key, [])
			sybilClusters.get(key).push(s)
		}
		for (const cluster of sybilClusters.values()) {
			sybilTotal++
			const maxScore = Math.max(...cluster.map(n => scoreOf(n.id)))
			const anyInTop = cluster.some(n => topSet.has(n.id))
			if (maxScore < honestMedian && !anyInTop) sybilContained++
		}

		for (const f of forgers) {
			archiveTotal++
			if (isMaliciousSuppressed(f, scoreOf, topSet, hideThreshold))
				archiveDefended++
		}

		for (const m of malicious.filter(n => n.attack === 'collusion')) {
			collusionTotal++
			const ring = nodes.filter(n => n.attack === 'collusion' && n.clusterId === m.clusterId)
			const avg = ring.reduce((s, n) => s + scoreOf(n.id), 0) / Math.max(1, ring.length)
			if (avg < 0) collusionCollapsed++
		}

		const mail = simulateMailbox(obs, nodes, tunables, scoreOf)
		mailboxReach += mail.reach
		mailboxCost += mail.cost
		archiveQuorum += simulateArchiveQuorum(nodes, tunables, scoreOf)
	}

	const nObs = Math.max(1, observers.length)

	return {
		malSuppressionRate: malTotal ? malSuppressed / malTotal : 1,
		honestPreservationRate: honestTotal ? honestSafe / honestTotal : 1,
		falsePositiveRate: honestTotal ? falsePositive / honestTotal : 0,
		fanoutReachRate: fanoutReach / nObs,
		fanoutCostRatio: fanoutCost / nObs,
		collusionCollapseRate: collusionTotal ? collusionCollapsed / collusionTotal : 1,
		relayPreservationRate: relayTotal ? relaySafe / relayTotal : 1,
		profilePreservationRate: profileTotal ? profileSafe / profileTotal : 1,
		sybilContainmentRate: sybilTotal ? sybilContained / sybilTotal : 1,
		archiveDefenseRate: archiveTotal ? archiveDefended / archiveTotal : 1,
		mailboxReachRate: mailboxReach / nObs,
		mailboxCostRatio: mailboxCost / nObs,
		archiveQuorumAccuracy: archiveQuorum / nObs,
		observerCount: observers.length,
		maliciousCount: malicious.length,
		honestCount: honest.length,
		groupSize,
	}
}
