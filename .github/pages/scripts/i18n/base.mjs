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
 * 初始化翻译资源。
 * @param {string} [pageid] 页面 ID。
 * @param {string[]} [preferredLangs] 首选语言列表。
 * @returns {Promise<void>}
 */
export async function initTranslations(pageid = saved_pageid, preferredLangs = loadPreferredLangs()) {
	await runInitTranslations(pageid, preferredLangs, async () => {
		const listRes = await fetch(base_dir + '/locales/list.csv')
		if (listRes.ok) {
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
		else
			console.warn('Could not fetch locales list.csv, language names will not be available.')

		const lang = getBestLocale(
			[...preferredLangs, ...navigator.languages || [navigator.language]],
			availableLocales,
		)
		const translationResponse = await fetch(base_dir + `/locales/${lang}.json`)
		if (!translationResponse.ok)
			throw new Error(`Failed to fetch translations: ${translationResponse.status} ${translationResponse.statusText}`)
		return { bundle: await translationResponse.json(), locale: lang }
	})
}
