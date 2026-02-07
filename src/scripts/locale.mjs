/**
 * 根据提供的区域设置从部件的信息对象中获取本地化信息。
 *
 * @template T
 * @param {Record<string, T>} [info] - 部件的信息对象，可能未定义。
 * @param {string[]} [locales] - 区域设置字符串数组 (例如, 'en-US', 'zh-CN')。
 * @returns {T | undefined} 本地化信息，如果信息缺失则为 undefined。
 */
export function getLocalizedInfo(info, locales) {
	if (!info) return
	if (locales) for (const locale of locales) {
		const result = info[locale] || info[locale?.split('-')?.[0]] || info[Object.keys(info).find(key => key.startsWith(locale?.split('-')?.[0] + '-'))]
		if (result) return result
	}
	return info[Object.keys(info)[0]]
}

/**
 * 获取给定部件和区域设置的本地化部件信息。
 *
 * @template T
 * @param {{ info: Record<string, T> }} part - 部件对象。
 * @param {string[]} [locales] - 区域设置字符串数组 (例如, 'en-US', 'zh-CN')。
 * @returns {T | undefined} 本地化部件信息，如果信息缺失则为 undefined。
 */
export async function getPartInfo(part, locales) {
	const info = await part?.interfaces?.info?.UpdateInfo?.() || part?.info
	return getLocalizedInfo(info, locales)
}
