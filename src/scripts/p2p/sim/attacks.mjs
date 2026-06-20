/**
 * 恶意节点行为原型。
 */
import { resolveAttackParams } from './attack_space.mjs'
import { SYBIL_REP_EARN_COST_ROUNDS } from './constants.mjs'
import { eclipseFillExplore } from './discovery.mjs'
import { enqueueSlash } from './propagation.mjs'

/** @typedef {'sybil' | 'collusion' | 'spammer' | 'false_accuser' | 'eclipse' | 'lazy_chunk' | 'social_mob' | 'archive_forger' | 'relay_farmer' | 'whitewasher' | 'report_flooder' | 'oscillator' | 'hint_poisoner' | 'key_thief' | 'sleeper' | 'equivocator' | 'targeted_eclipse' | 'rep_pump' | 'slow_drip_spammer'} AttackKind */

/**
 * @param {object} ctx 仿真上下文
 * @param {import('./model.mjs').SimNode} node 恶意节点
 * @returns {ReturnType<typeof resolveAttackParams>} 有效攻击参数
 */
function attackParams(ctx, node) {
	return resolveAttackParams(node.attack ?? 'sybil', ctx.attackGenome)
}

/**
 * @param {object} ctx 仿真上下文
 * @param {import('./model.mjs').SimObserver} observer 观察者
 * @param {string} targetId 目标
 * @param {string} senderId 发送者
 * @param {number} claim 索赔
 * @param {boolean} verified 是否已验证
 * @param {number} round 回合
 * @param {import('./tunables_bundle.mjs').TunablesBundle} tunables 参数
 * @returns {void}
 */
function queueSlash(ctx, observer, targetId, senderId, claim, verified, round, tunables) {
	const state = ctx.propagationByObserver?.get(observer.id)
	if (state) {
		enqueueSlash(state, { targetId, senderId, claim, verified, birthRound: round, spread: 0 })
		return
	}
	ctx.engine.applySubjectiveSlashPure(observer.reputation, targetId, senderId, claim, verified, tunables.reputation)
}

/**
 * 第一人称：观察者仅因**直接观测到**该 peer 的中继行为而加分。
 * @param {object} ctx 仿真上下文
 * @param {import('./model.mjs').SimNode} node 被观测 peer
 * @param {import('./model.mjs').SimObserver} observer 观察者
 * @param {() => number} rng 随机源
 * @param {number} rate 触发概率
 * @param {string} dedupeKey 去重键
 * @param {import('./tunables_bundle.mjs').TunablesBundle} tunables 参数
 * @returns {void}
 */
function observeSelfRelayBump(ctx, node, observer, rng, rate, dedupeKey, tunables) {
	if (rng() >= rate) return
	ctx.engine.bumpReputationOnRelayPure(
		observer.reputation,
		node.id,
		dedupeKey,
		ctx.now,
		tunables.reputation,
	)
}

/**
 * 同伙互吹：经 hint 发现通道间接抬分，收益随 sender 主观信誉折扣（低信誉 sender 的 hint 几乎无效）。
 * @param {object} ctx 仿真上下文
 * @param {import('./model.mjs').SimObserver} observer 观察者
 * @param {string} allyId 被抬分目标
 * @param {string} senderId 声称来源
 * @param {number} weightMul 相对 hintDefaultWeight 的倍数
 * @param {import('./tunables_bundle.mjs').TunablesBundle} tunables 参数
 * @returns {void}
 */
function injectAllyHint(ctx, observer, allyId, senderId, weightMul, tunables) {
	const senderRep = observer.reputation.byNodeHash[senderId]?.score ?? 0
	const senderTrust = Math.max(0.05, (senderRep + 1) / 2)
	const weight = tunables.trustGraph.hintDefaultWeight * weightMul * senderTrust * 0.35
	const existing = observer.injectedHints.find(h => h.nodeHash === allyId && h.source === `ally:${senderId}`)
	if (existing)
		existing.weight = (existing.weight ?? weight) + weight
	else
		observer.injectedHints.push({ nodeHash: allyId, source: `ally:${senderId}`, weight })
}

/**
 * @param {object} ctx 仿真上下文
 * @param {import('./model.mjs').SimNode} node 恶意节点
 * @param {import('./model.mjs').SimObserver} observer 诚实观察者
 * @param {() => number} rng 随机源
 * @param {number} round 当前回合
 * @param {import('./tunables_bundle.mjs').TunablesBundle} tunables 候选参数
 * @returns {void}
 */
