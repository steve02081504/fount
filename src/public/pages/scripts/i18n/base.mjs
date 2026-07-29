import { onServerEvent } from '../api/server_events.mjs'

import {
	loadPreferredLangs,
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

/** preferred → { bundle, locale }；语种轮换时免重复拉包 */
const localeBundleCache = new Map()
/** preferred → 进行中的拉取 Promise；并发同 key 去重 */
const localeBundleInflight = new Map()
/** locale-updated 递增；过期请求不得回填 cache / 误删新 inflight */
let localeBundleEpoch = 0

/**
 * 按首选链拉取一份 locale bundle（不写 DOM / 不改偏好）。
 * @param {string[]} preferredLangs 首选语言列表
 * @returns {Promise<object>} locale JSON
 */
export async function loadLocaleData(preferredLangs) {
	const cacheKey = preferredLangs.join(',')
	const cached = localeBundleCache.get(cacheKey)
	if (cached) return cached.bundle
	const inflight = localeBundleInflight.get(cacheKey)
	if (inflight) return inflight

	const epoch = localeBundleEpoch
	const request = (async () => {
		const url = new URL('/api/getlocaledata', location.origin)
		url.searchParams.set('preferred', preferredLangs.join(','))
		const [response, available] = await Promise.all([
			fetch(url),
			getAvailableLocales(),
		])
		if (!response.ok)
			throw new Error(`Failed to fetch translations: ${response.status} ${response.statusText}`)
		const locale = getBestLocale(
			[...preferredLangs, navigator.language, ...navigator.languages || []],
			available,
		)
		const result = { bundle: await response.json(), locale }
		if (epoch === localeBundleEpoch)
			localeBundleCache.set(cacheKey, result)
		return result.bundle
	})()
	localeBundleInflight.set(cacheKey, request)
	try {
		return await request
	}
	finally {
		if (localeBundleInflight.get(cacheKey) === request)
			localeBundleInflight.delete(cacheKey)
	}
}

/**
 * 从服务器获取多语言数据并初始化翻译。
 * @param {string} [pageid] - 页面 ID。
 * @param {string[]} [preferredLangs] - 用户优先语言列表。
 * @returns {Promise<void>}
 */
export async function initTranslations(pageid = saved_pageid, preferredLangs = loadPreferredLangs()) {
	await runInitTranslations(pageid, preferredLangs, async () => {
		const cacheKey = preferredLangs.join(',')
		await loadLocaleData(preferredLangs)
		return localeBundleCache.get(cacheKey)
	})
}

onServerEvent('locale-updated', async () => {
	localeBundleEpoch++
	localeBundleCache.clear()
	localeBundleInflight.clear()
	await initTranslations()
})
