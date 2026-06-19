/**
 * 恶意节点行为原型。
 */

/** @typedef {'sybil' | 'collusion' | 'spammer' | 'false_accuser' | 'eclipse' | 'lazy_chunk' | 'social_mob'} AttackKind */

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
	for (let i = 0; i < tunables.reputation.wantUnknownThreshold; i++)
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
 * @param {import('./model.mjs').SimObserver} observer 诚实观察者
 * @param {() => number} rng 随机源
 * @returns {import('./model.mjs').SimNode | null} 随机诚实目标，无则 null
 */
function pickHonestTarget(ctx, observer, rng) {
	const honest = ctx.nodes.filter(n => n.kind === 'honest' && n.id !== observer.id)
	if (!honest.length) return null
	return honest[Math.floor(rng() * honest.length)]
}
