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

/**
 * @typedef {{
 *   id: string,
 *   kind: 'honest' | 'malicious',
 *   attack?: AttackKind,
 *   clusterId?: string,
 *   introducerId?: string,
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

/**
 * @param {import('./scenarios.mjs').SimScenario} scenario 场景
 * @param {number} seed 种子
 * @param {TunablesBundle} tunables 候选参数
 * @returns {{ nodes: SimNode[], observers: SimObserver[], inviteEdges: Array<{ from: string, to: string }>, ctx: object }} 初始世界状态
 */
export function buildWorld(scenario, seed, tunables) {
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
		nodes.push({ id, kind: 'honest', introducerId: introducer })
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
			trustedPeers: nodes.filter(x => x.kind === 'honest' && x.id !== n.id).slice(0, 4).map(x => x.id),
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
 * @param {import('./scenarios.mjs').SimScenario} scenario 场景
 * @param {number} seed 种子
 * @param {TunablesBundle} tunables 候选参数
 * @returns {import('./metrics.mjs').SimSnapshot} 仿真结束快照
 */
export function runSimulation(scenario, seed, tunables) {
	const rng = createRng(seed)
	const { nodes, observers, inviteEdges, ctx } = buildWorld(scenario, seed, tunables)
	const rounds = scenario.rounds ?? 40
	const groupSize = scenario.groupSize ?? 8
	const malicious = nodes.filter(n => n.kind === 'malicious')
	const honest = nodes.filter(n => n.kind === 'honest')

	for (let round = 0; round < rounds; round++) {
		ctx.now += 60_000
		for (const obs of observers) {
			for (const peer of obs.trustedPeers.slice(0, 2))
				bumpReputationOnRelayPure(obs.reputation, peer, `honest:${round}:${peer}`, ctx.now, tunables.reputation)

			for (const mal of malicious)
				runAttack(ctx, mal, obs, rng, round, tunables)

			if (round % 5 === 0 && malicious.length) {
				const target = pickOne(rng, malicious)
				applyDecayCollusionAfterSlashPure(obs.reputation, target.id, inviteEdges, tunables.reputation)
			}

			for (const h of honest.slice(0, 2))
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
	let malSuppressed = 0
	let malTotal = 0
	let honestSafe = 0
	let honestTotal = 0
	let falsePositive = 0
	let fanoutReach = 0
	let fanoutCost = 0
	let collusionCollapsed = 0
	let collusionTotal = 0
	const nodeKind = new Map(nodes.map(n => [n.id, n]))

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
		fanoutReach += top.filter(n => nodeKind.get(n.nodeHash)?.kind === 'honest').length / Math.max(1, top.length)
		fanoutCost += top.length / tunables.trustGraph.federationFanoutTopK

		for (const m of malicious) {
			malTotal++
			const score = scoreOf(m.id)
			if (score < tunables.social.socialRepHideThreshold || !topSet.has(m.id))
				malSuppressed++
		}

		for (const h of honest) {
			honestTotal++
			const score = scoreOf(h.id)
			if (score >= tunables.social.socialRepHideThreshold && topSet.has(h.id))
				honestSafe++
			if (score < tunables.social.socialRepHideThreshold)
				falsePositive++
		}

		for (const m of malicious.filter(n => n.attack === 'collusion')) {
			collusionTotal++
			const ring = nodes.filter(n => n.attack === 'collusion' && n.clusterId === m.clusterId)
			const avg = ring.reduce((s, n) => s + scoreOf(n.id), 0) / Math.max(1, ring.length)
			if (avg < 0) collusionCollapsed++
		}
	}

	return {
		malSuppressionRate: malTotal ? malSuppressed / malTotal : 1,
		honestPreservationRate: honestTotal ? honestSafe / honestTotal : 1,
		falsePositiveRate: honestTotal ? falsePositive / honestTotal : 0,
		fanoutReachRate: observers.length ? fanoutReach / observers.length : 0,
		fanoutCostRatio: observers.length ? fanoutCost / observers.length : 0,
		collusionCollapseRate: collusionTotal ? collusionCollapsed / collusionTotal : 1,
		observerCount: observers.length,
		maliciousCount: malicious.length,
		honestCount: honest.length,
		groupSize,
	}
}
