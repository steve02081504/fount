import { base_dir } from '../../base.mjs'

import {
	getBestLocale,
	loadPreferredLangs,
	runInitTranslations,
	saved_pageid,
} from './index.mjs'

/** localStorage 中保存首选语言的键名（静态 Pages） */
export const preferredLangsStorageKey = 'fountUserPreferredLanguages'

let availableLocales = []
const localeNames = new Map()

/** locale → bundle */
const localeBundleCache = new Map()
/** locale → 进行中的拉取 Promise；并发同语种去重 */
const localeBundleInflight = new Map()

/**
 * 获取可用的 locale 代码列表。
 * @returns {string[]} 可用的 locale 代码列表。
 */
export function getAvailableLocales() {
	return availableLocales
}

/**
 * 获取 locale 代码到显示名的映射。
 * @returns {Map<string, string>} locale 代码到显示名的映射。
 */
export function getLocaleNames() {
	return localeNames
}

/**
 * 确保 list.csv 已加载（供 getBestLocale / 语言选择器用）。
 * @returns {Promise<void>}
 */
async function ensureLocaleList() {
	if (availableLocales.length) return
	const listRes = await fetch(base_dir + '/locales/list.csv')
	if (!listRes.ok) {
		console.warn('Could not fetch locales list.csv, language names will not be available.')
		return
	}
	const lines = (await listRes.text()).split('\n').slice(1)
	availableLocales = []
	for (const line of lines) {
		const [code, name] = line.split(',').map(item => item.trim())
		if (code && name) {
			availableLocales.push(code)
			localeNames.set(code, name)
		}
	}
}

/**
 * 按首选链拉取一份静态 locale JSON（不写 DOM / 不改偏好）。
 * @param {string[]} preferredLangs 首选语言列表
 * @returns {Promise<object>} locale JSON
 */
export async function loadLocaleData(preferredLangs) {
	await ensureLocaleList()
	const lang = preferredLangs.length === 1 && availableLocales.includes(preferredLangs[0])
		? preferredLangs[0]
		: getBestLocale(
			[...preferredLangs, ...navigator.languages || [navigator.language]],
			availableLocales,
		)
	const cached = localeBundleCache.get(lang)
	if (cached) return cached
	const inflight = localeBundleInflight.get(lang)
	if (inflight) return inflight

	const request = (async () => {
		const translationResponse = await fetch(base_dir + `/locales/${lang}.json`)
		if (!translationResponse.ok)
			throw new Error(`Failed to fetch translations: ${translationResponse.status} ${translationResponse.statusText}`)
		const bundle = await translationResponse.json()
		localeBundleCache.set(lang, bundle)
		return bundle
	})()
	localeBundleInflight.set(lang, request)
	try {
		return await request
	}
	finally {
		localeBundleInflight.delete(lang)
	}
}

/**
 * 初始化翻译资源。
 * @param {string} [pageid] 页面 ID。
 * @param {string[]} [preferredLangs] 首选语言列表。
 * @returns {Promise<void>}
 */
export async function initTranslations(pageid = saved_pageid, preferredLangs = loadPreferredLangs()) {
	await runInitTranslations(pageid, preferredLangs, async () => {
		await ensureLocaleList()
		const lang = getBestLocale(
			[...preferredLangs, ...navigator.languages || [navigator.language]],
			availableLocales,
		)
		const bundle = await loadLocaleData([lang])
		return { bundle, locale: lang }
	})
}
