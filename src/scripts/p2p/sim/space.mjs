/**
 * 参数搜索空间。
 *
 * 设计原则：不再用硬性的 min/max 盒子约束搜索，而是
 *   1. 让每个参数在其**语义域**内自由采样（正数 / (0,1) 比例 / 正整数 / [-1,1] 信誉分），
 *      语义域是结构性的（负惩罚、>1 的比例本就无意义），不是人为调参上下限；
 *   2. 适应度压力**全部来自仿真内生指标**（churn 可达、误伤、quorum 安全等），
 *      不再在此模块追加外生手写常数惩罚。
 */
import { createRng } from './rng.mjs'
import { loadDefaultTunables } from './tunables_bundle.mjs'

/**
 * @typedef {'pos' | 'unit' | 'count' | 'score'} ParamKind
 *   - `pos`   正实数（惩罚、加分、权重、衰减率），对数正态采样，恒 > 0
 *   - `unit`  (0,1) 比例（主张、乘子、分数、默认分），logit 空间采样，恒在 (0,1)
 *   - `count` 正整数（跳数、fanout、quorum），对数正态四舍五入，恒 ≥ 1
 *   - `score` [-1,1] 信誉分阈值，tanh 空间采样，恒在 (-1,1)
 */

/**
 * @typedef {{
 *   module: keyof import('./tunables_bundle.mjs').TunablesBundle,
 *   key: string,
 *   kind: ParamKind,
 *   scale?: number,
 * }} ParamSpec
 */

/** 各 kind 的默认探索尺度（采样标准差，作用于各自的变换空间）。 */
const DEFAULT_SCALE = Object.freeze({ pos: 0.55, unit: 0.7, count: 0.5, score: 0.6 })

/** @type {ParamSpec[]} */
export const PARAM_SPACE = [
	{ module: 'reputation', key: 'penaltyUnknownWant', kind: 'pos' },
	{ module: 'reputation', key: 'penaltyMessageRate', kind: 'pos' },
	{ module: 'reputation', key: 'chunkFetchFailPenalty', kind: 'pos' },
	{ module: 'reputation', key: 'relayRepBump', kind: 'pos' },
	{ module: 'reputation', key: 'wantUnknownThreshold', kind: 'count' },
	{ module: 'reputation', key: 'collusionLambda', kind: 'pos' },
	{ module: 'reputation', key: 'collusionDelta', kind: 'unit' },
	{ module: 'reputation', key: 'collusionMaxHop', kind: 'count' },
	{ module: 'reputation', key: 'slashVerifiedMultiplier', kind: 'unit' },
	{ module: 'reputation', key: 'introducerSeedEdge', kind: 'unit' },
	{ module: 'reputation', key: 'recidivismMultiplierStep', kind: 'unit' },
	{ module: 'reputation', key: 'recidivismMax', kind: 'pos' },
	{ module: 'reputation', key: 'redemptionCreditPerStreakLevel', kind: 'pos' },
	{ module: 'reputation', key: 'inviteRedemptionCreditPerBad', kind: 'pos' },
	{ module: 'reputation', key: 'inviteBadEscalationStep', kind: 'unit' },
	{ module: 'reputation', key: 'inviteBadEscalationMax', kind: 'pos' },
	{ module: 'reputation', key: 'inviteHopBonusEvery', kind: 'count' },
	{ module: 'reputation', key: 'inviteHopBonusMax', kind: 'count' },
	{ module: 'reputation', key: 'inviteDeltaBoostPerBad', kind: 'unit' },
	{ module: 'reputation', key: 'inviteDeltaBoostMax', kind: 'unit' },
	{ module: 'trustGraph', key: 'federationFanoutTopK', kind: 'count' },
	{ module: 'trustGraph', key: 'hintDefaultWeight', kind: 'unit' },
	{ module: 'trustGraph', key: 'hintMaxBonus', kind: 'unit' },
	{ module: 'trustGraph', key: 'rosterDefaultScore', kind: 'unit' },
	{ module: 'social', key: 'socialBlockClaim', kind: 'unit' },
	{ module: 'social', key: 'socialRepHideThreshold', kind: 'score' },
	{ module: 'mailbox', key: 'maxHop', kind: 'count' },
	{ module: 'mailbox', key: 'relayFanoutTrusted', kind: 'count' },
	{ module: 'mailbox', key: 'wantFanout', kind: 'count' },
	{ module: 'archive', key: 'archiveQuorumPeerMin', kind: 'count' },
	{ module: 'archive', key: 'archiveQuorumPeerStrictMin', kind: 'count' },
	{ module: 'admission', key: 'powFloorBits', kind: 'count' },
	{ module: 'admission', key: 'powVoluntaryBonusCap', kind: 'unit' },
	{ module: 'admission', key: 'powVoluntaryBonusScaleBits', kind: 'count' },
]

const EPS = 1e-9

/** 规整输出时的语义域 epsilon：需大于 6 位四舍五入精度，避免正数被舍成 0。 */
const DOMAIN_EPS = 1e-6

/**
 * @param {number} x 任意实数
 * @returns {number} softplus，恒 > 0
 */
function softplus(x) {
	const z = Number.isFinite(x) ? x : 0
	if (z > 20) return z
	if (z < -20) return Math.exp(z)
	return Math.log1p(Math.exp(z))
}

/**
 * @param {number} x 任意实数
 * @returns {number} sigmoid，落在 (0,1)
 */
function sigmoid(x) {
	return 1 / (1 + Math.exp(-x))
}

/**
 * @param {number} p (0,1) 概率
 * @returns {number} logit
 */
function logit(p) {
	const safe = p > 0 && p < 1 ? p : sigmoid(p)
	return Math.log(safe / (1 - safe))
}