export function runAttack(ctx, node, observer, rng, round, tunables) {
	switch (node.attack) {
		case 'sybil':
			runSybil(ctx, node, observer, rng, tunables)
			break
		case 'collusion':
			runCollusion(ctx, node, observer, rng, round, tunables)
			break
		case 'spammer':
			runSpammer(ctx, node, observer, tunables)
			break
		case 'false_accuser':
			runFalseAccuser(ctx, node, observer, rng, round, tunables)
			break
		case 'eclipse':
			runEclipse(ctx, node, observer, rng, round, tunables)
			break
		case 'lazy_chunk':
			runLazyChunk(ctx, node, observer, tunables)
			break
		case 'social_mob':
			runSocialMob(ctx, node, observer, rng, tunables)
			break
		case 'archive_forger':
			runArchiveForger(ctx, node, observer, tunables)
			break
		case 'relay_farmer':
			runRelayFarmer(ctx, node, observer, round, tunables)
			break
		case 'whitewasher':
			runWhitewasher(ctx, node, observer, rng, round, tunables)
			break
		case 'report_flooder':
			runReportFlooder(ctx, node, observer, rng, round, tunables)
			break
		case 'oscillator':
			runOscillator(ctx, node, observer, round, tunables)
			break
		case 'hint_poisoner':
			runHintPoisoner(ctx, node, observer, tunables)
			break
		case 'key_thief':
			runKeyThief(ctx, node, observer, rng, round, tunables)
			break
		case 'sleeper':
			runSleeper(ctx, node, observer, rng, round, tunables)
			break
		case 'equivocator':
			runEquivocator(ctx, node, observer, tunables)
			break
		case 'targeted_eclipse':
			runTargetedEclipse(ctx, node, observer, rng, round, tunables)
			break
		case 'rep_pump':
			runRepPump(ctx, node, observer, rng, round, tunables)
			break
		case 'slow_drip_spammer':
			runSlowDripSpammer(ctx, node, observer, tunables)
			break
		default:
			break
	}
}

/**
 * @param {object} ctx 仿真上下文
 * @param {import('./model.mjs').SimNode} node 恶意节点
 * @param {import('./model.mjs').SimObserver} observer 诚实观察者
 * @param {() => number} rng 随机源
 * @param {import('./tunables_bundle.mjs').TunablesBundle} tunables 候选参数
 * @returns {void}
 */
function runSybil(ctx, node, observer, rng, tunables) {
	if ((ctx.round ?? 0) < SYBIL_REP_EARN_COST_ROUNDS) return
	const p = attackParams(ctx, node)
	observeSelfRelayBump(ctx, node, observer, rng, p.activationRate, `sybil:${node.id}`, tunables)
	for (const sybil of ctx.sybilCluster(node))
		if (sybil.id !== node.id && rng() < p.activationRate * p.collusionAllyRate)
			injectAllyHint(ctx, observer, sybil.id, node.id, 0.58, tunables)
}

/**
 * @param {object} ctx 仿真上下文
 * @param {import('./model.mjs').SimNode} node 恶意节点
 * @param {import('./model.mjs').SimObserver} observer 诚实观察者
 * @param {() => number} rng 随机源
 * @param {number} round 当前回合
 * @param {import('./tunables_bundle.mjs').TunablesBundle} tunables 候选参数
 * @returns {void}
 */
function runCollusion(ctx, node, observer, rng, round, tunables) {
	const p = attackParams(ctx, node)
	observeSelfRelayBump(ctx, node, observer, rng, p.activationRate, `collusion:${round}:${node.id}`, tunables)
	const ring = ctx.collusionRing(node)
	for (const ally of ring)
		if (ally.id !== node.id && rng() < p.collusionAllyRate)
			injectAllyHint(ctx, observer, ally.id, node.id, p.collusionAllyRate, tunables)
	const victim = ring.find(n => n.id !== node.id)
	if (victim && rng() < p.activationRate * 0.4)
		queueSlash(ctx, observer, victim.id, node.id, tunables.reputation.slashUnverifiedDefaultClaim, false, round, tunables)
}

