/**
 * 参数搜索空间。
 *
 * 设计原则：不再用硬性的 min/max 盒子约束搜索，而是
 *   1. 让每个参数在其**语义域**内自由采样（正数 / (0,1) 比例 / 正整数 / [-1,1] 信誉分），
 *      语义域是结构性的（负惩罚、>1 的比例本就无意义），不是人为调参上下限；
 *   2. 用 {@link softRulePenalty} 这一组「规则」去鼓励/抑制参数，而非一刀切裁剪——
 *      偏离默认值、削弱防御、放大带宽成本、过严仲裁都会被软惩罚拉回，
 *      但只要仿真指标的收益足够大，优化器依然可以越过这些规则。
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
	{ module: 'trustGraph', key: 'federationFanoutTopK', kind: 'count' },
	{ module: 'trustGraph', key: 'hintDefaultWeight', kind: 'unit' },
	{ module: 'trustGraph', key: 'rosterDefaultScore', kind: 'unit' },
	{ module: 'social', key: 'socialBlockClaim', kind: 'unit' },
	{ module: 'social', key: 'socialRepHideThreshold', kind: 'score' },
	{ module: 'social', key: 'socialBlockDecayFraction', kind: 'unit' },
	{ module: 'mailbox', key: 'maxHop', kind: 'count' },
	{ module: 'mailbox', key: 'relayFanoutTrusted', kind: 'count' },
	{ module: 'mailbox', key: 'wantFanout', kind: 'count' },
	{ module: 'archive', key: 'archiveQuorumPeerMin', kind: 'count' },
	{ module: 'archive', key: 'archiveQuorumPeerStrictMin', kind: 'count' },
]

const EPS = 1e-9

/** 规整输出时的语义域 epsilon：需大于 6 位四舍五入精度，避免正数被舍成 0。 */
const DOMAIN_EPS = 1e-6

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
	const c = Math.min(1 - EPS, Math.max(EPS, p))
	return Math.log(c / (1 - c))
}

/**
 * @param {number} s (-1,1) 信誉分
 * @returns {number} atanh
 */
function atanhScore(s) {
	const c = Math.min(1 - EPS, Math.max(-1 + EPS, s))
	return Math.atanh(c)
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
			return Math.max(1, Math.round(value))
		case 'pos':
			return quantize(Math.max(DOMAIN_EPS, value), 6)
		case 'unit':
			return quantize(Math.min(1 - DOMAIN_EPS, Math.max(DOMAIN_EPS, value)), 6)
		case 'score':
			return quantize(Math.min(1 - DOMAIN_EPS, Math.max(-1 + DOMAIN_EPS, value)), 6)
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
			return Math.log(Math.max(EPS, value))
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

// ── 软规则（鼓励/抑制，取代硬性 min/max）──────────────────────────────

/** 漂移正则强度：默认值处为 0，越偏离默认越被拉回（打破并列、抑制过拟合极值）。 */
const DRIFT_WEIGHT = 0.004

/**
 * 防御「不可关停」的软下限：低于 `knee` 时二次惩罚，knee 取默认值一半。
 * 取代「penalty 必须 > 0」这类硬约束——优化器仍可探索弱防御，但会持续被惩罚。
 */
const STRONG_DEFENSE_KEYS = Object.freeze([
	['reputation', 'penaltyUnknownWant'],
	['reputation', 'penaltyMessageRate'],
	['reputation', 'chunkFetchFailPenalty'],
	['social', 'socialBlockClaim'],
])
const STRONG_DEFENSE_WEIGHT = 0.5

/**
 * fanout / 跳数家族的「软带」：取代旧的硬性 [min,max] 盒子。
 *   - 高于默认 → 带宽/放大成本（仿真只数节点数，低估真实带宽）；
 *   - 低于默认 → 冗余/韧性损失（仿真的可达率只衡量所选集的「纯度」而非覆盖广度，
 *     低估了churn/eclipse 下的可达性）。
 * 两个方向各有软惩罚，等效于把参数轻轻拉向其工程默认规模，但不封死探索。
 */
const BANDWIDTH_KEYS = Object.freeze([
	['mailbox', 'maxHop'],
	['mailbox', 'relayFanoutTrusted'],
	['mailbox', 'wantFanout'],
	['trustGraph', 'federationFanoutTopK'],
])
const BANDWIDTH_WEIGHT = 0.025
const RESILIENCE_WEIGHT = 0.05

/** 隐藏阈值越接近 0 越「易误伤」诚实节点（仿真未建模的真实风险），软上限拐点 -0.3。 */
const HIDE_CEIL = -0.3
const HIDE_WEIGHT = 0.6

/** 仲裁人数越高，小群越难达成 quorum（活性风险），拐点 4。 */
const QUORUM_KNEE = 4
const QUORUM_WEIGHT = 0.03

/**
 * @param {number} x 实数
 * @returns {number} max(0, x)
 */
function relu(x) {
	return x > 0 ? x : 0
}

/**
 * 漂移正则：在各 kind 的变换空间内，惩罚相对默认值的平方偏离。
 * @param {import('./tunables_bundle.mjs').TunablesBundle} bundle tunables
 * @returns {number} 漂移惩罚
 */
export function driftPenalty(bundle) {
	const base = loadDefaultTunables()
	let penalty = 0
	for (const spec of PARAM_SPACE) {
		const scale = spec.scale ?? DEFAULT_SCALE[spec.kind]
		const d = toLatent(bundle[spec.module][spec.key], spec.kind)
			- toLatent(base[spec.module][spec.key], spec.kind)
		penalty += DRIFT_WEIGHT * (d / scale) ** 2
	}
	return penalty
}

/**
 * 领域软规则：鼓励保留防御、抑制带宽放大/触发式隐藏/过严仲裁。
 * @param {import('./tunables_bundle.mjs').TunablesBundle} bundle tunables
 * @returns {number} 领域惩罚
 */
export function domainRulePenalty(bundle) {
	const base = loadDefaultTunables()
	let penalty = 0

	for (const [module, key] of STRONG_DEFENSE_KEYS) {
		const knee = base[module][key] * 0.5
		penalty += STRONG_DEFENSE_WEIGHT * relu(1 - bundle[module][key] / knee) ** 2
	}

	for (const [module, key] of BANDWIDTH_KEYS) {
		const ratio = bundle[module][key] / base[module][key]
		const over = relu(ratio - 1)
		const under = relu(1 - ratio)
		penalty += BANDWIDTH_WEIGHT * (over + over ** 2)
		penalty += RESILIENCE_WEIGHT * (under + under ** 2)
	}

	const hideOver = relu(bundle.social.socialRepHideThreshold - HIDE_CEIL)
	penalty += HIDE_WEIGHT * (hideOver + 4 * hideOver ** 2)

	penalty += QUORUM_WEIGHT * relu(bundle.archive.archiveQuorumPeerStrictMin - QUORUM_KNEE)
	penalty += QUORUM_WEIGHT * relu(bundle.archive.archiveQuorumPeerMin - QUORUM_KNEE)

	return penalty
}

/**
 * 软规则总惩罚（从适应度中扣除）。默认 tunables 处恒为 0，作为无偏参照。
 * @param {import('./tunables_bundle.mjs').TunablesBundle} bundle tunables
 * @returns {number} 软规则惩罚（≥ 0）
 */
export function softRulePenalty(bundle) {
	return driftPenalty(bundle) + domainRulePenalty(bundle)
}
