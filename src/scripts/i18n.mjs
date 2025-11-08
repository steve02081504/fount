import fs from 'node:fs'
import process from 'node:process'

import { console as baseConsole } from 'npm:@steve02081504/virtual-console'

import { __dirname } from '../server/base.mjs'
import { events } from '../server/events.mjs'
import { loadData, loadTempData, saveData } from '../server/setting_loader.mjs'
import { sendEventToAll } from '../server/web_server/event_dispatcher.mjs'

import { exec } from './exec.mjs'
import { loadJsonFile } from './json_loader.mjs'

const console = baseConsole
/**
 * 所有可用区域设置的列表。
 * @type {{id: string, name: string}[]}
 */
export const fountLocaleList = fs.readFileSync(__dirname + '/src/locales/list.csv', 'utf8')
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
 * @returns {Promise<object>} 一个解析为区域设置数据的承诺。
 */
export async function getLocaleData(username, preferredlocaleList) {
	const resultLocale = getbestlocale(preferredlocaleList, fountLocaleList)
	const result = {
		...fountLocaleCache[resultLocale] ??= loadJsonFile(__dirname + `/src/locales/${resultLocale}.json`)
	}
	if (!username) return result
	const partsLocaleLists = loadData(username, 'parts_locale_lists_cache')
	const partsLocaleCache = loadData(username, 'parts_locales_cache')
	const partsLocaleLoaders = loadTempData(username, 'parts_locale_loaders')
	for (const parttype in partsLocaleLists) for (const partname in partsLocaleLists[parttype]) {
		const resultLocale = getbestlocale(preferredlocaleList, partsLocaleLists[parttype][partname])
		partsLocaleCache[parttype] ??= {}
		partsLocaleCache[parttype][partname] ??= {}
		const partdata = partsLocaleCache[parttype][partname][resultLocale] ??= await partsLocaleLoaders[parttype]?.[partname]?.(resultLocale)
		Object.assign(result, partdata)
	}
	saveData(username, 'parts_locales_cache')
	return result
}
events.on('part-loaded', ({ username, parttype, partname }) => {
	delete loadData(username, 'parts_locales_cache')?.[parttype]?.[partname]
})
events.on('part-uninstalled', ({ username, parttype, partname }) => {
	delete loadData(username, 'parts_locales_cache')[parttype]?.[partname]
	saveData(username, 'parts_locales_cache')
	delete loadData(username, 'parts_locale_lists_cache')[parttype]?.[partname]
	saveData(username, 'parts_locale_lists_cache')
	delete loadTempData(username, 'parts_locale_loaders')[parttype]?.[partname]
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
 * @type {object}
 */
export let localhostLocaleData = await getLocaleData(null, localhostLocales)

fs.watch(`${__dirname}/src/locales`, (_event, filename) => {
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
 * @param {string} parttype - 部件的类型。
 * @param {string} partname - 部件的名称。
 * @param {string[]} localeList - 部件的可用区域设置列表。
 * @param {Function} loader - 加载部件区域设置数据的函数。
 * @returns {void}
 */
export function addPartLocaleData(username, parttype, partname, localeList, loader) {
	const partsLocaleLists = loadData(username, 'parts_locale_lists_cache')
	const partsLocaleLoaders = loadTempData(username, 'parts_locale_loaders')
	; (partsLocaleLists[parttype] ??= {})[partname] = localeList
	; (partsLocaleLoaders[parttype] ??= {})[partname] = loader
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
 * 根据提供的键（key）获取翻译后的文本。
 * @param {string} key - 翻译键。
 * @param {object} [params] - 可选的参数，用于插值（例如 {name: "John"}）。
 * @returns {Promise<string>} - 翻译后的文本，如果未找到则返回键本身。
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
 * 使用 i18n 打印参考消息。
 * @param {string} key - 翻译键。
 * @param {object} [params] - 可选的参数，用于插值。
 * @returns {void}
 */
console.infoI18n = (key, params = {}) => console.info(geti18n(key, params))
/**
 * 使用 i18n 打印日志消息。
 * @param {string} key - 翻译键。
 * @param {object} [params] - 可选的参数，用于插值。
 * @returns {void}
 */
console.logI18n = (key, params = {}) => console.log(geti18n(key, params))
/**
 * 使用 i18n 打印警告消息。
 * @param {string} key - 翻译键。
 * @param {object} [params] - 可选的参数，用于插值。
 * @returns {void}
 */
console.warnI18n = (key, params = {}) => console.warn(geti18n(key, params))
/**
 * 使用 i18n 打印错误消息。
 * @param {string} key - 翻译键。
 * @param {object} [params] - 可选的参数，用于插值。
 * @returns {void}
 */
console.errorI18n = (key, params = {}) => console.error(geti18n(key, params))
/**
 * 使用 i18n 在新行上打印消息。
 * @param {string} id - 新行的唯一标识符。
 * @param {string} key - 翻译键。
 * @param {object} [params] - 可选的参数，用于插值。
 * @returns {void}
 */
console.freshLineI18n = (id, key, params = {}) => console.freshLine(id, geti18n(key, params))
/**
 * 使用 i18n 显示警报。
 * @param {string} key - 翻译键。
 * @param {object} [params] - 可选的参数，用于插值。
 * @returns {void}
 */
export function alertI18n(key, params = {}) {
	return alert(geti18n(key, params))
}
/**
 * 使用 i18n 显示提示。
 * @param {string} key - 翻译键。
 * @param {object} [params] - 可选的参数，用于插值。
 * @returns {string | null} 用户输入或null。
 */
export function promptI18n(key, params = {}) {
	return prompt(geti18n(key, params))
}
/**
 * 使用 i18n 显示确认。
 * @param {string} key - 翻译键。
 * @param {object} [params] - 可选的参数，用于插值。
 * @returns {boolean} 如果用户点击确定则返回true，否则返回false。
 */
export function confirmI18n(key, params = {}) {
	return confirm(geti18n(key, params))
}
/**
 * 导出的控制台对象。
 */
export { console }
