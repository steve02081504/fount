/**
 * 区域设置匹配纯函数（零依赖，前后端同构）。
 * 严格前缀：`k === prefix || k.startsWith(prefix + '-')`，避免 `zh` 误命中 `zhuang`。
 */

/** 无匹配时的最终兜底（产品默认英文）。 */
export const FALLBACK_LOCALE = 'en-UK'

/**
 * @param {string | { id?: string } | null | undefined} entry 可用条目
 * @returns {string} locale id
 */
function localeIdOf(entry) {
	if (entry == null) return ''
	if (typeof entry === 'string') return entry
	return String(entry.id ?? '')
}

/**
 * @param {Array<string | { id?: string }>} available 可用列表（`string[]` 或 `{id}[]`）
 * @returns {string[]} locale id 列表
 */
function normalizeAvailable(available) {
	return (available || []).map(localeIdOf).filter(Boolean)
}

/**
 * 从优先列表中选取与可用列表最匹配的区域设置。
 * @param {string[]} preferred 优先区域设置列表
 * @param {Array<string | { id?: string }>} available 可用列表
 * @returns {string | undefined} 最佳匹配；无匹配时 undefined
 */
export function matchLocale(preferred, available) {
	const ids = normalizeAvailable(available)
	if (!ids.length) return undefined
	const idSet = new Set(ids)

	for (const raw of preferred || []) {
		const preferredLocale = String(raw || '').trim()
		if (!preferredLocale) continue
		if (idSet.has(preferredLocale)) return preferredLocale

		const prefix = preferredLocale.split('-')[0]
		if (!prefix) continue
		const hit = ids.find(k => k === prefix || k.startsWith(`${prefix}-`))
		if (hit) return hit
	}
	return undefined
}

/**
 * 同 {@link matchLocale}，无匹配时回落 {@link FALLBACK_LOCALE}。
 * @param {string[]} preferred 优先区域设置列表
 * @param {Array<string | { id?: string }>} available 可用列表
 * @returns {string} 最佳匹配或兜底
 */
export function getBestLocale(preferred, available) {
	return matchLocale(preferred, available) ?? FALLBACK_LOCALE
}

/**
 * 从多语言 map 中按优先列表取最佳切片。
 * @template T
 * @param {Record<string, T>} [map] 多语言对象
 * @param {string[]} [preferred] 优先区域设置列表
 * @returns {T | undefined} 匹配切片；map 空则为 undefined
 */
export function pickLocalizedSlice(map, preferred) {
	if (!map) return undefined
	const keys = Object.keys(map)
	if (!keys.length) return undefined
	const hit = matchLocale(preferred, keys) ?? keys[0]
	return map[hit]
}
