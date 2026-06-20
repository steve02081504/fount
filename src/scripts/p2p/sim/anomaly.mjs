/**
 * 仿真器中的本地可逆异常隔离（映射生产 reputation_engine 纯函数）。
 */
import {
	isQuarantinedPure,
	observeBehaviorSamplePure,
} from '../reputation_engine.mjs'

/**
 * @param {import('../reputation_store.mjs').ReputationFile} reputation 观察者信誉表
 * @param {string} peerId 对端 nodeHash
 * @param {number} sample 行为样本
 * @param {number} now 当前时间
 * @param {import('../reputation.tunables.json')} tunables reputation tunables
 * @returns {boolean} 是否触发隔离
 */
export function simObservePeerBehavior(reputation, peerId, sample, now, tunables) {
	return observeBehaviorSamplePure(reputation, peerId, sample, now, tunables).anomaly
}

/**
 * @param {import('../reputation_store.mjs').ReputationFile} reputation 观察者信誉表
 * @param {string} peerId 对端 nodeHash
 * @param {number} now 当前时间
 * @returns {boolean} 是否隔离中
 */
export function simIsPeerQuarantined(reputation, peerId, now) {
	return isQuarantinedPure(reputation, peerId, now)
}

/**
 * @param {number} discoveryReach 发现可达 0..1
 * @param {() => number} rng 随机源
 * @returns {boolean} 攻击是否触达该观察者
 */
export function attackReachesObserver(discoveryReach, rng) {
	const reach = Math.max(0, Math.min(1, discoveryReach))
	return rng() < 0.15 + reach * 0.85
}
