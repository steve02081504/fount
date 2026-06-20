/**
 * 入群 PoW 成本模型：算力预算限速 Sybil/洗白造号。
 */
import { expectedJoinPowHashes } from '../join_pow.mjs'

/** 每回合可消耗的期望哈希预算（相对 2^16 基准） */
const HASH_BUDGET_PER_ROUND = 65536

/**
 * @param {number} difficultyBits PoW 难度 bit
 * @returns {number} 造一个新身份期望回合成本
 */
export function roundsPerIdentity(difficultyBits) {
	const expected = expectedJoinPowHashes(difficultyBits)
	return Math.max(1, expected / HASH_BUDGET_PER_ROUND)
}

/**
 * @param {number} requested 请求数量
 * @param {number} difficultyBits PoW 难度
 * @param {number} rounds 仿真总回合
 * @returns {number} 预算内可生成的恶意身份数
 */
export function capMaliciousByPowBudget(requested, difficultyBits, rounds) {
	const cost = roundsPerIdentity(difficultyBits)
	const budget = Math.max(1, Math.floor(rounds / cost))
	return Math.min(requested, budget)
}

/**
 * @param {number} difficultyBits PoW 难度
 * @param {number} rounds 回合数
 * @returns {number} 诚实新人入群延迟惩罚 0..1（越高=越慢）
 */
export function honestJoinDelayPenalty(difficultyBits, rounds) {
	const cost = roundsPerIdentity(difficultyBits)
	const delay = cost / Math.max(1, rounds * 0.25)
	return Math.min(1, delay)
}
