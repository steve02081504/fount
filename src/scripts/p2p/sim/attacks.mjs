/**
 * 恶意节点行为原型。
 */

/** @typedef {'sybil' | 'collusion' | 'spammer' | 'false_accuser' | 'eclipse' | 'lazy_chunk' | 'social_mob' | 'archive_forger' | 'relay_farmer' | 'whitewasher' | 'report_flooder' | 'oscillator' | 'hint_poisoner'} AttackKind */

/** eclipse 攻击者固定灌入的「全未知 want」数量，与防御阈值解耦（攻击强度不应随我方阈值水涨船高）。 */
const ECLIPSE_WANT_BURST = 8

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
			runFalseAccuser(ctx, node, observer, rng, tunables)
			break
		case 'eclipse':
			runEclipse(ctx, node, observer, tunables)
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
			runReportFlooder(ctx, node, observer, rng, tunables)
			break
		case 'oscillator':
			runOscillator(ctx, node, observer, round, tunables)
			break
		case 'hint_poisoner':
			runHintPoisoner(node, observer)
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
	const { bumpReputationOnRelayPure } = ctx.engine
	if (rng() < 0.6)
		bumpReputationOnRelayPure(observer.reputation, node.id, `sybil:${node.id}`, ctx.now, tunables.reputation)
	for (const sybil of ctx.sybilCluster(node))
		if (rng() < 0.3)
			bumpReputationOnRelayPure(observer.reputation, sybil.id, `sybil:${sybil.id}`, ctx.now, tunables.reputation)
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
	const { bumpReputationOnRelayPure, applySubjectiveSlashPure } = ctx.engine
	if (rng() < 0.4)
		bumpReputationOnRelayPure(observer.reputation, node.id, `collusion:${round}`, ctx.now, tunables.reputation)
	const ring = ctx.collusionRing(node)
	const victim = ring.find(n => n.id !== node.id)
	if (victim && rng() < 0.15)
		applySubjectiveSlashPure(
			observer.reputation,
			victim.id,
			node.id,
			tunables.reputation.slashUnverifiedDefaultClaim,
			false,
			tunables.reputation,
		)
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
	for (let i = 0; i < 3; i++)
		recordMessageRateViolationPure(observer.reputation, node.id, tunables.reputation)
}

/**
 * @param {object} ctx 仿真上下文
 * @param {import('./model.mjs').SimNode} node 恶意节点
 * @param {import('./model.mjs').SimObserver} observer 诚实观察者
 * @param {() => number} rng 随机源
 * @param {import('./tunables_bundle.mjs').TunablesBundle} tunables 候选参数
 * @returns {void}
 */
function runFalseAccuser(ctx, node, observer, rng, tunables) {
	const { applySubjectiveSlashPure } = ctx.engine
	const honest = pickHonestTarget(ctx, observer, rng)
	if (!honest) return
	applySubjectiveSlashPure(
		observer.reputation,
		honest.id,
		node.id,
		tunables.reputation.slashUnverifiedDefaultClaim * 2,
		false,
		tunables.reputation,
	)
}

/**
 * @param {object} ctx 仿真上下文
 * @param {import('./model.mjs').SimNode} node 恶意节点
 * @param {import('./model.mjs').SimObserver} observer 诚实观察者
 * @param {import('./tunables_bundle.mjs').TunablesBundle} tunables 候选参数
 * @returns {void}
 */
function runEclipse(ctx, node, observer, tunables) {
	const { recordGossipAllUnknownWantPure } = ctx.engine
	for (let i = 0; i < ECLIPSE_WANT_BURST; i++)
		recordGossipAllUnknownWantPure(observer.reputation, node.id, ctx.now + i, tunables.reputation)
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
	for (let i = 0; i < 5; i++)
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
	if (stage === 0 && round >= 6) {
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
 * @param {import('./tunables_bundle.mjs').TunablesBundle} tunables 候选参数
 * @returns {void}
 */
function runReportFlooder(ctx, node, observer, rng, tunables) {
	const { applySubjectiveSlashPure } = ctx.engine
	const targets = ctx.nodes.filter(n => n.kind === 'honest' && n.id !== observer.id)
	for (let i = 0; i < Math.min(4, targets.length); i++) {
		const target = targets[Math.floor(rng() * targets.length)]
		if (!target) continue
		applySubjectiveSlashPure(
			observer.reputation,
			target.id,
			node.id,
			tunables.reputation.slashUnverifiedDefaultClaim * 1.5,
			false,
			tunables.reputation,
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
 * 提示投毒：向观察者注入指向自己（及同伙）的发现提示，企图借 hint 旁路抬升有效信誉。
 * 引擎对 hint 贡献设有 hintMaxBonus 上限，故该攻击的收益由 hintDefaultWeight / hintMaxBonus 决定。
 * @param {import('./model.mjs').SimNode} node 恶意节点
 * @param {import('./model.mjs').SimObserver} observer 诚实观察者
 * @returns {void}
 */
function runHintPoisoner(node, observer) {
	if (!observer.injectedHints.some(h => h.nodeHash === node.id))
		observer.injectedHints.push({ nodeHash: node.id, source: 'poison' })
}

/**
 * @param {object} ctx 仿真上下文
 * @param {import('./model.mjs').SimObserver} observer 诚实观察者
 * @param {() => number} rng 随机源
 * @returns {import('./model.mjs').SimNode | null} 随机诚实目标，无则 null
 */
function pickHonestTarget(ctx, observer, rng) {
	const honest = ctx.nodes.filter(n => n.kind === 'honest' && n.id !== observer.id)
	if (!honest.length) return null
	return honest[Math.floor(rng() * honest.length)]
}
