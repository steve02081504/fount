import fs from 'node:fs'
import process from 'node:process'

import { exec } from 'npm:@steve02081504/exec'
import { console as baseConsole } from 'npm:@steve02081504/virtual-console'

import { __dirname } from '../server/base.mjs'
import { events } from '../server/events.mjs'
import { loadData, loadTempData, saveData } from '../server/setting_loader.mjs'
import { sendEventToAll } from '../server/web_server/event_dispatcher.mjs'

import { loadJsonFile } from './json_loader.mjs'

/**
 * @typedef {import('../../decl/locale_data.ts').LocaleData} LocaleData
 * @typedef {import('../../decl/locale_data.ts').LocaleKey} LocaleKey
 * @typedef {import('../../decl/locale_data.ts').LocaleKeyWithoutParams} LocaleKeyWithoutParams
 * @typedef {import('../../decl/locale_data.ts').LocaleKeyWithParams} LocaleKeyWithParams
 * @typedef {import('../../decl/locale_data.ts').LocaleKeyParams} LocaleKeyParams
 */

const console = baseConsole
/**
 * 所有可用区域设置的列表。
 * @type {{id: string, name: string}[]}
 */
export const fountLocaleList = fs.readFileSync(__dirname + '/src/public/locales/list.csv', 'utf8')
	.trim()
	.split('\n')
	.slice(1) // Skip header
	.map(line => {
		const [id, ...nameParts] = line.split(',')
		return { id: id.trim(), name: nameParts.join(',').trim() }
	})
	.filter(locale => locale.id)

/**
 * 从首选区域设置列表中获取最佳匹配的区域设置。
 * @param {string[]} preferredlocaleList - 首选区域设置的列表。
 * @param {{id: string}[]} localeList - 可用区域设置的列表。
 * @returns {string} 最佳匹配的区域设置。
 */
export function getbestlocale(preferredlocaleList, localeList) {
	const available = new Set(localeList.map(l => l?.id ?? l).filter(Boolean))

	for (const preferred of preferredlocaleList ?? []) {
		// 1. 完全匹配
		if (available.has(preferred))
			return preferred

		// 2. 部分匹配 (例如, 'en' 来自 'en-US')
		const prefix = preferred.split('-')[0]
		for (const locale of available)
			if (locale.startsWith(prefix))
				return locale
	}

	return 'en-UK' // 默认
}

const fountLocaleCache = {}

/**
 * 获取用户的区域设置数据。
 * @param {string} username - 用户的用户名。
 * @param {string[]} preferredlocaleList - 首选区域设置的列表。
 * @returns {Promise<LocaleData>} 一个解析为区域设置数据的承诺。
 */
