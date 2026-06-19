/**
 * 参数搜索空间（按模块 JSON 分组）。
 */
import { createRng } from './rng.mjs'
import { loadDefaultTunables } from './tunables_bundle.mjs'

/**
 * @typedef {{
 *   module: keyof import('./tunables_bundle.mjs').TunablesBundle,
 *   key: string,
 *   min: number,
 *   max: number,
 *   step?: number,
 *   kind?: 'int' | 'float',
 * }} ParamSpec
 */

/** @type {ParamSpec[]} */
export const PARAM_SPACE = [
	{ module: 'reputation', key: 'penaltyUnknownWant', min: 0.05, max: 0.25, step: 0.01 },
	{ module: 'reputation', key: 'penaltyMessageRate', min: 0.08, max: 0.30, step: 0.01 },
	{ module: 'reputation', key: 'chunkFetchFailPenalty', min: 0.04, max: 0.16, step: 0.01 },
	{ module: 'reputation', key: 'relayRepBump', min: 0.005, max: 0.05, step: 0.005 },
	{ module: 'reputation', key: 'wantUnknownThreshold', min: 2, max: 6, step: 1, kind: 'int' },
	{ module: 'reputation', key: 'collusionLambda', min: 0.03, max: 0.15, step: 0.01 },
	{ module: 'reputation', key: 'collusionDelta', min: 0.4, max: 0.85, step: 0.02 },
	{ module: 'reputation', key: 'collusionMaxHop', min: 3, max: 8, step: 1, kind: 'int' },
	{ module: 'reputation', key: 'slashVerifiedMultiplier', min: 0.3, max: 0.8, step: 0.05 },
	{ module: 'trustGraph', key: 'federationFanoutTopK', min: 4, max: 16, step: 1, kind: 'int' },
	{ module: 'trustGraph', key: 'hintDefaultWeight', min: 0.05, max: 0.25, step: 0.01 },
	{ module: 'trustGraph', key: 'rosterDefaultScore', min: 0.05, max: 0.3, step: 0.01 },
	{ module: 'social', key: 'socialBlockClaim', min: 0.2, max: 0.8, step: 0.05 },
	{ module: 'social', key: 'socialRepHideThreshold', min: -0.8, max: -0.2, step: 0.05 },
	{ module: 'social', key: 'socialBlockDecayFraction', min: 0.005, max: 0.05, step: 0.005 },
	{ module: 'mailbox', key: 'maxHop', min: 2, max: 6, step: 1, kind: 'int' },
	{ module: 'mailbox', key: 'relayFanoutTrusted', min: 3, max: 12, step: 1, kind: 'int' },
	{ module: 'mailbox', key: 'wantFanout', min: 4, max: 16, step: 1, kind: 'int' },
	{ module: 'archive', key: 'archiveQuorumPeerMin', min: 2, max: 5, step: 1, kind: 'int' },
	{ module: 'archive', key: 'archiveQuorumPeerStrictMin', min: 3, max: 8, step: 1, kind: 'int' },
]

/**
 * @param {number} n 数值
 * @returns {number} 小数位数
 */
function decimalPlaces(n) {
	const text = String(n)
	const dot = text.indexOf('.')
	return dot === -1 ? 0 : text.length - dot - 1
}

/**
 * @param {number} value 原始值
 * @param {number} [step] 步长
 * @param {number} [min] 下界（用于步长量化）
 * @returns {number} 消除浮点尾差的值
 */
export function quantize(value, step, min = 0) {
	if (!Number.isFinite(value)) return value
	const decimals = Math.max(decimalPlaces(step ?? 0), decimalPlaces(min))
	return Number(value.toFixed(decimals))
}

/**
 * @param {import('./tunables_bundle.mjs').TunablesBundle} bundle tunables
 * @returns {void}
 */
export function sanitizeArchiveQuorum(bundle) {
	const peerMin = bundle.archive.archiveQuorumPeerMin
	if (bundle.archive.archiveQuorumPeerStrictMin < peerMin)
		bundle.archive.archiveQuorumPeerStrictMin = peerMin
}

/**
 * @param {import('./tunables_bundle.mjs').TunablesBundle} bundle tunables
 * @returns {import('./tunables_bundle.mjs').TunablesBundle} 约束后的 bundle
 */
export function sanitizeBundle(bundle) {
	sanitizeArchiveQuorum(bundle)
	return bundle
}

/**
 * @param {() => number} rng 随机源
 * @param {ParamSpec} spec 参数规格
 * @returns {number} 采样值
 */
export function sampleParam(rng, spec) {
	const span = spec.max - spec.min
	let v = spec.min + rng() * span
	if (spec.step) {
		const steps = Math.round((v - spec.min) / spec.step)
		v = spec.min + steps * spec.step
	}
	if (spec.kind === 'int') v = Math.round(v)
	else v = quantize(v, spec.step, spec.min)
	return Math.min(spec.max, Math.max(spec.min, v))
}

/**
 * @param {number} seed 种子
 * @returns {import('./tunables_bundle.mjs').TunablesBundle} 随机候选 tunables
 */
export function randomCandidate(seed) {
	const rng = createRng(seed)
	const base = loadDefaultTunables()
	for (const spec of PARAM_SPACE)
		base[spec.module][spec.key] = sampleParam(rng, spec)
	return sanitizeBundle(base)
}

/**
 * @param {import('./tunables_bundle.mjs').TunablesBundle} parent 父代
 * @param {number} seed 种子
 * @param {number} [mutationRate=0.3] 变异率
 * @returns {import('./tunables_bundle.mjs').TunablesBundle} 变异子代
 */
export function mutateCandidate(parent, seed, mutationRate = 0.3) {
	const rng = createRng(seed)
	const child = structuredClone(parent)
	for (const spec of PARAM_SPACE) {
		if (rng() > mutationRate) continue
		child[spec.module][spec.key] = sampleParam(rng, spec)
	}
	return sanitizeBundle(child)
}

/**
 * @param {import('./tunables_bundle.mjs').TunablesBundle} a 父代 A
 * @param {import('./tunables_bundle.mjs').TunablesBundle} b 父代 B
 * @param {number} seed 种子
 * @returns {import('./tunables_bundle.mjs').TunablesBundle} 交叉子代
 */
export function crossoverCandidates(a, b, seed) {
	const rng = createRng(seed)
	const out = structuredClone(a)
	for (const spec of PARAM_SPACE)
		if (rng() < 0.5)
			out[spec.module][spec.key] = b[spec.module][spec.key]
	return sanitizeBundle(out)
}
