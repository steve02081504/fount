
/**
 * Gets localized information from a part's info object based on the provided locales.
 *
 * @template T
 * @param {Record<string, T>} [info] - The part's info object, potentially undefined.
 * @param {string[]} [locales] - The locale string array (e.g., 'en-US', 'zh-CN').
 * @returns {T | undefined} Localized information, or undefined if info is missing.
 */
export function getLocalizedInfo(info, locales) {
	if (!info) return
	if (locales)
		for (const locale of locales) {
			const result = info[locale] || info[locale?.split('-')?.[0]] || info[Object.keys(info).find(key => key.startsWith(locale?.split('-')?.[0] + '-'))]
			if (result) return result
		}
	return info[Object.keys(info)[0]]
}

/**
 * Gets localized part information for a given part and locales.
 *
 * @template T
 * @param {{ info: Record<string, T> }} part - The part object.
 * @param {string[]} [locales] - The locale string array (e.g., 'en-US', 'zh-CN').
 * @returns {T | undefined} Localized part information, or undefined if info is missing.
 */
export function getPartInfo(part, locales) {
	return getLocalizedInfo(part?.info, locales)
}
