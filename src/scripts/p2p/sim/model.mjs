/**
 * P2P 节点群体模拟回合引擎。
 */
import {
	applyDecayCollusionAfterSlashPure,
	applyReputationResetToScoresPure,
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
import { REP_MAX } from '../reputation_math.mjs'
import { applyFollowedBlockSignalPure, applySocialBlockDecayAllPure, applyFollowedSuspectSignalPure } from '../reputation_social_engine.mjs'
import { pickTop } from '../trust_graph_engine.mjs'

import { attackReachesObserver, simIsPeerQuarantined, simObservePeerBehavior } from './anomaly.mjs'
import { normalizeAttackGenome } from './attack_space.mjs'
import { runAttack } from './attacks.mjs'
import { behaviorRoll, isQuietHonestBehavior, sampleBehavior } from './behavior.mjs'
import {
	FEDERATION_SINGLE_PEER_CAP,
	FEDERATION_SINGLE_PEER_SCALE,
	MAILBOX_EXCESS_HOP_PENALTY,
	MAILBOX_FANOUT_COST_SCALE,
	MAILBOX_HOP_COST_EXPONENT,
	MAILBOX_HOP_COST_SCALE,
	MAILBOX_REACH_LOW_HOP_FACTOR,
	MAILBOX_REACH_MID_HOP_FACTOR,
	MAILBOX_RELAY_COST_DIVISOR,
} from './constants.mjs'
import { createDiscoveryState, discoveryReach, initObserverDiscovery } from './discovery.mjs'
import { buildRankedNeighborAdj } from './graph_adj.mjs'
import { createPropagationState, tickPropagation } from './propagation.mjs'
import { createRng, fakeNodeHash, pickMany, pickOne, randInt } from './rng.mjs'

/** @typedef {import('./attacks.mjs').AttackKind} AttackKind */
/** @typedef {import('./tunables_bundle.mjs').TunablesBundle} TunablesBundle */

/** @typedef {import('./behavior.mjs').NodeBehavior} NodeBehavior */

/**
 * @typedef {{
 *   id: string,
 *   kind: 'honest' | 'relay' | 'lurker' | 'malicious',
 *   behavior?: NodeBehavior,
 *   attack?: AttackKind,
 *   clusterId?: string,
 *   introducerId?: string,
 *   whitewashStage?: number,
 *   newcomer?: boolean,
 *   stolenFromId?: string,
 *   sleeperTurnRound?: number,
 *   eclipseTargetId?: string,
 *   compromised?: boolean,
 * }} SimNode
 */

/**
 * @typedef {{
 *   id: string,
 *   reputation: import('../reputation_store.mjs').ReputationFile,
 *   trustedPeers: string[],
 *   explorePeers: string[],
 *   injectedHints: Array<{ nodeHash: string, source: string, weight?: number }>,
 * }} SimObserver
 */

/** @type {import('./behavior.mjs').BehaviorDist} */
const DEFAULT_SCENARIO_BEHAVIOR = {}

/**
 * @param {NodeBehavior} behavior 行为向量
 * @param {() => number} rng 随机源
 * @returns {'social' | 'chat'} 本回合活跃侧
 */
function activeSideFromBehavior(behavior, rng) {
	const socialWeight = behavior.postRate + behavior.likeRate + behavior.replyRate + behavior.mentionRate
	const chatWeight = behavior.relayRate + behavior.chunkServeRate + behavior.archiveSubmitRate
	const total = socialWeight + chatWeight
	if (total <= 0) return rng() < 0.5 ? 'social' : 'chat'
	return rng() < socialWeight / total ? 'social' : 'chat'
}

/**
 * 每回合更新 churn/掉线集合。
 * @param {object} ctx 仿真上下文
 * @param {SimNode[]} nodes 全部节点
 * @param {() => number} rng 随机源
 * @param {import('./scenarios.mjs').SimScenario} scenario 场景
 * @returns {void}
 */
function updateChurnOffline(ctx, nodes, rng, scenario) {
	const churnRate = scenario.churnRate ?? 0
	const offlineRate = scenario.offlineRate ?? 0
	if (!churnRate && !offlineRate) return

	for (const id of [...ctx.offlineSet])
		if (rng() < churnRate * 0.6)
			ctx.offlineSet.delete(id)

	for (const n of nodes) {
		if (n.kind === 'malicious' || n.newcomer) continue
		if (rng() < offlineRate)
			ctx.offlineSet.add(n.id)
	}

	// 定向 eclipse 分区：受害节点强制离线
	if (ctx.eclipseVictims)
		for (const id of ctx.eclipseVictims)
			ctx.offlineSet.add(id)
}

/**
 * 给诚实节点注入瞬时误伤信号（hide 阈值接近 0 时 falsePositive 自然升高）。
 * @param {object} ctx 仿真上下文
 * @param {SimObserver} obs 观察者
 * @param {SimNode[]} activeHonest 活跃诚实节点
 * @param {() => number} rng 随机源
 * @param {TunablesBundle} tunables 参数
 * @returns {void}
 */
function injectTransientFalsePositive(ctx, obs, activeHonest, rng, tunables) {
	if (rng() > 0.12) return
	const victim = pickOne(rng, activeHonest.filter(n => n.id !== obs.id))
	if (!victim) return
	applySubjectiveSlashPure(
		obs.reputation,
		victim.id,
		obs.id,
		tunables.reputation.slashUnverifiedDefaultClaim * 0.25,
		false,
		tunables.reputation,
	)
}

/**
 * @param {import('./scenarios.mjs').SimScenario} scenario 场景
 * @param {number} seed 种子
 * @param {TunablesBundle} tunables 候选参数
 * @param {import('./attack_space.mjs').AttackGenome} [attackGenome] 攻击基因
 * @returns {{ nodes: SimNode[], observers: SimObserver[], inviteEdges: Array<{ from: string, to: string }>, ctx: object }} 初始世界状态
 */
export function buildWorld(scenario, seed, tunables, attackGenome) {
	const rng = createRng(seed)
	const behaviorDist = scenario.behaviorDist ?? DEFAULT_SCENARIO_BEHAVIOR
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
			behavior: sampleBehavior(rng, behaviorDist),
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
		nodes.push({
			id,
			kind: 'lurker',
			behavior: sampleBehavior(rng, { postRate: { mean: 0.05, max: 0.12 }, chunkServeRate: { mean: 0.45, min: 0.2 } }),
			introducerId: introducer,
		})
		if (introducer)
			inviteEdges.push({ from: introducer, to: id })
	}

	// 共谋 / 洗白簇用**链式邀请**：簇首由诚实节点引入，其余成员由同簇上一位引入，
	// 形成深度 ≥3 的邀请链，这样 applyDecayCollusionAfterSlash 的多跳衰减才有意义。
	/** @type {Map<string, string>} */
	const clusterLast = new Map()
	/** @type {SimNode[]} */
	const eclipseTargets = pickMany(
		rng,
		nodes.filter(n => n.kind === 'honest' && !n.compromised),
		scenario.eclipseTargetCount ?? 0,
	)

	for (const [attack, count] of Object.entries(scenario.attacks))
		for (let i = 0; i < (count || 0); i++) {
			const clusterId = `${attack}-${Math.floor(i / 4)}`
			const chained = attack === 'collusion' || attack === 'whitewasher' || attack === 'rep_pump'

			// key_thief：盗用高信誉诚实节点的 nodeHash（同 id 身份）
			if (attack === 'key_thief') {
				const victim = pickOne(rng, nodes.filter(n => n.kind === 'honest' && !n.compromised && !n.newcomer))
				if (!victim) continue
				victim.compromised = true
				nodes.push({
					id: victim.id,
					kind: 'malicious',
					attack: 'key_thief',
					stolenFromId: victim.id,
					introducerId: victim.introducerId,
				})
				continue
			}

			const id = fakeNodeHash(idx++)
			const introducer = chained && clusterLast.has(clusterId)
				? clusterLast.get(clusterId)
				: pickOne(rng, nodes.filter(n => n.kind === 'honest' && !n.compromised))?.id || pickOne(rng, nodes)?.id

			/** @type {SimNode} */
			const malNode = {
				id,
				kind: 'malicious',
				attack: /** @type {AttackKind} */ attack,
				clusterId,
				introducerId: introducer,
			}

			if (attack === 'sleeper')
				malNode.sleeperTurnRound = scenario.sleeperTurnRound ?? 15
			if (attack === 'targeted_eclipse')
				malNode.eclipseTargetId = eclipseTargets[i % Math.max(1, eclipseTargets.length)]?.id

			nodes.push(malNode)
			if (introducer)
				inviteEdges.push({ from: introducer, to: id })
			if (chained)
				clusterLast.set(clusterId, id)
		}

	// 新人节点：诚实、无介绍人、不参与任何回合交互，因此观察者始终对其「没有打过分」，
	// 用来检验 rosterDefaultScore（名册里对陌生人默认信任）这一旋钮的两面性。
	for (let i = 0; i < (scenario.newcomerCount ?? 0); i++)
		nodes.push({ id: fakeNodeHash(idx++), kind: 'honest', behavior: sampleBehavior(rng, behaviorDist), newcomer: true })

	const observers = nodes
		.filter(n => n.kind === 'honest' && !n.newcomer)
		.map(n => ({
			id: n.id,
			reputation: ensureReputationShape({ byNodeHash: {}, wantUnknownHits: [], relayBumpSeen: [] }),
			trustedPeers: nodes.filter(x => (x.kind === 'honest' || x.kind === 'relay') && !x.newcomer && x.id !== n.id).slice(0, 4).map(x => x.id),
			explorePeers: nodes.filter(x => !x.newcomer && x.id !== n.id).slice(0, 8).map(x => x.id),
			injectedHints: [],
		}))

	// 观察者对自己满信任；直信对端从自己按 introducerSeedEdge 继承初始信誉
	// （旧实现里 introducer=观察者自身且其分=0，导致 0.8 边权被乘成 0、整段播种是空操作）。
	for (const obs of observers) {
		obs.reputation.byNodeHash[obs.id] = { score: REP_MAX }
		for (const peer of obs.trustedPeers)
			seedMemberReputationFromIntroducerPure(obs.reputation, peer, obs.id, undefined, tunables.reputation)
	}

	/** @type {Map<string, SimNode[]>} */
	const collusionRingByCluster = new Map()
	for (const n of nodes) {
		if (n.attack !== 'collusion') continue
		const key = n.clusterId ?? n.id
		if (!collusionRingByCluster.has(key)) collusionRingByCluster.set(key, [])
		collusionRingByCluster.get(key).push(n)
	}

	/** @type {Map<string, SimNode[]>} */
	const sybilClusterByCluster = new Map()
	for (const n of nodes) {
		if (n.attack !== 'sybil' && n.attack !== 'rep_pump') continue
		const key = n.clusterId ?? n.id
		if (!sybilClusterByCluster.has(key)) sybilClusterByCluster.set(key, [])
		sybilClusterByCluster.get(key).push(n)
	}

	const honestNodes = nodes.filter(n => n.kind === 'honest')

	/**
	 * @param {SimNode} node Sybil 节点
	 * @returns {SimNode[]} 同簇 Sybil 节点
	 */
	function sybilCluster(node) {
		return sybilClusterByCluster.get(node.clusterId ?? node.id) ?? []
	}

	/**
	 * @param {SimNode} node 共谋节点
	 * @returns {SimNode[]} 同环共谋节点
	 */
	function collusionRing(node) {
		return collusionRingByCluster.get(node.clusterId ?? node.id) ?? []
	}

	const ctx = {
		nodes,
		observers,
		inviteEdges,
		now: Date.now(),
		offlineSet: new Set(),
		eclipseVictims: new Set(),
		equivocationByObserver: new Map(),
		churnReachAccum: 0,
		churnMailboxCostAccum: 0,
		churnReachRounds: 0,
		sleeperTurnRound: scenario.sleeperTurnRound ?? 15,
		scenario,
		attackGenome: normalizeAttackGenome(attackGenome),
		discovery: createDiscoveryState(),
		propagationByObserver: new Map(),
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
		honestNodes,
		sybilCluster,
		collusionRing,
		sybilClusterByCluster,
		collusionRingByCluster,
	}

	const roster = nodes.filter(n => !n.newcomer).map(n => n.id)
	for (const obs of observers) {
		ctx.propagationByObserver.set(obs.id, createPropagationState())
		initObserverDiscovery(ctx.discovery, obs.id, obs.trustedPeers, roster, rng)
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
 * @param {() => number} rng 随机源
 * @returns {void}
 */
function runFriendlyBehavior(ctx, peer, observer, side, round, tunables, rng) {
	if (peer.kind === 'relay') {
		bumpReputationOnRelayPure(observer.reputation, peer.id, `relay:${round}:${peer.id}`, ctx.now, tunables.reputation)
		return
	}
	if (peer.kind === 'lurker') {
		if (peer.behavior && behaviorRoll(rng, peer.behavior, 'chunkServeRate'))
			bumpChunkStorageReputationPure(observer.reputation, peer.id, tunables.reputation)
		return
	}
	if (peer.kind !== 'honest' || !peer.behavior) return

	if (side === 'social') {
		const other = ctx.nodes.find(n => n.kind === 'honest' && n.id !== peer.id && n.id !== observer.id)
		if (other && behaviorRoll(rng, peer.behavior, 'blockProneness'))
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
		if (behaviorRoll(rng, peer.behavior, 'relayRate'))
			bumpReputationOnRelayPure(observer.reputation, peer.id, `chat:${round}:${peer.id}`, ctx.now, tunables.reputation)
		if (behaviorRoll(rng, peer.behavior, 'chunkServeRate'))
			bumpChunkStorageReputationPure(observer.reputation, peer.id, tunables.reputation)
	}
}

/**
 * @param {SimObserver} obs 观察者
 * @param {SimNode[]} nodes 全部节点
 * @param {TunablesBundle} tunables 参数
 * @param {(id: string) => number} scoreOf 信誉分
 * @param {Set<string>} [offlineSet] 当前离线节点
 * @returns {{ reach: number, cost: number }} 可达率与成本比
 */
function simulateMailbox(obs, nodes, tunables, scoreOf, offlineSet = new Set()) {
	const maxHop = tunables.mailbox.maxHop
	const fanout = tunables.mailbox.relayFanoutTrusted
	const wantFanout = tunables.mailbox.wantFanout
	const online = nodes.filter(n => !offlineSet.has(n.id))
	const onlineIds = online.map(n => n.id)
	const friendly = new Set(online.filter(n => n.kind === 'honest' || n.kind === 'relay' || n.kind === 'lurker').map(n => n.id))
	const adj = buildRankedNeighborAdj(onlineIds, id => scoreOf(id), fanout)

	if (offlineSet.has(obs.id))
		return { reach: 0, cost: 0 }

	const visited = new Set([obs.id])
	const reachedFriendly = new Set()
	/** @type {string[]} */
	let frontier = [obs.id]
	let hops = 0
	let relaySteps = 0
	while (frontier.length && hops < maxHop) {
		/** @type {string[]} */
		const next = []
		for (const id of frontier) {
			const peers = adj.get(id) ?? []
			for (const peer of peers.slice(0, wantFanout)) {
				relaySteps++
				if (visited.has(peer)) continue
				visited.add(peer)
				next.push(peer)
				if (friendly.has(peer))
					reachedFriendly.add(peer)
			}
		}
		frontier = next
		hops++
	}

	const totalFriendly = Math.max(1, friendly.size - (friendly.has(obs.id) ? 1 : 0))
	let reach = Math.min(1, reachedFriendly.size / totalFriendly)
	const offlineFraction = offlineSet.size / Math.max(1, nodes.length)
	let minHopsNeeded = maxHop <= 1 ? 2 : 1
	if (offlineFraction > 0.05) {
		minHopsNeeded = Math.max(minHopsNeeded, Math.ceil(1 + offlineFraction * 6))
		if (maxHop < minHopsNeeded)
			reach *= maxHop / minHopsNeeded
	}
	if (maxHop <= 1)
		reach *= MAILBOX_REACH_LOW_HOP_FACTOR
	else if (maxHop === 2)
		reach *= MAILBOX_REACH_MID_HOP_FACTOR
	const hopFactor = hops > 0 ? 1 + MAILBOX_HOP_COST_SCALE * Math.pow(hops / Math.max(1, maxHop), MAILBOX_HOP_COST_EXPONENT) * maxHop : 1
	const fanoutFactor = 1 + MAILBOX_FANOUT_COST_SCALE * Math.max(0, wantFanout - 3)
	const excessHopPenalty = 1 + MAILBOX_EXCESS_HOP_PENALTY * Math.max(0, maxHop - minHopsNeeded - 1)
	const cost = Math.min(3, (visited.size / totalFriendly) * hopFactor * fanoutFactor * excessHopPenalty * (1 + relaySteps / (totalFriendly * MAILBOX_RELAY_COST_DIVISOR)))
	return { reach, cost }
}

/**
 * 归档摘要仲裁正确率，两面建模：
 *   - **安全性**：防御弱时伪造者未被扣分 → 排进 quorum top → 正确票不足 → 准确率下降。
 *   - **活性**：小群里能提交摘要的诚实节点有限（≤ groupSize），strictMin 定得过高就永远
 *     凑不齐 quorum → 准确率随缺口线性下降。
 *   - **单点独裁**：strictMin=1 时高信誉伪造者/等价欺骗者可独断 digest。
 * @param {SimNode[]} nodes 全部节点
 * @param {TunablesBundle} tunables 参数
 * @param {(id: string) => number} scoreOf 信誉分
 * @param {number} groupSize 群规模
 * @param {boolean} [hasEquivocation] 是否存在 digest 等价欺骗
 * @returns {number} 仲裁正确率 0..1
 */
function simulateArchiveQuorum(nodes, tunables, scoreOf, groupSize, hasEquivocation = false) {
	const honestSubmitters = nodes.filter(n => (n.kind === 'honest' && !n.newcomer && !n.compromised) || n.kind === 'relay')
	const forgers = nodes.filter(n => n.attack === 'archive_forger' || n.attack === 'equivocator')
	if (!honestSubmitters.length && !forgers.length) return 1

	const peerMin = tunables.archive.archiveQuorumPeerMin
	const strictMin = Math.max(peerMin, tunables.archive.archiveQuorumPeerStrictMin)

	const reachable = Math.max(2, Math.round(groupSize / 2))
	const availHonest = Math.min(honestSubmitters.length, reachable)
	const availForgers = Math.min(forgers.length, reachable)

	const quorum = [...honestSubmitters.slice(0, availHonest), ...forgers.slice(0, availForgers)]
		.sort((a, b) => scoreOf(b.id) - scoreOf(a.id))
		.slice(0, strictMin)
	const correct = quorum.filter(n => n.attack !== 'archive_forger' && n.attack !== 'equivocator').length

	const liveness = Math.min(1, quorum.length / strictMin)
	const peerOk = Math.min(1, correct / Math.max(1, peerMin))
	let safety = quorum.length ? correct / quorum.length : 1

	const forgerPool = availHonest + availForgers
	const forgerDensity = forgerPool > 0 ? availForgers / forgerPool : 0
	const byzantineNeed = Math.max(2, Math.ceil(strictMin * 0.6))
	const crossVerify = strictMin >= byzantineNeed
		? 1
		: Math.max(0.05, strictMin / byzantineNeed)
	safety *= crossVerify

	if (forgers.length > 0) {
		const unsafeRatio = forgerDensity * (3 / Math.max(1, strictMin))
		safety *= Math.max(0.05, 1 - unsafeRatio)
	}

	// strictMin=1 单点独裁：quorum 仅一人且为伪造者 → 安全性归零
	if (strictMin === 1 && quorum.length === 1) {
		const sole = quorum[0]
		if (sole.attack === 'archive_forger' || sole.attack === 'equivocator')
			safety = 0
	}

	// digest 等价欺骗：strictMin 过低时无法交叉验证
	if (hasEquivocation && strictMin < 2)
		safety *= 0.15
	else if (hasEquivocation && quorum.some(n => n.attack === 'equivocator'))
		safety *= Math.max(0.2, correct / Math.max(1, quorum.length))

	return liveness * peerOk * safety
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
 * @param {number} hideThreshold 隐藏阈值
 * @param {number} honestMedian 诚实节点信誉中位数
 * @returns {boolean} 是否被恶意抑制（仅看主观信誉，与 topK 名额解耦）
 */
function isMaliciousSuppressed(node, scoreOf, hideThreshold, honestMedian) {
	const score = scoreOf(node.id)
	return score < hideThreshold || score < honestMedian
}

/** 理想 mailbox 参考（与候选参数解耦，用于 churn 归一化分母） */
const IDEAL_MAILBOX_REACH = Object.freeze({
	maxHop: 6,
	relayFanoutTrusted: 8,
	wantFanout: 10,
})

/**
 * @param {TunablesBundle} tunables 候选参数
 * @returns {TunablesBundle} 理想可达用的 mailbox 参考
 */
function idealReachTunables(tunables) {
	return {
		...tunables,
		mailbox: { ...tunables.mailbox, ...IDEAL_MAILBOX_REACH },
	}
}

/**
 * 联邦扇出冗余：在线诚实/relay 名额越多，饱和式覆盖越高；K=0 则归零。
 * @param {number} topLiveCount 在线且诚实/relay 的 top 名额数
 * @param {number} honestRelayOnline 在线诚实+relay 总数
 * @param {number} [churnStress=0] churn+offline 强度 0..1
 * @returns {number} 0..1 覆盖度
 */
function federationSaturatingReach(topLiveCount, honestRelayOnline, churnStress = 0) {
	if (topLiveCount <= 0) return 0
	const pSingle = Math.min(FEDERATION_SINGLE_PEER_CAP, FEDERATION_SINGLE_PEER_SCALE / Math.max(1, honestRelayOnline))
	let reach = 1 - (1 - pSingle) ** topLiveCount
	const minSlots = Math.max(2, Math.ceil(1 + churnStress * 10))
	if (topLiveCount < minSlots)
		reach *= topLiveCount / minSlots
	return reach
}

/**
 * @param {import('./scenarios.mjs').SimScenario} scenario 场景
 * @param {number} seed 种子
 * @param {TunablesBundle} tunables 候选参数
 * @param {import('./attack_space.mjs').AttackGenome} [attackGenome] 攻击基因
 * @returns {import('./metrics.mjs').SimSnapshot} 仿真结束快照
 */
export function runSimulation(scenario, seed, tunables, attackGenome) {
	const rng = createRng(seed)
	const { nodes, observers, inviteEdges, ctx } = buildWorld(scenario, seed, tunables, attackGenome)
	const rounds = scenario.rounds ?? 40
	const groupSize = scenario.groupSize ?? 8
	const malicious = nodes.filter(n => n.kind === 'malicious')
	const honest = nodes.filter(n => n.kind === 'honest')
	const activeHonest = honest.filter(n => !n.newcomer)
	const friendly = nodes.filter(n => n.kind !== 'malicious' && !n.newcomer)
	const collusionRing = malicious.filter(n => n.attack === 'collusion')
	const verifiableBad = malicious.filter(n => n.attack === 'archive_forger' || n.attack === 'lazy_chunk')
	const socialConfirmable = malicious.filter(n => n.attack === 'spammer' || n.attack === 'social_mob')

	for (let round = 0; round < rounds; round++) {
		ctx.now += 60_000
		ctx.round = round
		updateChurnOffline(ctx, nodes, rng, scenario)
		const onlineNodes = nodes.filter(n => !ctx.offlineSet.has(n.id))
		const onlineFriendlyIds = onlineNodes
			.filter(n => n.kind === 'honest' || n.kind === 'relay' || n.kind === 'lurker')
			.map(n => n.id)

		for (const obs of observers) {
			for (const peer of obs.trustedPeers.slice(0, 2))
				if (!ctx.offlineSet.has(peer))
					bumpReputationOnRelayPure(obs.reputation, peer, `trusted:${round}:${peer}`, ctx.now, tunables.reputation)

			for (const node of friendly.filter(n => n.id !== obs.id && !ctx.offlineSet.has(n.id))) {
				if (node.behavior && !behaviorRoll(rng, node.behavior, 'onlineStability')) continue
				const side = node.kind === 'honest' && node.behavior
					? activeSideFromBehavior(node.behavior, rng)
					: 'chat'
				runFriendlyBehavior(ctx, node, obs, side, round, tunables, rng)
			}

			for (const mal of malicious) {
				if (ctx.offlineSet.has(mal.id)) continue
				const discReach = discoveryReach(
					ctx.discovery,
					obs.id,
					onlineFriendlyIds,
					id => obs.reputation.byNodeHash[id]?.score ?? 0,
					tunables.mailbox.maxHop,
				)
				if (!attackReachesObserver(discReach, rng)) continue
				runAttack(ctx, mal, obs, rng, round, tunables)
				const turnRound = mal.sleeperTurnRound ?? ctx.sleeperTurnRound ?? 15
				if ((mal.attack === 'sleeper' || mal.attack === 'key_thief') && round >= turnRound)
					simObservePeerBehavior(obs.reputation, mal.id, 1.25, ctx.now, tunables.reputation)
				if (mal.attack === 'social_mob' && round % 5 === 0) {
					const honest = activeHonest.find(n => n.id !== obs.id)
					if (honest)
						applyFollowedSuspectSignalPure(
							obs.reputation,
							{
								followerNodeHash: mal.id,
								targetNodeHash: honest.id,
								voterKey: `${mal.id}entity`,
								action: 'suspect',
								selfTrust: false,
							},
							ctx.now,
							tunables.social,
						)
				}
			}

			if (scenario.keyRecoveryRound != null && round === scenario.keyRecoveryRound) {
				for (const kt of malicious.filter(n => n.attack === 'key_thief'))
					applyReputationResetToScoresPure(obs.reputation, kt.id)
				ctx.keyRecoveryApplied = true
			}

			const propState = ctx.propagationByObserver.get(obs.id)
			if (propState) 
				tickPropagation(propState, round, (target, sender, claim, verified) => {
					applySubjectiveSlashPure(obs.reputation, target, sender, claim, verified, tunables.reputation)
				}, (senderId) => (obs.reputation.byNodeHash[senderId]?.score ?? 0) / REP_MAX, 0.35, rng)
			

			injectTransientFalsePositive(ctx, obs, activeHonest, rng, tunables)

			// 诚实节点的正常 churn 也会偶发「全未知 want」。wantUnknownThreshold 太低时
			// 这些诚实请求会被误判为 eclipse 而扣分（falsePositive），构成阈值的下行压力。
			if (round % 3 === 0)
				for (const h of activeHonest.filter(n => n.id !== obs.id).slice(0, 2))
					recordGossipAllUnknownWantPure(obs.reputation, h.id, ctx.now, tunables.reputation)

			// 可验证审计：对有密码学证据的作恶（伪造归档、惰性分片）发起 verified slash，
			// 让 slashVerifiedMultiplier 真正生效；偶发证据指错诚实节点，形成两面梯度。
			if (round % 4 === 0) {
				for (const bad of verifiableBad)
					applySubjectiveSlashPure(obs.reputation, bad.id, obs.id, tunables.reputation.slashVerifiedDefaultClaim, true, tunables.reputation)
				if (rng() < 0.05) {
					const victim = pickOne(rng, activeHonest.filter(n => n.id !== obs.id))
					if (victim)
						applySubjectiveSlashPure(obs.reputation, victim.id, obs.id, tunables.reputation.slashVerifiedDefaultClaim, true, tunables.reputation)
				}
			}

			// 诚实节点对已确认作恶者的正当 social block——这类惩罚本应长期保留，
			// socialBlockDecayFraction 太高会过快赦免它们（malSuppression 下行压力）。
			if (round % 7 === 0 && socialConfirmable.length) {
				const confirmed = pickOne(rng, socialConfirmable)
				applyFollowedBlockSignalPure(
					obs.reputation,
					{ followerNodeHash: obs.id, targetNodeHash: confirmed.id, voterKey: `${obs.id}entity`, action: 'block', selfTrust: true },
					ctx.now,
					tunables.social,
				)
			}

			if (round % 5 === 0 && malicious.length) {
				// 优先衰减链尾（最深）共谋成员，使多跳 collusionMaxHop 真正被触达。
				const target = collusionRing.length ? collusionRing[collusionRing.length - 1] : pickOne(rng, malicious)
				applyDecayCollusionAfterSlashPure(obs.reputation, target.id, inviteEdges, tunables.reputation)
			}

			for (const h of activeHonest.filter(n => n.behavior && activeSideFromBehavior(n.behavior, rng) === 'chat').slice(0, 2))
				if (!ctx.offlineSet.has(h.id) && behaviorRoll(rng, h.behavior, 'archiveSubmitRate'))
					bumpChunkStorageReputationPure(obs.reputation, h.id, tunables.reputation)

			// 累积 churn 下 mailbox 可达率
			/**
			 * @param {string} id 64 hex nodeHash
			 * @returns {number} 观察者主观信誉分
			 */
			function scoreOfRound(id) {
				return obs.reputation.byNodeHash[id]?.score ?? 0
			}
			const mailRound = simulateMailbox(obs, nodes, tunables, scoreOfRound, ctx.offlineSet)
			ctx.churnReachAccum += mailRound.reach
			ctx.churnMailboxCostAccum += mailRound.cost
			ctx.churnReachRounds++
		}
	}

	// 衰减恢复相：快进若干个 socialBlockDecayMs 窗口并结算 social-block 衰减，
	// 让 socialBlockDecayFraction 对「被误封诚实节点的恢复」与「已确认作恶者的复活」同时生效。
	const decayWindows = scenario.decayWindows ?? 4
	ctx.now += tunables.social.socialBlockDecayMs * decayWindows + 1
	for (const obs of observers)
		applySocialBlockDecayAllPure(obs.reputation, ctx.now, tunables.social)

	return collectSnapshot(observers, nodes, tunables, groupSize, ctx)
}

/**
 * @param {SimObserver[]} observers 诚实观察者
 * @param {SimNode[]} nodes 全部节点
 * @param {TunablesBundle} tunables 候选参数
 * @param {number} groupSize 群规模
 * @param {object} [ctx] 仿真上下文（churn 累积、等价欺骗记录）
 * @returns {import('./metrics.mjs').SimSnapshot} 指标快照
 */
function collectSnapshot(observers, nodes, tunables, groupSize, ctx = {}) {
	const malicious = nodes.filter(n => n.kind === 'malicious')
	const honest = nodes.filter(n => n.kind === 'honest' && !n.compromised)
	const relays = nodes.filter(n => n.kind === 'relay' || n.kind === 'lurker')
	const quietHonest = honest.filter(n => n.behavior && isQuietHonestBehavior(n.behavior))
	const sybilNodes = malicious.filter(n => n.attack === 'sybil' || n.attack === 'rep_pump')
	const forgers = malicious.filter(n => n.attack === 'archive_forger')
	const keyThieves = malicious.filter(n => n.attack === 'key_thief')
	const sleepers = malicious.filter(n => n.attack === 'sleeper')
	const equivocators = malicious.filter(n => n.attack === 'equivocator')
	const offlineSet = ctx.offlineSet ?? new Set()
	const hasEquivocation = equivocators.length > 0 || (ctx.equivocationByObserver?.size ?? 0) > 0

	let malSuppressed = 0
	let malTotal = 0
	let honestSafe = 0
	let honestTotal = 0
	let falsePositive = 0
	let fanoutReach = 0
	let fanoutCost = 0
	let federationReach = 0
	let malAmplification = 0
	let collusionCollapsed = 0
	let collusionTotal = 0
	let relaySafe = 0
	let relayTotal = 0
	let quietSafe = 0
	let quietTotal = 0
	let sybilContained = 0
	let sybilTotal = 0
	let archiveDefended = 0
	let archiveTotal = 0
	let mailboxReach = 0
	let mailboxCost = 0
	let archiveQuorum = 0
	let compromiseContained = 0
	let compromiseTotal = 0
	let sleeperReacted = 0
	let sleeperTotal = 0
	let equivocationDefended = 0
	let equivocationTotal = 0
	/** @type {Map<string, { defended: number, total: number }>} */
	const attackAccum = new Map()
	/** @type {Map<string, { topKSum: number, reachSum: number, count: number }>} */
	const attackImpact = new Map()
	const nodeKind = new Map(nodes.map(n => [n.id, n]))
	const hideThreshold = tunables.social.socialRepHideThreshold
	const onlineNodes = nodes.filter(n => !offlineSet.has(n.id))
	/** @type {Map<string, SimNode[]>} */
	const collusionByCluster = ctx.collusionRingByCluster ?? new Map()
	if (!ctx.collusionRingByCluster) 
		for (const m of malicious) {
			if (m.attack !== 'collusion') continue
			const key = m.clusterId ?? m.id
			if (!collusionByCluster.has(key)) collusionByCluster.set(key, [])
			collusionByCluster.get(key).push(m)
		}
	

	let idealReach = 0

	for (const obs of observers) {
		/**
		 * @param {string} id 64 hex nodeHash
		 * @returns {number} 观察者主观信誉分
		 */
		function scoreOf(id) {
			return obs.reputation.byNodeHash[id]?.score ?? 0
		}

		/**
		 * @param {string} id 64 hex nodeHash
		 * @returns {number | undefined} 已打分则返回分数，从未打分（新人）返回 undefined
		 */
		function rawScoreOf(id) {
			if (offlineSet.has(id)) return undefined
			const s = obs.reputation.byNodeHash[id]?.score
			return Number.isFinite(s) ? s : undefined
		}

		const discoveryHints = honest
			.filter(n => !n.newcomer && n.id !== obs.id && !obs.trustedPeers.includes(n.id) && !offlineSet.has(n.id))
			.slice(0, 2)
			.map(n => ({ nodeHash: n.id, source: 'explore' }))
		const hints = [...discoveryHints, ...obs.injectedHints]

		const top = pickTop({
			trustedPeers: obs.trustedPeers.filter(id => !offlineSet.has(id) && !simIsPeerQuarantined(obs.reputation, id, ctx.now ?? Date.now())),
			explorePeers: obs.explorePeers.filter(id => !offlineSet.has(id) && !simIsPeerQuarantined(obs.reputation, id, ctx.now ?? Date.now())),
			hints,
			roomRosters: [{
				scopeId: 'sim-group',
				nodeHashes: onlineNodes.map(n => n.id),
				scoreOf: rawScoreOf,
			}],
			scoreOf: rawScoreOf,
			quarantinedNodeHashes: new Set(
				Object.keys(obs.reputation.byNodeHash || {}).filter(id => simIsPeerQuarantined(obs.reputation, id, ctx.now ?? Date.now())),
			),
		}, tunables.trustGraph.federationFanoutTopK, tunables.trustGraph)

		const topSet = new Set(top.map(n => n.nodeHash))
		const topLive = top.filter(n => {
			const kind = nodeKind.get(n.nodeHash)
			return !offlineSet.has(n.nodeHash) && (kind?.kind === 'honest' || kind?.kind === 'relay')
		})
		const topMal = top.filter(n => nodeKind.get(n.nodeHash)?.kind === 'malicious')
		const honestRelayOnline = onlineNodes.filter(n => n.kind === 'honest' || n.kind === 'relay').length

		const establishedHonest = honest.filter(h => !h.newcomer)
		const honestScores = establishedHonest.map(h => scoreOf(h.id)).sort((a, b) => a - b)
		const honestMedian = honestScores.length
			? honestScores[Math.floor(honestScores.length / 2)]
			: 0

		const churnStress = (ctx.scenario?.churnRate ?? 0) + (ctx.scenario?.offlineRate ?? 0)

		const fedReach = federationSaturatingReach(topLive.length, honestRelayOnline, churnStress)
		federationReach += fedReach
		fanoutReach += topLive.length / Math.max(1, honestRelayOnline)
		fanoutCost += top.length / Math.max(1, honest.length)

		const friendlyIds = onlineNodes.filter(n => n.kind === 'honest' || n.kind === 'relay' || n.kind === 'lurker').map(n => n.id)
		const discReach = discoveryReach(ctx.discovery, obs.id, friendlyIds, scoreOf, tunables.mailbox.maxHop)

		const highRepMalInTop = topMal.filter(n => scoreOf(n.nodeHash) >= honestMedian).length
		if (top.length > 0)
			malAmplification += highRepMalInTop / top.length

		for (const m of malicious) {
			malTotal++
			const suppressed = isMaliciousSuppressed(m, scoreOf, hideThreshold, honestMedian)
			if (suppressed) malSuppressed++
			const atk = m.attack
			if (atk) {
				let row = attackAccum.get(atk)
				if (!row) {
					row = { defended: 0, total: 0 }
					attackAccum.set(atk, row)
				}
				row.total++
				if (suppressed) row.defended++

				let impact = attackImpact.get(atk)
				if (!impact) {
					impact = { topKSum: 0, reachSum: 0, count: 0 }
					attackImpact.set(atk, impact)
				}
				impact.count++
				if (topSet.has(m.id) && scoreOf(m.id) >= honestMedian)
					impact.topKSum++
				impact.reachSum += discReach
			}
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

		for (const q of quietHonest) {
			quietTotal++
			if (isNodePreserved(q, scoreOf, hideThreshold))
				quietSafe++
		}

		const sybilClusters = new Map()
		for (const s of sybilNodes) {
			const key = s.clusterId ?? s.id
			if (!sybilClusters.has(key)) sybilClusters.set(key, [])
			sybilClusters.get(key).push(s)
		}
		for (const cluster of sybilClusters.values()) {
			sybilTotal++
			const maxScore = Math.max(...cluster.map(n => scoreOf(n.id)))
			const pumpedInTop = cluster.some(n => topSet.has(n.id) && scoreOf(n.id) >= honestMedian)
			if (maxScore < honestMedian && !pumpedInTop) sybilContained++
		}

		for (const f of forgers) {
			archiveTotal++
			if (isMaliciousSuppressed(f, scoreOf, hideThreshold, honestMedian))
				archiveDefended++
		}

		for (const kt of keyThieves) {
			compromiseTotal++
			if (isMaliciousSuppressed(kt, scoreOf, hideThreshold, honestMedian))
				compromiseContained++
		}

		for (const sl of sleepers) {
			const turnRound = sl.sleeperTurnRound ?? ctx.sleeperTurnRound ?? 15
			if ((ctx.scenario?.rounds ?? 40) > turnRound) {
				sleeperTotal++
				if (isMaliciousSuppressed(sl, scoreOf, hideThreshold, honestMedian))
					sleeperReacted++
			}
		}

		for (const eq of equivocators) {
			equivocationTotal++
			if (isMaliciousSuppressed(eq, scoreOf, hideThreshold, honestMedian))
				equivocationDefended++
		}

		for (const m of malicious.filter(n => n.attack === 'collusion')) {
			collusionTotal++
			const ring = collusionByCluster.get(m.clusterId ?? m.id) ?? [m]
			const avg = ring.reduce((s, n) => s + scoreOf(n.id), 0) / Math.max(1, ring.length)
			if (avg < 0) collusionCollapsed++
		}

		const mail = simulateMailbox(obs, nodes, tunables, scoreOf, offlineSet)
		mailboxReach += mail.reach
		mailboxCost += mail.cost
		idealReach += simulateMailbox(obs, nodes, idealReachTunables(tunables), scoreOf, new Set()).reach
		archiveQuorum += simulateArchiveQuorum(nodes, tunables, scoreOf, groupSize, hasEquivocation)
	}

	const nObs = Math.max(1, observers.length)

	// churn 可达率：回合内累积的 mailbox reach 均值；无 churn 时退化为 mailboxReachRate
	const churnReachRate = ctx.churnReachRounds
		? ctx.churnReachAccum / ctx.churnReachRounds
		: mailboxReach / nObs

	const idealReachRate = idealReach / nObs
	const normalizedChurnReach = idealReachRate > 0
		? Math.min(1, churnReachRate / idealReachRate)
		: churnReachRate

	const malAmpAvg = malAmplification / nObs
	const rawMalSuppression = malTotal ? malSuppressed / malTotal : 1
	const vMult = tunables.reputation.slashVerifiedMultiplier
	const verifiedSlashScale = 0.35 + 0.65 * Math.min(1, vMult / 0.35)
	const malSuppressionRate = Math.max(0, rawMalSuppression * (1 - malAmpAvg * 0.85) * verifiedSlashScale)
	const mailboxCostAvg = ctx.churnReachRounds
		? ctx.churnMailboxCostAccum / ctx.churnReachRounds
		: mailboxCost / nObs

	/** @type {NonNullable<import('./metrics.mjs').SimSnapshot['byAttackDefense']>} */
	const byAttackDefense = {}
	for (const [atk, row] of attackAccum)
		byAttackDefense[atk] = { ...row, rate: row.total ? row.defended / row.total : 1 }

	/** @type {NonNullable<import('./metrics.mjs').SimSnapshot['byAttackImpact']>} */
	const byAttackImpact = {}
	for (const [atk, row] of attackImpact) {
		const n = Math.max(1, row.count)
		byAttackImpact[atk] = {
			topKCapture: row.topKSum / n,
			reachCollapse: 1 - row.reachSum / n,
		}
	}

	const quietHonestPreservationRate = quietTotal ? quietSafe / quietTotal : 1

	return {
		malSuppressionRate,
		honestPreservationRate: honestTotal ? honestSafe / honestTotal : 1,
		falsePositiveRate: honestTotal ? falsePositive / honestTotal : 0,
		fanoutReachRate: fanoutReach / nObs,
		federationReachRate: federationReach / nObs,
		fanoutCostRatio: fanoutCost / nObs,
		collusionCollapseRate: collusionTotal ? collusionCollapsed / collusionTotal : 1,
		relayPreservationRate: relayTotal ? relaySafe / relayTotal : 1,
		profilePreservationRate: quietHonestPreservationRate,
		quietHonestPreservationRate,
		sybilContainmentRate: sybilTotal ? sybilContained / sybilTotal : 1,
		archiveDefenseRate: archiveTotal ? archiveDefended / archiveTotal : 1,
		mailboxReachRate: mailboxReach / nObs,
		mailboxCostRatio: mailboxCostAvg,
		archiveQuorumAccuracy: archiveQuorum / nObs,
		churnReachRate: normalizedChurnReach,
		compromiseContainmentRate: compromiseTotal ? compromiseContained / compromiseTotal : 1,
		sleeperReactionRate: sleeperTotal ? sleeperReacted / sleeperTotal : 1,
		equivocationDefenseRate: equivocationTotal
			? equivocationDefended / equivocationTotal
			: hasEquivocation ? archiveQuorum / nObs : 1,
		observerCount: observers.length,
		maliciousCount: malicious.length,
		honestCount: honest.length,
		groupSize,
		byAttackDefense,
		byAttackImpact,
	}
}
