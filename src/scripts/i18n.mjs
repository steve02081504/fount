import fs from 'node:fs'
import process from 'node:process'
import { setInterval } from 'node:timers'

import { exec } from 'npm:@steve02081504/exec'
import { console as baseConsole } from 'npm:@steve02081504/virtual-console'
import supportsAnsi from 'npm:supports-ansi'

import { getUserByUsername } from '../server/auth.mjs'
import { __dirname } from '../server/base.mjs'
import { events } from '../server/events.mjs'
import { loadData, loadTempData, saveData } from '../server/setting_loader.mjs'
import { sendEventToAll } from '../server/web_server/event_dispatcher.mjs'

import { loadJsonFile } from './json_loader.mjs'
import { ms } from './ms.mjs'

/**
 * @typedef {import('../decl/locale_data.ts').LocaleData} LocaleData
 * @typedef {import('../decl/locale_data.ts').LocaleKey} LocaleKey
 * @typedef {import('../decl/locale_data.ts').LocaleKeyWithoutParams} LocaleKeyWithoutParams
 * @typedef {import('../decl/locale_data.ts').LocaleKeyWithParams} LocaleKeyWithParams
 * @typedef {import('../decl/locale_data.ts').LocaleKeyParams} LocaleKeyParams
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
 * 获取区域设置数据。
 * @param {string[]} localeList - 区域设置列表。
 * @returns {LocaleData} 区域设置数据。
 */
export function getLocaleData(localeList) {
	const resultLocale = getbestlocale(localeList, fountLocaleList)
	return fountLocaleCache[resultLocale] ?? loadJsonFile(__dirname + `/src/public/locales/${resultLocale}.json`)
}
/**
 * 获取用户的区域设置数据。
 * @param {string} username - 用户的用户名。
 * @param {string[]} preferredlocaleList - 首选区域设置的列表。
 * @returns {Promise<LocaleData>} 一个解析为区域设置数据的承诺。
 */