/**
 * @param {object} ctx 仿真上下文
 * @param {import('./model.mjs').SimNode} node 恶意节点
 * @param {import('./model.mjs').SimObserver} observer 诚实观察者
 * @param {import('./tunables_bundle.mjs').TunablesBundle} tunables 候选参数
 * @returns {void}
 */
function runSpammer(ctx, node, observer, tunables) {
	const { recordMessageRateViolationPure } = ctx.engine
	const burst = attackParams(ctx, node).burstSize
	for (let i = 0; i < burst; i++)
		recordMessageRateViolationPure(observer.reputation, node.id, tunables.reputation)
}

/**
 * @param {object} ctx 仿真上下文
 * @param {import('./model.mjs').SimNode} node 恶意节点
 * @param {import('./model.mjs').SimObserver} observer 诚实观察者
 * @param {() => number} rng 随机源
 * @param {number} round 当前回合
 * @param {import('./tunables_bundle.mjs').TunablesBundle} tunables 候选参数
 * @returns {void}
 */
function runFalseAccuser(ctx, node, observer, rng, round, tunables) {
	const honest = pickHonestTarget(ctx, observer, rng, attackParams(ctx, node).targetBiasHighRep)
	if (!honest) return
	queueSlash(
		ctx,
		observer,
		honest.id,
		node.id,
		tunables.reputation.slashUnverifiedDefaultClaim * 2,
		false,
		round,
		tunables,
	)
}

/**
 * @param {object} ctx 仿真上下文
 * @param {import('./model.mjs').SimNode} node 恶意节点
 * @param {import('./model.mjs').SimObserver} observer 诚实观察者
 * @param {() => number} rng 随机源
 * @param {number} round 当前回合
 * @param {import('./tunables_bundle.mjs').TunablesBundle} tunables 候选参数
 * @returns {void}
 */
function runEclipse(ctx, node, observer, rng, round, tunables) {
	const { recordGossipAllUnknownWantPure } = ctx.engine
	const p = attackParams(ctx, node)
	for (let i = 0; i < p.burstSize; i++)
		recordGossipAllUnknownWantPure(observer.reputation, node.id, ctx.now + i, tunables.reputation)
	const sybilIds = ctx.sybilCluster(node).map(n => n.id)
	eclipseFillExplore(ctx.discovery, observer.id, node.id, sybilIds, p.eclipseFocus)
}

/**
 * @param {object} ctx 仿真上下文
 * @param {import('./model.mjs').SimNode} node 恶意节点
 * @param {import('./model.mjs').SimObserver} observer 诚实观察者
 * @param {import('./tunables_bundle.mjs').TunablesBundle} tunables 候选参数
 * @returns {void}
 */
function runLazyChunk(ctx, node, observer, tunables) {
	const { penalizeChunkStorageFailurePure } = ctx.engine
	penalizeChunkStorageFailurePure(observer.reputation, node.id, tunables.reputation)
}

/**
 * @param {object} ctx 仿真上下文
 * @param {import('./model.mjs').SimNode} node 恶意节点
 * @param {import('./model.mjs').SimObserver} observer 诚实观察者
 * @param {() => number} rng 随机源
 * @param {import('./tunables_bundle.mjs').TunablesBundle} tunables 候选参数
 * @returns {void}
 */
function runSocialMob(ctx, node, observer, rng, tunables) {
	const { applyFollowedBlockSignalPure } = ctx.socialEngine
	const honest = pickHonestTarget(ctx, observer, rng)
	if (!honest) return
	applyFollowedBlockSignalPure(
		observer.reputation,
		{
			followerNodeHash: node.id,
			targetNodeHash: honest.id,
			voterKey: `${node.id}entity`,
			action: 'block',
			selfTrust: false,
		},
		ctx.now,
		tunables.social,
	)
}

/**
 * @param {object} ctx 仿真上下文
 * @param {import('./model.mjs').SimNode} node 恶意节点
 * @param {import('./model.mjs').SimObserver} observer 诚实观察者
 * @param {import('./tunables_bundle.mjs').TunablesBundle} tunables 候选参数
 * @returns {void}
 */
function runArchiveForger(ctx, node, observer, tunables) {
	const { penalizeArchiveServeMismatchPure } = ctx.engine
	penalizeArchiveServeMismatchPure(observer.reputation, node.id, tunables.reputation)
}

