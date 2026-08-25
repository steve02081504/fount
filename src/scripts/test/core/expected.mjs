/**
 * manifest `expected` 字段：时长字符串 / 毫秒数 ↔ 毫秒。
 */

const UNIT_MS = {
	ms: 1,
	s: 1000,
	m: 60_000,
	h: 3_600_000,
	d: 86_400_000,
}

/** 子秒网格（毫秒）。 */
const SUBSECOND_GRID_MS = 100

/**
 * 解析 manifest `expected` 为毫秒。
 * 接受正数毫秒，或 `16s` / `2m` / `4m12s` / `500ms`。
 * @param {unknown} raw manifest 字段
 * @returns {number | null} 毫秒；缺失或无法解析为 null
 */
export function parseExpectedMs(raw) {
	if (typeof raw === 'number')
		return Number.isFinite(raw) && raw > 0 ? raw : null
	if (typeof raw !== 'string') return null
	const text = raw.trim()
	if (!text) return null

	const token = /(\d+)\s*(ms|s|m|h|d)/gi
	let total = 0
	let matched = false
	let lastIndex = 0
	for (let hit = token.exec(text); hit; hit = token.exec(text)) {
		if (text.slice(lastIndex, hit.index).trim()) return null
		matched = true
		lastIndex = token.lastIndex
		total += Number(hit[1]) * UNIT_MS[hit[2].toLowerCase()]
	}
	if (!matched || text.slice(lastIndex).trim() || total <= 0) return null
	return total
}

/**
 * 将采样毫秒收成适合写入 manifest 的网格。
 * ≥1s 取整秒；不足 1s 按 100ms。
 * @param {number | null | undefined} msVal 毫秒
 * @returns {number | null} 收成后的毫秒
 */
export function roundExpectedMs(msVal) {
	if (!Number.isFinite(msVal) || msVal <= 0) return null
	if (msVal < 1000)
		return Math.max(SUBSECOND_GRID_MS, Math.round(msVal / SUBSECOND_GRID_MS) * SUBSECOND_GRID_MS)
	return Math.round(msVal / 1000) * 1000
}

/**
 * 将毫秒格式化为 manifest `expected` 字面量。
 * @param {number | null | undefined} msVal 毫秒
 * @returns {string | number | null} `16s` / `4m12s` / 子秒数字；无法格式化为 null
 */
export function formatExpected(msVal) {
	const rounded = roundExpectedMs(msVal)
	if (rounded == null) return null
	if (rounded < 1000) return rounded
	const sec = Math.round(rounded / 1000)
	const minutes = Math.floor(sec / 60)
	const rem = sec % 60
	if (!minutes) return `${rem}s`
	if (!rem) return `${minutes}m`
	return `${minutes}m${rem}s`
}

/**
 * 自动回写 `expected` 的漂移容差（连续函数，毫秒）。
 * 随规模亚线性增长：500ms 级容差约 2s，4min 级约 2min，30min 级约 8min。
 * 拟合自 {500→2181, 240000→125205, 1800000→469527} 的幂函数。
 * @param {number} scaleMs 基准规模（两个值中较大者，毫秒）
 * @returns {number} 允许的漂移量（毫秒）
 */
export function expectedDriftToleranceMs(scaleMs) {
	if (!Number.isFinite(scaleMs) || scaleMs <= 0) return 0
	return 37 * Math.pow(scaleMs, 0.656)
}

/**
 * 判断 manifest `expected` 与现状基线是否漂移超过容差。
 * 容差由较大值按 `expectedDriftToleranceMs` 连续给出，而非固定相对比例。
 * manifest 缺失但基线存在视为漂移（补齐）。比较基于网格化后的值，避免舍入抖动。
 * @param {number | null | undefined} manifestMs manifest `expected`（毫秒）
 * @param {number | null | undefined} baselineMs 现状基线（毫秒）
 * @returns {boolean} 是否应更新
 */
export function isExpectedDrift(manifestMs, baselineMs) {
	const roundedBase = roundExpectedMs(baselineMs)
	if (roundedBase == null) return false
	const roundedManifest = roundExpectedMs(manifestMs)
	if (roundedManifest == null) return true
	return Math.abs(roundedManifest - roundedBase) > expectedDriftToleranceMs(Math.max(roundedManifest, roundedBase))
}

/**
 * 由 suite 级 expected 与全部子测试 expected 反推固定开销。
 * 任一子测试缺 expected 则无法推断。
 * @param {import('./manifest.mjs').SuiteDef} suite suite
 * @returns {number | null} 开销毫秒
 */
export function declaredOverheadMs(suite) {
	if (suite.expectedMs == null || !suite.subtests?.length) return null
	let sum = 0
	for (const subtest of suite.subtests) {
		if (!Number.isFinite(subtest.expectedMs)) return null
		sum += subtest.expectedMs
	}
	return Math.max(0, suite.expectedMs - sum)
}
