import { getUserByUsername } from '../server/auth/index.mjs'

/** 无用户偏好时的最终兜底（产品默认英文）。 */
export const FALLBACK_LOCALE = 'en-UK'

/**
 * 用户首选 locale 列表；无偏好时仅 `[en-UK]`。
 * @param {string} [username] 登录名
 * @returns {string[]} locale 优先级
 */
export function localesForUser(username) {
	const userLocales = username ? getUserByUsername(username)?.locales : undefined
	if (Array.isArray(userLocales) && userLocales.length) return userLocales
	return [FALLBACK_LOCALE]
}

/**
 * 用户主 locale。
 * @param {string} [username] 登录名
 * @returns {string} BCP 47
 */
export function primaryLocaleForUser(username) {
	return localesForUser(username)[0]
}

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
