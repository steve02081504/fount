export * from './bare.mjs'

import { events } from '../../server/events.mjs'
import { loadData, loadTempData, saveData } from '../../server/setting_loader.mjs'
import { sendEventToAll } from '../../server/web_server/event_dispatcher.mjs'
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
		...preferredlocaleList ?? [],
	]
	const result = {
		...getLocaleData(effectivePreferred)
	}
	const partsLocaleLists = loadData(username, 'parts_locale_lists_cache')
	const partsLocaleCache = loadData(username, 'parts_locales_cache')
	const partsLocaleLoaders = loadTempData(username, 'parts_locale_loaders')
	const partpaths = Object.keys(partsLocaleLists)
	const partdataList = await Promise.all(partpaths.map(async partpath => {
		const resultLocale = getbestlocale(effectivePreferred, partsLocaleLists[partpath])
		partsLocaleCache[partpath] ??= {}
		return partsLocaleCache[partpath][resultLocale] ??= await partsLocaleLoaders[partpath]?.(resultLocale)
	}))
	for (const partdata of partdataList)
		Object.assign(result, partdata)
	saveData(username, 'parts_locales_cache')
	return result
}

events.on('part-loaded', ({ username, partpath }) => {
	delete loadData(username, 'parts_locales_cache')?.[partpath]
})
events.on('part-uninstalled', ({ username, partpath }) => {
	delete loadData(username, 'parts_locales_cache')?.[partpath]
	saveData(username, 'parts_locales_cache')
	delete loadData(username, 'parts_locale_lists_cache')?.[partpath]
	saveData(username, 'parts_locale_lists_cache')
	delete loadTempData(username, 'parts_locale_loaders')?.[partpath]
})

onLocaleFileChanged(() => {
	sendEventToAll('locale-updated', null)
})

/**
 * 为部件添加区域设置数据。
 * @param {string} username - 用户的用户名。
 * @param {string} partpath - 部件的路径（例如 'chars/GentianAphrodite'）。
 * @param {string[]} localeList - 部件的可用区域设置列表。
 * @param {Function} loader - 加载部件区域设置数据的函数。
 * @returns {void}
 */
export function addPartLocaleData(username, partpath, localeList, loader) {
	const partsLocaleLists = loadData(username, 'parts_locale_lists_cache')
	const partsLocaleLoaders = loadTempData(username, 'parts_locale_loaders')
	partsLocaleLists[partpath] = localeList
	partsLocaleLoaders[partpath] = loader
	saveData(username, 'parts_locale_lists_cache')
}

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
