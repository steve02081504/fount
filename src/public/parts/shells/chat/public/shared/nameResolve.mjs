import { entityHashLabel } from './entityHash.mjs'

/**
 * 统一名字解析：本地别名 → 自声明名 → 短码兜底。
 * @param {{ entityHash?: string, alias?: string, profileName?: string, fallbackLabel?: string }} input 解析输入
 * @returns {string} 展示名（别名 → 自声明名 → 兜底）
 */
export function resolveDisplayName({ entityHash, alias, profileName, fallbackLabel } = {}) {
	const aliasName = String(alias || '').trim()
	if (aliasName) return aliasName
	const profile = String(profileName || '').trim()
	if (profile) return profile
	const fallback = String(fallbackLabel || '').trim()
	if (fallback) return fallback
	return entityHash ? entityHashLabel(entityHash) : '?'
}

/**
 * 同名消歧：label 冲突者追加 `·${entityHash.slice(64, 68)}` 后缀。
 * @param {Array<{ label: string, entityHash?: string }>} items 待消歧条目
 * @returns {string[]} 与 items 同序的消歧后 label
 */
export function disambiguateLabels(items) {
	const counts = new Map()
	for (const item of items) {
		const label = String(item?.label || '')
		counts.set(label, (counts.get(label) || 0) + 1)
	}
	return items.map(item => {
		const label = String(item?.label || '')
		if ((counts.get(label) || 0) <= 1) return label
		const hash = String(item?.entityHash || '')
		const suffix = hash.slice(64, 68)
		return suffix ? `${label}·${suffix}` : label
	})
}