/**
 * @param {object} ctx 仿真上下文
 * @param {import('./model.mjs').SimNode} node 恶意节点
 * @param {import('./model.mjs').SimObserver} observer 诚实观察者
 * @param {number} round 当前回合
 * @param {import('./tunables_bundle.mjs').TunablesBundle} tunables 候选参数
 * @returns {void}
 */
function runRelayFarmer(ctx, node, observer, round, tunables) {
	const { bumpReputationOnRelayPure } = ctx.engine
	const burst = attackParams(ctx, node).burstSize
	for (let i = 0; i < burst; i++)
		bumpReputationOnRelayPure(observer.reputation, node.id, `relay-farm:${round}:${i}`, ctx.now + i, tunables.reputation)
}

/**
 * @param {object} ctx 仿真上下文
 * @param {import('./model.mjs').SimNode} node 恶意节点
 * @param {import('./model.mjs').SimObserver} observer 诚实观察者
 * @param {() => number} rng 随机源
 * @param {number} round 当前回合
 * @param {import('./tunables_bundle.mjs').TunablesBundle} tunables 候选参数
 * @returns {void}
 */
function runWhitewasher(ctx, node, observer, rng, round, tunables) {
	const { applySubjectiveSlashPure, seedMemberReputationFromIntroducerPure } = ctx.engine
	const stage = node.whitewashStage ?? 0
	if (stage === 0 && round >= 4) {
		applySubjectiveSlashPure(
			observer.reputation,
			node.id,
			observer.id,
			tunables.reputation.slashUnverifiedDefaultClaim,
			false,
			tunables.reputation,
		)
		node.whitewashStage = 1
	}
	else if (stage === 1 && round % 7 === 0) {
		const intro = pickHonestTarget(ctx, observer, rng)
		if (intro) {
			// 用 tunable introducerSeedEdge（不再写死 0.6）：边权越低，洗白者重新入场时
			// 从诚实介绍者继承的信誉越少，越难「洗白复活」。
			delete observer.reputation.byNodeHash[node.id]
			seedMemberReputationFromIntroducerPure(observer.reputation, node.id, intro.id, undefined, tunables.reputation)
			node.whitewashStage = 2
		}
	}
}

/**
 * @param {object} ctx 仿真上下文
 * @param {import('./model.mjs').SimNode} node 恶意节点
 * @param {import('./model.mjs').SimObserver} observer 诚实观察者
 * @param {() => number} rng 随机源
 * @param {number} round 当前回合
 * @param {import('./tunables_bundle.mjs').TunablesBundle} tunables 候选参数
 * @returns {void}
 */
function runReportFlooder(ctx, node, observer, rng, round, tunables) {
	const targets = ctx.honestNodes.filter(n => n.id !== observer.id)
	const burst = Math.min(attackParams(ctx, node).burstSize, targets.length)
	for (let i = 0; i < burst; i++) {
		const target = targets[Math.floor(rng() * targets.length)]
		if (!target) continue
		queueSlash(
			ctx,
			observer,
			target.id,
			node.id,
			tunables.reputation.slashUnverifiedDefaultClaim * 1.5,
			false,
			round,
			tunables,
		)
	}
}

/**
 * @param {object} ctx 仿真上下文
 * @param {import('./model.mjs').SimNode} node 恶意节点
 * @param {import('./model.mjs').SimObserver} observer 诚实观察者
 * @param {number} round 当前回合
 * @param {import('./tunables_bundle.mjs').TunablesBundle} tunables 候选参数
 * @returns {void}
 */
function runOscillator(ctx, node, observer, round, tunables) {
	const { bumpChunkStorageReputationPure, penalizeChunkStorageFailurePure } = ctx.engine
	if (round % 2 === 0)
		bumpChunkStorageReputationPure(observer.reputation, node.id, tunables.reputation)
	else
		penalizeChunkStorageFailurePure(observer.reputation, node.id, tunables.reputation)
}

/**
 * 提示投毒：向观察者注入指向自己的发现提示，权重随 hintDefaultWeight 缩放。
 * @param {object} ctx 仿真上下文
 * @param {import('./model.mjs').SimNode} node 恶意节点
 * @param {import('./model.mjs').SimObserver} observer 诚实观察者
 * @param {import('./tunables_bundle.mjs').TunablesBundle} tunables 候选参数
 * @returns {void}
 */