export async function getLocaleDataForUser(username, preferredlocaleList) {
	if (!username) return getLocaleData(preferredlocaleList)
	const result = {
		...getLocaleData([
			...preferredlocaleList ?? [],
			...getUserByUsername(username)?.locales ?? [],
		])
	}
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
export let localhostLocaleData = getLocaleData(localhostLocales)

fs.watch(`${__dirname}/src/public/locales`, (event, filename) => {
	if (!filename?.endsWith('.json')) return
	const locale = filename.slice(0, -5)
	console.log(`Detected change in ${filename}.`)

	// 清除已更改文件的缓存（如果存在）
	if (!fountLocaleCache[locale]) return
	delete fountLocaleCache[locale]
	localhostLocaleData = getLocaleData(localhostLocales)
	sendEventToAll('locale-updated', null)
})

// 疯狂星期四V我50
if (localhostLocales[0] === 'zh-CN')
	setInterval(() => {
		if (new Date().getDay() === 4)
			console.error('%cException Error Syntax Unexpected string: Crazy Thursday vivo 50', 'color: red')
	}, ms('5m')).unref()

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

/** ANSI 紫色（品红）。 */
const ANSI_MAGENTA = '\x1b[35m'
const ANSI_RESET = '\x1b[0m'
/**
 * OSC 8 超链接：\x1b]8;;url\x1b\\text\x1b]8;;\x1b\\
 * @param {string} url - 链接的 URL。
 * @param {string} text - 链接的文本。
 * @returns {string} - OSC 8 超链接。
 */
function ansiLink(url, text) {
	return `\x1b]8;;${url}\x1b\\${text}\x1b]8;;\x1b\\`
}

/**
 * 对单条翻译字符串做插值（占位符、链接、反引号）。
 * 若 supportsAnsi：链接用 OSC 8，`xxx` 用 ANSI 紫色；否则链接仅保留文字，反引号保持原样。
 * 若 translation 非字符串（如嵌套对象），则原样返回。
 * @template TTranslation - 翻译字符串或嵌套对象的类型。
 * @param {TTranslation} translation - 原始翻译字符串或嵌套对象。
 * @param {Record<string, any>} params - 插值参数。
 * @returns {TTranslation} 替换后的翻译字符串或原对象。
 */
function applyParamsToTranslation(translation, params) {
	if (Array.isArray(translation)) return createI18nArrayProxy(translation, params)
	if (!translation || !(Object(translation) instanceof String)) return translation
	let result = translation
	if (supportsAnsi) {
		for (const param in params)
			result = result?.replace?.(
				new RegExp(`\\[(?<text>.+)\\]\\(\\$\\{${param}\\}\\)`, 'g'),
				(_, text) => ansiLink(params[param], text)
			)?.replaceAll?.(`\${${param}}`, params[param])
		result = result?.replace?.(/`([^`]*)`/g, `${ANSI_MAGENTA}$1${ANSI_RESET}`)
	}
	else for (const param in params)
		result = result?.replaceAll?.(`\${${param}}`, params[param])
	return result
}

/**
 * 为翻译数组创建代理：toString 随机选一项并渲染，下标访问返回该项的渲染结果。
 * @param {string[]} arr - 原始翻译字符串数组。
 * @param {Record<string, any>} params - 插值参数。
 * @returns {string[]} 代理后的数组（toString 与下标访问为渲染结果）。
 */
function createI18nArrayProxy(arr, params) {
	return new Proxy(arr, {
		/**
		 * 获取翻译数组代理的值。
		 * @param {string[]} target - 原始翻译字符串数组。
		 * @param {string} prop - 属性名。
		 * @returns {string} - 属性值。
		 */
		get(target, prop) {
			if (prop === 'toString')
				return function toString() {
					if (!target.length) throw new Error('I18n array is empty')
					const i = Math.floor(Math.random() * target.length)
					return applyParamsToTranslation(target[i], params) ?? ''
				}
			try {
				const n = Number(prop)
				if (Number.isInteger(n) && n >= 0 && n < target.length)
					return applyParamsToTranslation(target[n], params)
			} catch (_) { }
			return Reflect.get(target, prop)
		},
	})
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
 * 获取区域设置数据中的翻译文本。
 * @param {LocaleData} localeData - 区域设置数据。
 * @param {LocaleKey} key - 翻译键。
 * @param {object} [params] - 可选的参数，用于插值（例如 {name: "John"}）。
 * @returns {string} - 翻译后的文本。
 */
function baseGeti18n(localeData, key, params = {}) {
	const translation = getNestedValue(localeData, key)
	if (translation === undefined) {
		console.warn(`Translation key "${key}" not found.`)
		return undefined
	}
	return applyParamsToTranslation(translation, params)
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
 * 根据首选区域设置列表和翻译键获取翻译后的文本。
 * @param {string[]} localeList - 区域设置列表。
 * @param {LocaleKey} key - 翻译键。
 * @param {object} [params] - 可选的参数，用于插值（例如 {name: "John"}）。
 * @returns {string} - 翻译后的文本。
 */
export function geti18nForLocales(localeList, key, params = {}) {
	return baseGeti18n(getLocaleData(localeList), key, params)
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
 * 根据用户名和翻译键获取翻译后的文本。
 * @param {string} username - 用户名。
 * @param {LocaleKey} key - 翻译键。
 * @param {object} [params] - 可选的参数，用于插值（例如 {name: "John"}）。
 * @returns {string} - 翻译后的文本。
 */
export async function geti18nForUser(username, key, params = {}) {
	return baseGeti18n(await getLocaleDataForUser(username), key, params)
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
 * 根据提供的键（key）获取翻译后的文本。
 * @param {LocaleKey} key - 翻译键。
 * @param {object} [params] - 可选的参数，用于插值（例如 {name: "John"}）。
 * @returns {string} - 翻译后的文本，如果未找到则返回键本身。
 */
export function geti18n(key, params = {}) {
	return baseGeti18n(localhostLocaleData, key, params)
}
/**
 * 将值转换为字符串。
 * @param {any} value - 要转换的值。
 * @returns {string} - 转换后的字符串。
 */
function toString(value) {
	return value + ''
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
console.infoI18n = (key, params = {}) => console.info(toString(geti18n(key, params)))
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
console.logI18n = (key, params = {}) => console.log(toString(geti18n(key, params)))
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
console.warnI18n = (key, params = {}) => console.warn(toString(geti18n(key, params)))
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
console.errorI18n = (key, params = {}) => console.error(toString(geti18n(key, params)))
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
console.freshLineI18n = (id, key, params = {}) => console.freshLine(id, toString(geti18n(key, params)))
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
	return alert(toString(geti18n(key, params)))
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
	return prompt(toString(geti18n(key, params)))
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
	return confirm(toString(geti18n(key, params)))
}
/**
 * 导出的控制台对象。
 * @type {Console}
 */
export { console }
