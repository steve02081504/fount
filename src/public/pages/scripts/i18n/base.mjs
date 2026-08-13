/**
 * 本机 fount 的 i18n bundle 加载（localStorage 首选语言 + /api/getlocaledata）。
 */
import { onServerEvent } from '../endpoints/server_events.mjs'
import { createEpochCache } from '../lib/epochCache.mjs'

import {
	loadPreferredLangs,
	primaryLocale,
	runInitTranslations,
	saved_pageid,
} from './index.mjs'
import { getBestLocale } from './locale_match.mjs'

/** localStorage 中保存首选语言的键名（本机 fount） */
export const preferredLangsStorageKey = 'userPreferredLanguages'

/**
 * 获取可用的区域设置列表。
 * @returns {Promise<object>} 可用 locale 数据。
 */
export async function getAvailableLocales() {
	const response = await fetch('/api/getavailablelocales')
	if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`)
	return response.json()
}

/**
 * 获取各语言区域的显示名称映射（静态 Pages 占位实现）。
 * @returns {Map<string, string>} 空映射（静态 Pages 专用 API 的占位实现）。
 */
export function getLocaleNames() {
	return new Map()
}

/** preferred → { bundle, locale }；locale-updated 时 bump 作废 */
const localeBundleCache = createEpochCache()

/**
 * @param {string[]} preferredLangs 首选语言列表
 * @returns {Promise<{ bundle: object, locale: string }>} bundle 与主 locale
 */
async function loadLocaleEntry(preferredLangs) {
	return localeBundleCache.get(preferredLangs.join(','), async () => {
		const url = new URL('/api/getlocaledata', location.origin)
		url.searchParams.set('preferred', preferredLangs.join(','))
		const [response, available] = await Promise.all([
			fetch(url),
			getAvailableLocales(),
		])
		if (!response.ok)
			throw new Error(`Failed to fetch translations: ${response.status} ${response.statusText}`)
		return {
			locale: getBestLocale(
				[...preferredLangs, primaryLocale()],
				available,
			),
			bundle: await response.json(),
		}
	})
}

/**
 * 按首选链拉取一份 locale bundle（不写 DOM / 不改偏好）。
 * @param {string[]} preferredLangs 首选语言列表
 * @returns {Promise<object>} locale JSON
 */
export async function loadLocaleData(preferredLangs) {
	return (await loadLocaleEntry(preferredLangs)).bundle
}

/**
 * 从服务器获取多语言数据并初始化翻译。
 * @param {string} [pageid] - 页面 ID。
 * @param {string[]} [preferredLangs] - 用户优先语言列表。
 * @returns {Promise<void>}
 */
export async function initTranslations(pageid = saved_pageid, preferredLangs = loadPreferredLangs()) {
	await runInitTranslations(pageid, preferredLangs, () => loadLocaleEntry(preferredLangs))
}

onServerEvent('locale-updated', async () => {
	localeBundleCache.bump()
	await initTranslations()
})