function runHintPoisoner(ctx, node, observer, tunables) {
	const mul = attackParams(ctx, node).hintWeightMul
	const weight = tunables.trustGraph.hintDefaultWeight * mul
	const existing = observer.injectedHints.find(h => h.nodeHash === node.id)
	if (existing)
		existing.weight = (existing.weight ?? weight) + weight
	else
		observer.injectedHints.push({ nodeHash: node.id, source: 'poison', weight })
}

/**
 * 盗号/同 hash：继承受害者已积累的信誉后作恶。
 * @param {object} ctx 仿真上下文
 * @param {import('./model.mjs').SimNode} node 恶意节点
 * @param {import('./model.mjs').SimObserver} observer 诚实观察者
 * @param {() => number} rng 随机源
 * @param {number} round 当前回合
 * @param {import('./tunables_bundle.mjs').TunablesBundle} tunables 候选参数
 * @returns {void}
 */
function runKeyThief(ctx, node, observer, rng, round, tunables) {
	const { bumpReputationOnRelayPure, recordMessageRateViolationPure, penalizeArchiveServeMismatchPure } = ctx.engine
	const victimId = node.stolenFromId
	if (!victimId) return

	// 首次回合：复制受害者信誉分
	if (round === 0 && observer.reputation.byNodeHash[victimId]?.score != null) {
		const victimScore = observer.reputation.byNodeHash[victimId].score
		observer.reputation.byNodeHash[node.id] = { score: victimScore }
	}

	if (round < 3) {
		if (rng() < 0.5)
			bumpReputationOnRelayPure(observer.reputation, node.id, `key-thief-warm:${round}`, ctx.now, tunables.reputation)
		return
	}

	// 盗号后作恶
	if (rng() < 0.7)
		recordMessageRateViolationPure(observer.reputation, node.id, tunables.reputation)
	if (rng() < 0.4)
		penalizeArchiveServeMismatchPure(observer.reputation, node.id, tunables.reputation)
}

/**
 * 肉鸡突变：前期诚实刷信誉，turnRound 后突然转恶。
 * @param {object} ctx 仿真上下文
 * @param {import('./model.mjs').SimNode} node 恶意节点
 * @param {import('./model.mjs').SimObserver} observer 诚实观察者
 * @param {() => number} rng 随机源
 * @param {number} round 当前回合
 * @param {import('./tunables_bundle.mjs').TunablesBundle} tunables 候选参数
 * @returns {void}
 */
function runSleeper(ctx, node, observer, rng, round, tunables) {
	const { bumpReputationOnRelayPure, bumpChunkStorageReputationPure, recordMessageRateViolationPure } = ctx.engine
	const p = attackParams(ctx, node)
	const turnRound = node.sleeperTurnRound ?? ctx.sleeperTurnRound ?? 15

	if (round < turnRound) {
		if (rng() < p.activationRate)
			bumpReputationOnRelayPure(observer.reputation, node.id, `sleeper-good:${round}`, ctx.now, tunables.reputation)
		if (rng() < 0.4)
			bumpChunkStorageReputationPure(observer.reputation, node.id, tunables.reputation)
		return
	}

	for (let i = 0; i < Math.max(1, Math.floor(p.burstSize / 2)); i++)
		recordMessageRateViolationPure(observer.reputation, node.id, tunables.reputation)
	const honest = pickHonestTarget(ctx, observer, rng, p.targetBiasHighRep)
	if (honest && rng() < p.activationRate * 0.5)
		queueSlash(ctx, observer, honest.id, node.id, tunables.reputation.slashUnverifiedDefaultClaim, false, round, tunables)
}

/**
 * digest 等价欺骗：对不同观察者上报不同归档摘要（记录在 ctx.equivocationByObserver）。
 * @param {object} ctx 仿真上下文
 * @param {import('./model.mjs').SimNode} node 恶意节点
 * @param {import('./model.mjs').SimObserver} observer 诚实观察者
 * @param {import('./tunables_bundle.mjs').TunablesBundle} tunables 候选参数
 * @returns {void}
 */
function runEquivocator(ctx, node, observer, tunables) {
	const { penalizeArchiveServeMismatchPure } = ctx.engine
	penalizeArchiveServeMismatchPure(observer.reputation, node.id, tunables.reputation)
	if (!ctx.equivocationByObserver) ctx.equivocationByObserver = new Map()
	const key = `${node.id}:${observer.id}`
	ctx.equivocationByObserver.set(key, (ctx.equivocationByObserver.get(key) ?? 0) + 1)
}

