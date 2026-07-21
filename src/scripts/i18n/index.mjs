export * from './bare.mjs'

import fs from 'node:fs'
import path from 'node:path'

import { events } from '../../server/events.mjs'
import { getRegistry } from '../../server/registries.mjs'
import { loadData, saveData } from '../../server/setting_loader.mjs'
import { sendEventToAll } from '../../server/web_server/event_dispatcher.mjs'
import { loadJsonFile } from '../json_loader.mjs'
import { localesForUser } from '../locale.mjs'

import {
	getbestlocale,
	geti18nFromLocaleData,
	getLocaleData,
	localhostLocales,
	onLocaleFileChanged,
} from './bare.mjs'

/**
 * 区域设置数据
 * @typedef {import('../../decl/locale_data.ts').LocaleData} LocaleData
 * 区域设置键
 * @typedef {import('../../decl/locale_data.ts').LocaleKey} LocaleKey
 */

/**
 * 获取用户的区域设置数据。
 * @param {string} username - 用户的用户名。
 * @param {string[]} preferredlocaleList - 首选区域设置的列表。
 * @returns {Promise<LocaleData>} 一个解析为区域设置数据的承诺。
 */
export async function getLocaleDataForUser(username, preferredlocaleList) {
	if (!username) return getLocaleData(preferredlocaleList)
	const effectivePreferred = [
		...localesForUser(username),
		...preferredlocaleList,
	]
	const result = {
		...getLocaleData(effectivePreferred)
	}
	const partsLocaleCache = loadData(username, 'parts_locales_cache')
	for (const entry of getRegistry(username, 'locales', { resolve: 'fs' }).sort((a, b) => (a.level ?? 0) - (b.level ?? 0))) {
		const fsPath = entry.path
		if (!fs.existsSync(fsPath)) continue
		/** @type {LocaleData} */
		let partdata
		if (fs.statSync(fsPath).isDirectory()) {
			const localeFiles = fs.readdirSync(fsPath).filter(f => f.endsWith('.json'))
			const resultLocale = getbestlocale(effectivePreferred, localeFiles.map(f => ({ id: f.slice(0, -5) })))
			partsLocaleCache[entry.partpath] ??= {}
			partdata = partsLocaleCache[entry.partpath][resultLocale]
				??= loadJsonFile(path.join(fsPath, `${resultLocale}.json`))
		}
		else
			partdata = loadJsonFile(fsPath)
		Object.assign(result, partdata)
	}
	saveData(username, 'parts_locales_cache')
	return result
}

events.on('part-loaded', ({ username, partpath }) => {
	delete loadData(username, 'parts_locales_cache')[partpath]
})
events.on('part-uninstalled', ({ username, partpath }) => {
	delete loadData(username, 'parts_locales_cache')[partpath]
	saveData(username, 'parts_locales_cache')
})

onLocaleFileChanged(() => {
	sendEventToAll('locale-updated', null)
})

/**
 * 根据用户名和翻译键获取翻译后的文本。
 * @param {string} username - 用户名。
 * @param {LocaleKey} key - 翻译键。
 * @param {object} [params] - 可选的参数，用于插值（例如 {name: "John"}）。
 * @returns {Promise<string>} - 翻译后的文本。
 */
export async function geti18nForUser(username, key, params = {}) {
	return geti18nFromLocaleData(await getLocaleDataForUser(username, localhostLocales), key, params)
}
