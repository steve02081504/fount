import { getUserByUsername } from '../server/auth/index.mjs'

import { FALLBACK_LOCALE, pickLocalizedSlice } from './i18n/locale_match.mjs'

/**
 *
 */
export { FALLBACK_LOCALE, pickLocalizedSlice }

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
 * 获取给定部件和区域设置的本地化部件信息。
 *
 * @template T
 * @param {{ info: Record<string, T> }} part - 部件对象。
 * @param {string[]} [locales] - 区域设置字符串数组 (例如, 'en-US', 'zh-CN')。
 * @returns {T | undefined} 本地化部件信息，如果信息缺失则为 undefined。
 */
export async function getPartInfo(part, locales) {
	const info = await part?.interfaces?.info?.UpdateInfo?.() || part?.info
	return pickLocalizedSlice(info, locales)
}
