import fs from 'node:fs'
import process from 'node:process'
import { setInterval } from 'node:timers'

import { exec } from 'npm:@steve02081504/exec'
import { console as baseConsole } from 'npm:@steve02081504/virtual-console'
import supportsAnsi from 'npm:supports-ansi'

import { __dirname } from '../../server/base.mjs'
import { loadJsonFile } from '../json_loader.mjs'
import { ms } from '../ms.mjs'
import { escapeRegExp } from '../regex.mjs'

/**
 * 区域设置数据
 * @typedef {import('../../decl/locale_data.ts').LocaleData} LocaleData
 * 区域设置键
 * @typedef {import('../../decl/locale_data.ts').LocaleKey} LocaleKey
 * 无参数的区域设置键
 * @typedef {import('../../decl/locale_data.ts').LocaleKeyWithoutParams} LocaleKeyWithoutParams
 * 有参数的区域设置键
 * @typedef {import('../../decl/locale_data.ts').LocaleKeyWithParams} LocaleKeyWithParams
 * 对应键的区域设置参数类型
 * @typedef {import('../../decl/locale_data.ts').LocaleKeyParams} LocaleKeyParams
 */

/** @type {Set<(locale: string) => void>} */
const localeFileChangeListeners = new Set()

/**
 * locale JSON 文件变更时回调（由 index.mjs 注册 server 广播等）。
 * @param {(locale: string) => void} fn 回调
 * @returns {() => void} 取消注册
 */
export function onLocaleFileChanged(fn) {
	localeFileChangeListeners.add(fn)
	return () => localeFileChangeListeners.delete(fn)
}

/**
 * 导出的控制台对象。
 * @type {Console}
 */
export const console = baseConsole
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
		if (available.has(preferred))
			return preferred

		const prefix = preferred.split('-')[0]
		for (const locale of available)
			if (locale.startsWith(prefix))
				return locale
	}

	return 'en-UK'
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

	if (!fountLocaleCache[locale]) return
	delete fountLocaleCache[locale]
	localhostLocaleData = getLocaleData(localhostLocales)
	for (const fn of localeFileChangeListeners) fn(locale)
}).unref()

if (!process.env.FOUNT_TEST && localhostLocales[0] === 'zh-CN')
	setInterval(() => {
		if (new Date().getDay() === 4)
			console.error('%cException Error Syntax Unexpected string: Crazy Thursday vivo 50', 'color: red')
	}, ms('5m')).unref()

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
 * 对不含字面义占位符片段的字符串做插值（链接、参数占位符、反引号）。
 * @param {string} segment - 翻译片段。
 * @param {Record<string, any>} params - 插值参数。
 * @param {boolean} terminal - 是否渲染为终端序列（ANSI 链接与紫色反引号）。
 * @returns {string} 插值后的片段字符串。
 */
