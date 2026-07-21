/**
 * 无 DOM 依赖的资料语言切片增改操作（Deno-pure / 浏览器均可）。
 */

/**
 * @param {Record<string, object>} localized 多语言表
 * @param {string} activeKey 新 locale 键
 * @param {string} [sourceKey] 要复制的 locale 键
 * @returns {Record<string, object>} 新表
 */
export function ensureLocaleEntry(localized, activeKey, sourceKey) {
	const key = String(activeKey || '').trim()
	if (!key || localized[key]) return localized
	const source = localized[sourceKey] || {}
	return {
		...localized,
		[key]: {
			...source,
			...Array.isArray(source.tags) ? { tags: [...source.tags] } : {},
			...Array.isArray(source.links) ? { links: source.links.map(link => ({ ...link })) } : {},
		},
	}
}

/**
 * @param {Record<string, object>} localized 多语言表
 * @param {string} oldKey 原 locale 键
 * @param {string} newKey 新 locale 键
 * @returns {Record<string, object>} 新表；目标键冲突时保持原表
 */
export function renameLocaleEntry(localized, oldKey, newKey) {
	const key = String(newKey || '').trim()
	if (!key || key === oldKey || !localized[oldKey] || localized[key]) return localized
	return Object.fromEntries(
		Object.entries(localized).map(([entryKey, value]) => [
			entryKey === oldKey ? key : entryKey,
			value,
		]),
	)
}
