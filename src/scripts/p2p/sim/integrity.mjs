/**
 * 密码学完整性 vs 主观信誉：持副本观察者独立证伪，无副本者才受信誉博弈影响。
 */

/**
 * @param {import('./model.mjs').SimObserver} observer 观察者
 * @param {import('./scenarios.mjs').SimScenario} scenario 场景
 * @returns {boolean} 是否持有本地归档副本（可独立重算 digest）
 */
export function observerHasLocalReplica(observer, scenario) {
	const groupSize = scenario.groupSize ?? 8
	const honestShare = (scenario.honestCount ?? 0) / Math.max(1, groupSize)
	const archiveHeavy = observer.trustedPeers.length >= 2
		&& (scenario.behaviorDist?.archiveSubmitRate?.mean ?? 0) >= 0.15
	return (honestShare >= 0.75 && observer.trustedPeers.length >= 1) || archiveHeavy
}

/**
 * @param {import('./model.mjs').SimNode} attacker 攻击节点
 * @param {import('./model.mjs').SimObserver} observer 观察者
 * @param {import('./scenarios.mjs').SimScenario} scenario 场景
 * @param {object} ctx 仿真上下文
 * @returns {boolean} 完整性层是否已证伪该攻击（defense≈1）
 */
export function integrityDefendsAgainst(attacker, observer, scenario, ctx) {
	if (!observerHasLocalReplica(observer, scenario)) return false
	if (attacker.attack === 'equivocator') {
		const key = `${attacker.id}:${observer.id}`
		return (ctx.equivocationByObserver?.get(key) ?? 0) > 0
	}
	if (attacker.attack === 'archive_forger' || attacker.attack === 'lazy_chunk')
		return ctx.verifiedForgery?.has(attacker.id) === true
	return false
}

/**
 * @param {import('./model.mjs').SimObserver[]} observers 观察者列表
 * @param {import('./scenarios.mjs').SimScenario} scenario 场景
 * @returns {number} 持副本观察者比例 0..1
 */
export function replicaObserverFraction(observers, scenario) {
	if (!observers.length) return 0
	let n = 0
	for (const obs of observers)
		if (observerHasLocalReplica(obs, scenario)) n++
	return n / observers.length
}

/**
 * 归档仲裁正确率：持副本者独立重算；无副本者走信誉 quorum。
 * @param {number} quorumAccuracy 纯信誉 quorum 准确率
 * @param {number} replicaFraction 持副本观察者比例
 * @returns {number} 综合准确率
 */
export function blendArchiveQuorumAccuracy(quorumAccuracy, replicaFraction) {
	return Math.max(quorumAccuracy, replicaFraction * 0.75 * quorumAccuracy)
}
