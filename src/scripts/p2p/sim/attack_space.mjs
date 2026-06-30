/**
 * 攻击者可进化基因（与 space.mjs 采样器共用 latent 语义）。
 */
import { createRng } from './rng.mjs'
import { normalizeParam, sampleParam } from './space.mjs'
import { loadDefaultTunables } from './tunables_bundle.mjs'

/** @typedef {import('./attacks.mjs').AttackKind} AttackKind */

/**
 * @typedef {{
 *   global: { activationRate: number, burstSize: number, targetBiasHighRep: number, eclipseFocus: number },
 *   byAttack: Partial<Record<AttackKind, { activationRate?: number, burstSize?: number, collusionAllyRate?: number, sleeperTurnFrac?: number, hintWeightMul?: number }>>,
 * }} AttackGenome
 */

/** @type {import('./space.mjs').ParamSpec[]} */
const GLOBAL_ATTACK_SPECS = [
	{ module: 'reputation', key: 'relayRepBump', kind: 'unit' }, // reuse kind; values remapped below
]

const DEFAULT_GENOME = Object.freeze({
	global: {
		activationRate: 0.55,
		burstSize: 4,
		targetBiasHighRep: 0.35,
		eclipseFocus: 0.65,
	},
	byAttack: {},
})

/**
 * @param {() => number} rng 随机源
 * @returns {AttackGenome} 随机攻击基因组
 */
export function randomAttackGenome(rng) {
	return {
		global: {
			activationRate: 0.2 + rng() * 0.75,
			burstSize: 1 + Math.floor(rng() * 8),
			targetBiasHighRep: rng() * 0.9,
			eclipseFocus: 0.3 + rng() * 0.65,
		},
		byAttack: {},
	}
}

/**
 * @param {AttackGenome} parent 父代
 * @param {number} seed 种子
 * @returns {AttackGenome} 变异子代
 */
export function mutateAttackGenome(parent, seed) {
	const rng = createRng(seed)
	const child = structuredClone(parent)
	if (rng() < 0.4) child.global.activationRate = Math.max(0.05, Math.min(0.98, child.global.activationRate + (rng() - 0.5) * 0.2))
	if (rng() < 0.35) child.global.burstSize = Math.max(1, Math.min(12, child.global.burstSize + Math.floor((rng() - 0.5) * 4)))
	if (rng() < 0.3) child.global.targetBiasHighRep = Math.max(0, Math.min(1, child.global.targetBiasHighRep + (rng() - 0.5) * 0.25))
	if (rng() < 0.3) child.global.eclipseFocus = Math.max(0.1, Math.min(1, child.global.eclipseFocus + (rng() - 0.5) * 0.25))
	return child
}

/**
 * @param {AttackKind} attack 攻击类型
 * @param {AttackGenome} genome 基因组
 * @returns {{ activationRate: number, burstSize: number, targetBiasHighRep: number, eclipseFocus: number, collusionAllyRate: number, sleeperTurnFrac: number, hintWeightMul: number }} 有效参数
 */
export function resolveAttackParams(attack, genome) {
	const g = genome.global
	const row = genome.byAttack[attack] ?? {}
	return {
		activationRate: row.activationRate ?? g.activationRate,
		burstSize: Math.max(1, Math.floor(row.burstSize ?? g.burstSize)),
		targetBiasHighRep: g.targetBiasHighRep,
		eclipseFocus: g.eclipseFocus,
		collusionAllyRate: row.collusionAllyRate ?? 0.25,
		sleeperTurnFrac: row.sleeperTurnFrac ?? 0.35,
		hintWeightMul: row.hintWeightMul ?? 3,
	}
}

/**
 * @param {AttackGenome | undefined} genome 基因组
 * @returns {AttackGenome} 默认补齐
 */
export function normalizeAttackGenome(genome) {
	if (!genome) return structuredClone(DEFAULT_GENOME)
	return {
		global: { ...DEFAULT_GENOME.global, ...genome.global },
		byAttack: { ...genome.byAttack },
	}
}

/** 名人堂容量 */
export const ATTACK_HOF_SIZE = 6

/**
 * @param {Array<{ genome: AttackGenome, fitness: number }>} hall 名人堂
 * @param {AttackGenome} genome 候选
 * @param {number} fitness 适应度
 * @returns {Array<{ genome: AttackGenome, fitness: number }>} 更新后名人堂
 */
export function updateAttackHallOfFame(hall, genome, fitness) {
	const next = [...hall, { genome: structuredClone(genome), fitness }]
	next.sort((a, b) => b.fitness - a.fitness)
	return next.slice(0, ATTACK_HOF_SIZE)
}

// silence unused import warning from eslint if any
void GLOBAL_ATTACK_SPECS
void loadDefaultTunables
void normalizeParam
void sampleParam