/**
 * @param {number} s (-1,1) 信誉分
 * @returns {number} atanh
 */
function atanhScore(s) {
	const safe = s > -1 && s < 1 ? s : Math.tanh(s)
	return Math.atanh(safe)
}

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
 * @param {number} [decimals=8] 保留小数位
 * @returns {number} 消除浮点尾差的值
 */
export function quantize(value, decimals = 8) {
	if (!Number.isFinite(value)) return value
	return Number(value.toFixed(Math.min(12, Math.max(0, decimals))))
}

/**
 * 把任意数值规整回参数的语义域（结构性正确性，而非调参上下限）。
 * @param {number} value 原始值
 * @param {ParamSpec} spec 参数规格
 * @returns {number} 规整后的值
 */
export function normalizeParam(value, spec) {
	if (!Number.isFinite(value))
		return loadDefaultTunables()[spec.module][spec.key]
	switch (spec.kind) {
		case 'count':
			if (Number.isInteger(value) && value >= 1) return value
			return Math.round(1 + softplus(value - 1))
		case 'pos':
			return quantize(value > 0 ? value : softplus(value) + DOMAIN_EPS, 6)
		case 'unit':
			if (value > 0 && value < 1) return quantize(value, 6)
			{
				const repaired = quantize(sigmoid(value), 6)
				if (repaired >= 1) return 1 - DOMAIN_EPS
				if (repaired <= 0) return DOMAIN_EPS
				return repaired
			}
		case 'score':
			if (value > -1 && value < 1) return quantize(value, 6)
			{
				const repaired = quantize(Math.tanh(value), 6)
				if (repaired >= 1) return 1 - DOMAIN_EPS
				if (repaired <= -1) return -1 + DOMAIN_EPS
				return repaired
			}
		default:
			return value
	}
}

/**
 * @param {import('./tunables_bundle.mjs').TunablesBundle} bundle tunables
 * @returns {import('./tunables_bundle.mjs').TunablesBundle} 语义域规整后的 bundle
 */
export function normalizeBundle(bundle) {
	const out = structuredClone(bundle)
	for (const spec of PARAM_SPACE)
		out[spec.module][spec.key] = normalizeParam(out[spec.module][spec.key], spec)
	return out
}

/**
 * 关系规则：strict quorum 不得低于 base quorum（否则语义自相矛盾）。
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
 * @returns {import('./tunables_bundle.mjs').TunablesBundle} 规则归一后的 bundle
 */
export function sanitizeBundle(bundle) {
	sanitizeArchiveQuorum(bundle)
	return bundle
}

/**
 * 把数值映射到 kind 各自的变换空间（采样/漂移度量都在该空间内进行）。
 * @param {number} value 数值
 * @param {ParamKind} kind 参数类型
 * @returns {number} 变换空间坐标
 */
function toLatent(value, kind) {
	switch (kind) {
		case 'pos':
		case 'count':
			return Math.log(value > EPS ? value : softplus(value) + EPS)
		case 'unit':
			return logit(value)
		case 'score':
			return atanhScore(value)
		default:
			return value
	}
}

/**
 * {@link toLatent} 的逆映射。
 * @param {number} latent 变换空间坐标
 * @param {ParamKind} kind 参数类型
 * @returns {number} 语义域数值
 */
function fromLatent(latent, kind) {
	switch (kind) {
		case 'pos':
			return Math.exp(latent)
		case 'count':
			return Math.max(1, Math.round(Math.exp(latent)))
		case 'unit':
			return sigmoid(latent)
		case 'score':
			return Math.tanh(latent)
		default:
			return latent
	}
}

/**
 * @param {() => number} rng 随机源
 * @returns {number} 标准正态样本（Box–Muller）
 */
function gaussian(rng) {
	let u = 0
	let v = 0
	while (u <= EPS) u = rng()
	while (v <= EPS) v = rng()
	return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v)
}

/**
 * 围绕 `center` 在语义域内采样一个参数（无硬性盒子）。
 * @param {() => number} rng 随机源
 * @param {ParamSpec} spec 参数规格
 * @param {number} center 采样中心（默认值或父代值）
 * @param {number} [scaleMul=1] 尺度系数（局部变异时取 <1）
 * @returns {number} 采样值
 */
export function sampleParam(rng, spec, center, scaleMul = 1) {
	const scale = (spec.scale ?? DEFAULT_SCALE[spec.kind]) * scaleMul
	const latent = toLatent(center, spec.kind) + gaussian(rng) * scale
	return normalizeParam(fromLatent(latent, spec.kind), spec)
}

/**
 * @param {number} seed 种子
 * @returns {import('./tunables_bundle.mjs').TunablesBundle} 随机候选 tunables
 */
export function randomCandidate(seed) {
	const rng = createRng(seed)
	const base = loadDefaultTunables()
	for (const spec of PARAM_SPACE)
		base[spec.module][spec.key] = sampleParam(rng, spec, base[spec.module][spec.key])
	return sanitizeBundle(base)
}

/**
 * @param {import('./tunables_bundle.mjs').TunablesBundle} parent 父代
 * @param {number} seed 种子
 * @param {number} [mutationRate=0.3] 变异率
 * @param {number} [scaleMul=0.5] 局部探索尺度
 * @returns {import('./tunables_bundle.mjs').TunablesBundle} 变异子代
 */
export function mutateCandidate(parent, seed, mutationRate = 0.3, scaleMul = 0.5) {
	const rng = createRng(seed)
	const child = structuredClone(parent)
	for (const spec of PARAM_SPACE) {
		if (rng() > mutationRate) continue
		child[spec.module][spec.key] = sampleParam(rng, spec, child[spec.module][spec.key], scaleMul)
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
