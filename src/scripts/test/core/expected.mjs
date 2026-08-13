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
	if (msVal == null || !Number.isFinite(msVal) || msVal <= 0) return null
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
 * 由 suite 级 expected 与全部子测试 expected 反推固定开销。
 * 任一子测试缺 expected 则无法推断。
 * @param {import('./manifest.mjs').SuiteDef} suite suite
 * @returns {number | null} 开销毫秒
 */
export function declaredOverheadMs(suite) {
	if (suite.expectedMs == null || !suite.subtests?.length) return null
	let sum = 0
	for (const subtest of suite.subtests) {
		if (subtest.expectedMs == null || !Number.isFinite(subtest.expectedMs)) return null
		sum += subtest.expectedMs
	}
	return Math.max(0, suite.expectedMs - sum)
}
