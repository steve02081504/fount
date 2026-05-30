import {
	loadPreferredLangs,
	runInitTranslations,
	saved_pageid,
} from './i18n.mjs'
import { onServerEvent } from './server_events.mjs'

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
 * @returns {Map<string, string>} 空映射（静态 Pages 专用 API 的占位实现）。
 */
export function getLocaleNames() {
	return new Map()
}

/**
 * 从服务器获取多语言数据并初始化翻译。
 * @param {string} [pageid] - 页面 ID。
 * @param {string[]} [preferredLangs] - 用户优先语言列表。
 * @returns {Promise<void>}
 */
export async function initTranslations(pageid = saved_pageid, preferredLangs = loadPreferredLangs()) {
	await runInitTranslations(pageid, preferredLangs, async () => {
		const url = new URL('/api/getlocaledata', location.origin)
		url.searchParams.set('preferred', preferredLangs.join(','))
		const response = await fetch(url)
		if (!response.ok)
			throw new Error(`Failed to fetch translations: ${response.status} ${response.statusText}`)
		const locale = [...preferredLangs, navigator.language, ...navigator.languages, 'en-UK'].filter(Boolean)[0]
		return { bundle: await response.json(), locale }
	})
}

onServerEvent('locale-updated', async () => {
	console.log('Received locale update notification. Re-initializing translations...')
	await initTranslations()
})