/**
 * 定向 eclipse：对单一受害诚实节点做分区（标记 ctx.eclipseTargets）。
 * @param {object} ctx 仿真上下文
 * @param {import('./model.mjs').SimNode} node 恶意节点
 * @param {import('./model.mjs').SimObserver} observer 诚实观察者
 * @param {() => number} rng 随机源
 * @param {number} round 当前回合
 * @param {import('./tunables_bundle.mjs').TunablesBundle} tunables 候选参数
 * @returns {void}
 */
function runTargetedEclipse(ctx, node, observer, rng, round, tunables) {
	const { recordGossipAllUnknownWantPure } = ctx.engine
	const p = attackParams(ctx, node)
	const targetId = node.eclipseTargetId ?? ctx.eclipseTargetId
	if (targetId)
		ctx.eclipseVictims = ctx.eclipseVictims ?? new Set()
	for (let i = 0; i < p.burstSize; i++)
		recordGossipAllUnknownWantPure(observer.reputation, node.id, ctx.now + i, tunables.reputation)
	if (targetId) {
		ctx.eclipseVictims.add(targetId)
		eclipseFillExplore(ctx.discovery, observer.id, node.id, [node.id], p.eclipseFocus)
	}
}

/**
 * pump-and-dump：sybil 簇交叉抬升一个身份进 topK 后再伪造。
 * @param {object} ctx 仿真上下文
 * @param {import('./model.mjs').SimNode} node 恶意节点
 * @param {import('./model.mjs').SimObserver} observer 诚实观察者
 * @param {() => number} rng 随机源
 * @param {number} round 当前回合
 * @param {import('./tunables_bundle.mjs').TunablesBundle} tunables 候选参数
 * @returns {void}
 */
function runRepPump(ctx, node, observer, rng, round, tunables) {
	const { penalizeArchiveServeMismatchPure } = ctx.engine
	const p = attackParams(ctx, node)
	const pumpRounds = Math.max(8, Math.round((ctx.scenario?.rounds ?? 40) * p.sleeperTurnFrac))
	if (round < pumpRounds) {
		observeSelfRelayBump(ctx, node, observer, rng, p.activationRate, `pump:${round}:${node.id}`, tunables)
		for (const sybil of ctx.sybilCluster(node))
			if (sybil.id !== node.id && rng() < p.activationRate * p.collusionAllyRate)
				injectAllyHint(ctx, observer, sybil.id, node.id, 0.5, tunables)
		return
	}
	if (rng() < p.activationRate)
		penalizeArchiveServeMismatchPure(observer.reputation, node.id, tunables.reputation)
}

/**
 * 慢滴 spammer：紧贴速率阈值下方刷量。
 * @param {object} ctx 仿真上下文
 * @param {import('./model.mjs').SimNode} node 恶意节点
 * @param {import('./model.mjs').SimObserver} observer 诚实观察者
 * @param {import('./tunables_bundle.mjs').TunablesBundle} tunables 候选参数
 * @returns {void}
 */
function runSlowDripSpammer(ctx, node, observer, tunables) {
	const { recordMessageRateViolationPure } = ctx.engine
	// 每 3 回合才触发一次，模拟慢滴
	if (ctx.now % 180_000 !== 0) return
	recordMessageRateViolationPure(observer.reputation, node.id, tunables.reputation)
}

/**
 * @param {object} ctx 仿真上下文
 * @param {import('./model.mjs').SimObserver} observer 诚实观察者
 * @param {() => number} rng 随机源
 * @param {number} [highRepBias=0] 高信誉目标偏好 0..1
 * @returns {import('./model.mjs').SimNode | null} 随机诚实目标，无则 null
 */
function pickHonestTarget(ctx, observer, rng, highRepBias = 0) {
	const honest = ctx.honestNodes.filter(n => n.id !== observer.id)
	if (!honest.length) return null
	if (highRepBias > 0 && rng() < highRepBias) {
		const scored = honest
			.map(n => ({ n, s: observer.reputation.byNodeHash[n.id]?.score ?? 0 }))
			.sort((a, b) => b.s - a.s)
		const top = scored.slice(0, Math.max(1, Math.ceil(honest.length * 0.25)))
		return top[Math.floor(rng() * top.length)]?.n ?? honest[Math.floor(rng() * honest.length)]
	}
	return honest[Math.floor(rng() * honest.length)]
}