function applyInterpolationToPlainSegment(segment, params, terminal) {
	let result = segment
	if (terminal && supportsAnsi) {
		for (const key in params) {
			const escapedKey = escapeRegExp(key)
			result = result.replace(
				new RegExp(`\\[([^\\]]+)\\]\\(\\$\\{${escapedKey}\\}\\)`, 'g'),
				(match, text) => ansiLink(params[key], text)
			)
			const paramPlaceholderRegex = new RegExp(`\\$\\{${escapedKey}\\}`, 'g')
			result = result.replace(paramPlaceholderRegex, () => params[key])
		}
		result = result.replace(/`([^`]*)`/g, `${ANSI_MAGENTA}$1${ANSI_RESET}`)
	}
	else for (const key in params)
		result = result.replaceAll(`\${${key}}`, () => params[key])
	return result
}

/**
 * 对单条翻译字符串做插值（链接、占位符、反引号）。
 * @template TTranslation
 * @param {TTranslation} translation - 原始翻译字符串或嵌套对象。
 * @param {Record<string, any>} params - 插值参数。
 * @param {boolean} [terminal] - 是否渲染为终端序列（ANSI 链接与紫色反引号）。
 * @returns {TTranslation} 替换后的翻译字符串或原对象。
 */
function applyParamsToTranslation(translation, params, terminal = false) {
	if (Array.isArray(translation)) return createI18nArrayProxy(translation, params, terminal)
	if (!translation || !(Object(translation) instanceof String)) return translation
	const translationText = translation + ''
	let result = ''
	let scanIndex = 0
	while (scanIndex < translationText.length) {
		const literalEscapeStart = translationText.indexOf('\\${', scanIndex)
		const plainSegmentEnd = literalEscapeStart === -1 ? translationText.length : literalEscapeStart
		result += applyInterpolationToPlainSegment(
			translationText.slice(scanIndex, plainSegmentEnd),
			params,
			terminal
		)
		if (literalEscapeStart === -1) break
		const closingBraceIndex = translationText.indexOf('}', literalEscapeStart + 3)
		if (closingBraceIndex === -1) {
			result += translationText.slice(literalEscapeStart)
			break
		}
		result += translationText.slice(literalEscapeStart + 1, closingBraceIndex + 1)
		scanIndex = closingBraceIndex + 1
	}
	return result
}

/**
 * 为翻译数组创建代理：toString 随机选一项并渲染，下标访问返回该项的渲染结果。
 * @param {string[]} arr - 原始翻译字符串数组。
 * @param {Record<string, any>} params - 插值参数。
 * @param {boolean} [terminal] - 是否渲染为终端序列（ANSI 链接与紫色反引号）。
 * @returns {string[]} 代理后的数组（toString 与下标访问为渲染结果）。
 */
function createI18nArrayProxy(arr, params, terminal = false) {
	return new Proxy(arr, {
		/**
		 * @param {string[]} target 原始数组
		 * @param {string | symbol} prop 属性名
		 * @returns {unknown} 属性值
		 */
		get(target, prop) {
			if (prop === 'toString')
				return function toString() {
					if (!target.length) throw new Error('I18n array is empty')
					const i = Math.floor(Math.random() * target.length)
					return applyParamsToTranslation(target[i], params, terminal) ?? ''
				}
			try {
				const n = Number(prop)
				if (Number.isInteger(n) && n >= 0 && n < target.length)
					return applyParamsToTranslation(target[n], params, terminal)
			} catch (_) { }
			return Reflect.get(target, prop)
		},
	})
}

/**
 * 获取区域设置数据中的翻译文本。
 * @param {LocaleData} localeData - 区域设置数据。
 * @param {LocaleKey} key - 翻译键。
 * @param {object} [params] - 可选的参数，用于插值（例如 {name: "John"}）。
 * @param {boolean} [terminal] - 是否渲染为终端序列（ANSI 链接与紫色反引号）。
 * @returns {string} - 翻译后的文本。
 */
function baseGeti18n(localeData, key, params = {}, terminal = false) {
	const translation = getNestedValue(localeData, key)
	if (translation === undefined) {
		console.warn(`Translation key "${key}" not found.`)
		return undefined
	}
	return applyParamsToTranslation(translation, params, terminal)
}

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
 * 从已合并的 LocaleData 对象取翻译。
 * @param {LocaleData} localeData 区域设置数据
 * @param {LocaleKey} key 翻译键
 * @param {object} [params] 插值参数
 * @returns {string} 翻译文本
 */
export function geti18nFromLocaleData(localeData, key, params = {}) {
	return baseGeti18n(localeData, key, params)
}

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
 * 获取渲染为终端序列的翻译文本（链接用 OSC 8，`xxx` 用 ANSI 紫色）。
 * @param {LocaleKey} key - 翻译键。
 * @param {object} [params] - 可选的参数，用于插值（例如 {name: "John"}）。
 * @returns {string} - 渲染为终端序列的翻译文本。
 */
export function geti18nForTerminal(key, params = {}) {
	return baseGeti18n(localhostLocaleData, key, params, true)
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
 *
 * @param {string} key 键
 * @param {Record<string, unknown>} [params] 插值参数
 * @returns {void} 无
 */
console.infoI18n = (key, params = {}) => {
	try {
		console.stackFrameSkipCount++
		console.info(toString(geti18nForTerminal(key, params)))
	} finally {
		console.stackFrameSkipCount--
	}
}

/**
 *
 * @param {string} key 键
 * @param {Record<string, unknown>} [params] 插值参数
 * @returns {void} 无
 */
console.logI18n = (key, params = {}) => {
	try {
		console.stackFrameSkipCount++
		console.log(toString(geti18nForTerminal(key, params)))
	} finally {
		console.stackFrameSkipCount--
	}
}

/**
 *
 * @param {string} key 键
 * @param {Record<string, unknown>} [params] 插值参数
 * @returns {void} 无
 */
console.warnI18n = (key, params = {}) => {
	try {
		console.stackFrameSkipCount++
		console.warn(toString(geti18nForTerminal(key, params)))
	} finally {
		console.stackFrameSkipCount--
	}
}

/**
 *
 * @param {string} key 键
 * @param {Record<string, unknown>} [params] 插值参数
 * @returns {void} 无
 */
console.errorI18n = (key, params = {}) => {
	try {
		console.stackFrameSkipCount++
		console.error(toString(geti18nForTerminal(key, params)))
	} finally {
		console.stackFrameSkipCount--
	}
}

/**
 *
 * @param {string} id 标识
 * @param {string} key 键
 * @param {Record<string, unknown>} [params] 插值参数
 * @returns {void} 无
 */
console.freshLineI18n = (id, key, params = {}) => {
	try {
		console.stackFrameSkipCount++
		console.freshLine(id, toString(geti18nForTerminal(key, params)))
	} finally {
		console.stackFrameSkipCount--
	}
}

/**
 * 使用 i18n 显示警报。
 * @param {LocaleKey} key - 翻译键。
 * @param {object} [params] - 可选的参数，用于插值。
 * @returns {void} 无
 */
export function alertI18n(key, params = {}) {
	return alert(toString(geti18n(key, params)))
}

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
 * 使用 i18n 显示确认。
 * @param {LocaleKey} key - 翻译键。
 * @param {object} [params] - 可选的参数，用于插值。
 * @returns {boolean} 如果用户点击确定则返回true，否则返回false。
 */
export function confirmI18n(key, params = {}) {
	return confirm(toString(geti18n(key, params)))
}