export async function getLocaleData(username, preferredlocaleList) {
	const resultLocale = getbestlocale(preferredlocaleList, fountLocaleList)
	const result = {
		...fountLocaleCache[resultLocale] ??= loadJsonFile(__dirname + `/src/public/locales/${resultLocale}.json`)
	}
	if (!username) return result
	const partsLocaleLists = loadData(username, 'parts_locale_lists_cache')
	const partsLocaleCache = loadData(username, 'parts_locales_cache')
	const partsLocaleLoaders = loadTempData(username, 'parts_locale_loaders')
	for (const partpath in partsLocaleLists) {
		const resultLocale = getbestlocale(preferredlocaleList, partsLocaleLists[partpath])
		partsLocaleCache[partpath] ??= {}
		const partdata = partsLocaleCache[partpath][resultLocale] ??= await partsLocaleLoaders[partpath]?.(resultLocale)
		Object.assign(result, partdata)
	}
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

/**
 * 本地主机上所有可用区域设置的列表。
 * @type {string[]}
 */
export const localhostLocales = [...new Set([
	...[
		process.env.LANG,
		process.env.LANGUAGE,
		process.env.LC_ALL,
		await exec('locale -uU').then(r => r.stdout.trim()).catch(() => undefined),
	].filter(Boolean).map(locale => locale.split('.')[0].replace('_', '-')),
	...navigator.languages || [navigator.language],
	'en-UK',
].filter(Boolean))]
/**
 * 本地主机的区域设置数据。
 * @type {LocaleData}
 */
export let localhostLocaleData = await getLocaleData(null, localhostLocales)

fs.watch(`${__dirname}/src/public/locales`, (event, filename) => {
	if (!filename?.endsWith('.json')) return
	const locale = filename.slice(0, -5)
	console.log(`Detected change in ${filename}.`)

	// 清除已更改文件的缓存（如果存在）
	if (!fountLocaleCache[locale]) return
	delete fountLocaleCache[locale]
	getLocaleData(null, localhostLocales).then((data) => {
		localhostLocaleData = data
		sendEventToAll('locale-updated', null)
	})
})

// 疯狂星期四V我50
if (localhostLocales[0] === 'zh-CN')
	setInterval(() => {
		if (new Date().getDay() === 4)
			console.error('%cException Error Syntax Unexpected string: Crazy Thursday vivo 50', 'color: red')
	}, 5 * 60 * 1000)

/**
 * 为部件添加区域设置数据。
 * @param {string} username - 用户的用户名。
 * @param {string} partpath - 部件的路径（例如 'chars/GentianAphrodite'）。
 * @param {string[]} localeList - 部件的可用区域设置列表。
 * @param {Function} loader - 加载部件区域设置数据的函数。
 * @returns {void}
 */
export function addPartLocaleData(username, partpath, localeList, loader) {
	const normalizedPartpath = partpath.replace(/^\/+|\/+$/g, '')
	const partsLocaleLists = loadData(username, 'parts_locale_lists_cache')
	const partsLocaleLoaders = loadTempData(username, 'parts_locale_loaders')
	partsLocaleLists[normalizedPartpath] = localeList
	partsLocaleLoaders[normalizedPartpath] = loader
	saveData(username, 'parts_locale_lists_cache')
}

/**
 * 从对象中获取嵌套值。
 * @param {object} obj - 要从中获取值的对象。
 * @param {string} key - 要获取的值的键。
 * @returns {any} 键的值，如果键不存在则为 undefined。
 */
function getNestedValue(obj, key) {
	const keys = key.split('.')
	let value = obj
	for (const k of keys)
		if (value && value instanceof Object && k in value)
			value = value[k]
		else
			return undefined

	return value
}
/**
 * @overload
 * @template {LocaleKeyWithoutParams} TKey
 * @param {TKey} key
 * @param {Record<string, any>} [params]
 * @returns {string}
 */
/**
 * @overload
 * @template {LocaleKeyWithParams} TKey
 * @param {TKey} key
 * @param {LocaleKeyParams[TKey]} params
 * @returns {string}
 */
/**
 * 根据提供的键（key）获取翻译后的文本。
 * @param {LocaleKey} key - 翻译键。
 * @param {object} [params] - 可选的参数，用于插值（例如 {name: "John"}）。
 * @returns {string} - 翻译后的文本，如果未找到则返回键本身。
 */
export function geti18n(key, params = {}) {
	let translation = getNestedValue(localhostLocaleData, key)

	if (translation === undefined)
		console.warn(`Translation key "${key}" not found.`)

	// 简单的插值处理
	for (const param in params)
		translation = translation?.replaceAll?.(`\${${param}}`, params[param])

	return translation
}
/**
 * @overload
 * @template {LocaleKeyWithoutParams} TKey
 * @param {TKey} key
 * @param {Record<string, any>} [params]
 * @returns {void}
 */
/**
 * @overload
 * @template {LocaleKeyWithParams} TKey
 * @param {TKey} key
 * @param {LocaleKeyParams[TKey]} params
 * @returns {void}
 */
/**
 * 使用 i18n 打印参考消息。
 * @param {LocaleKey} key - 翻译键。
 * @param {object} [params] - 可选的参数，用于插值。
 * @returns {void}
 */
console.infoI18n = (key, params = {}) => console.info(geti18n(key, params))
/**
 * @overload
 * @template {LocaleKeyWithoutParams} TKey
 * @param {TKey} key
 * @param {Record<string, any>} [params]
 * @returns {void}
 */
/**
 * @overload
 * @template {LocaleKeyWithParams} TKey
 * @param {TKey} key
 * @param {LocaleKeyParams[TKey]} params
 * @returns {void}
 */
/**
 * 使用 i18n 打印日志消息。
 * @param {LocaleKey} key - 翻译键。
 * @param {object} [params] - 可选的参数，用于插值。
 * @returns {void}
 */
console.logI18n = (key, params = {}) => console.log(geti18n(key, params))
/**
 * @overload
 * @template {LocaleKeyWithoutParams} TKey
 * @param {TKey} key
 * @param {Record<string, any>} [params]
 * @returns {void}
 */
/**
 * @overload
 * @template {LocaleKeyWithParams} TKey
 * @param {TKey} key
 * @param {LocaleKeyParams[TKey]} params
 * @returns {void}
 */
/**
 * 使用 i18n 打印警告消息。
 * @param {LocaleKey} key - 翻译键。
 * @param {object} [params] - 可选的参数，用于插值。
 * @returns {void}
 */
console.warnI18n = (key, params = {}) => console.warn(geti18n(key, params))
/**
 * @overload
 * @template {LocaleKeyWithoutParams} TKey
 * @param {TKey} key
 * @param {Record<string, any>} [params]
 * @returns {void}
 */
/**
 * @overload
 * @template {LocaleKeyWithParams} TKey
 * @param {TKey} key
 * @param {LocaleKeyParams[TKey]} params
 * @returns {void}
 */
/**
 * 使用 i18n 打印错误消息。
 * @param {LocaleKey} key - 翻译键。
 * @param {object} [params] - 可选的参数，用于插值。
 * @returns {void}
 */
console.errorI18n = (key, params = {}) => console.error(geti18n(key, params))
/**
 * @overload
 * @template {LocaleKeyWithoutParams} TKey
 * @param {string} id
 * @param {TKey} key
 * @param {Record<string, any>} [params]
 * @returns {void}
 */
/**
 * @overload
 * @template {LocaleKeyWithParams} TKey
 * @param {string} id
 * @param {TKey} key
 * @param {LocaleKeyParams[TKey]} params
 * @returns {void}
 */
/**
 * 使用 i18n 在新行上打印消息。
 * @param {string} id - 新行的唯一标识符。
 * @param {LocaleKey} key - 翻译键。
 * @param {object} [params] - 可选的参数，用于插值。
 * @returns {void}
 */
console.freshLineI18n = (id, key, params = {}) => console.freshLine(id, geti18n(key, params))
/**
 * @overload
 * @template {LocaleKeyWithoutParams} TKey
 * @param {TKey} key
 * @param {Record<string, any>} [params]
 * @returns {void}
 */
/**
 * @overload
 * @template {LocaleKeyWithParams} TKey
 * @param {TKey} key
 * @param {LocaleKeyParams[TKey]} params
 * @returns {void}
 */
/**
 * 使用 i18n 显示警报。
 * @param {LocaleKey} key - 翻译键。
 * @param {object} [params] - 可选的参数，用于插值。
 * @returns {void}
 */
export function alertI18n(key, params = {}) {
	return alert(geti18n(key, params))
}
/**
 * @overload
 * @template {LocaleKeyWithoutParams} TKey
 * @param {TKey} key
 * @param {Record<string, any>} [params]
 * @returns {string | null}
 */
/**
 * @overload
 * @template {LocaleKeyWithParams} TKey
 * @param {TKey} key
 * @param {LocaleKeyParams[TKey]} params
 * @returns {string | null}
 */
/**
 * 使用 i18n 显示提示。
 * @param {LocaleKey} key - 翻译键。
 * @param {object} [params] - 可选的参数，用于插值。
 * @returns {string | null} 用户输入或null。
 */
export function promptI18n(key, params = {}) {
	return prompt(geti18n(key, params))
}
/**
 * @overload
 * @template {LocaleKeyWithoutParams} TKey
 * @param {TKey} key
 * @param {Record<string, any>} [params]
 * @returns {boolean}
 */
/**
 * @overload
 * @template {LocaleKeyWithParams} TKey
 * @param {TKey} key
 * @param {LocaleKeyParams[TKey]} params
 * @returns {boolean}
 */
/**
 * 使用 i18n 显示确认。
 * @param {LocaleKey} key - 翻译键。
 * @param {object} [params] - 可选的参数，用于插值。
 * @returns {boolean} 如果用户点击确定则返回true，否则返回false。
 */
export function confirmI18n(key, params = {}) {
	return confirm(geti18n(key, params))
}
/**
 * 导出的控制台对象。
 * @type {Console}
 */
export { console }
