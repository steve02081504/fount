import fs from 'node:fs'
import process from 'node:process'
import { clearTimeout, setInterval, setTimeout } from 'node:timers'

import { console as baseConsole } from 'npm:@steve02081504/virtual-console'
import supportsAnsi from 'npm:supports-ansi'

import { FALLBACK_LOCALE, getBestLocale } from '../../public/pages/scripts/i18n/locale_match.mjs'
import { collectMissingPlaceholders } from '../../public/pages/scripts/i18n/placeholders.mjs'
import { __dirname } from '../../server/base.mjs'
import { loadJsonFile } from '../json_loader.mjs'
import { ms } from '../ms.mjs'
import { escapeRegExp } from '../regex.mjs'

import { isSwitchValue, resolveSwitchCase } from './switch_value.mjs'

/** 重导出 locale 匹配与回退常量。 */
export {
	FALLBACK_LOCALE,
	getBestLocale,
	matchLocale,
	pickLocalizedSlice,
} from '../../public/pages/scripts/i18n/locale_match.mjs'

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

const FOUNT_LOCALES_DIR = `${__dirname}/src/public/locales`
/**
 * 所有可用区域设置的列表。
 * @type {{id: string, name: string}[]}
 */
export const fountLocaleList = fs.readFileSync(`${FOUNT_LOCALES_DIR}/list.csv`, 'utf8')
	.trim()
	.split('\n')
	.slice(1) // Skip header
	.map(line => {
		const [id, ...nameParts] = line.split(',')
		return { id: id.trim(), name: nameParts.join(',').trim() }
	})
	.filter(locale => locale.id)

const fountLocaleCache = {}

/**
 * 获取区域设置数据。
 * @param {string[]} localeList - 区域设置列表。
 * @returns {LocaleData} 区域设置数据。
 */
export function getLocaleData(localeList) {
	const resultLocale = getBestLocale(localeList, fountLocaleList)
	return fountLocaleCache[resultLocale] ??= loadJsonFile(`${FOUNT_LOCALES_DIR}/${resultLocale}.json`)
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
	].filter(Boolean).map(locale => locale.split('.')[0].replace('_', '-')),
	...navigator.languages || [navigator.language],
	FALLBACK_LOCALE,
].filter(Boolean))]
/**
 * 本地主机的区域设置数据。
 * @type {LocaleData}
 */
export let localhostLocaleData = getLocaleData(localhostLocales)

/**
 * 读取 locale JSON；写入方（`update-locales.py` / saveJsonFile）截断瞬间读到空或半截内容时返回 null。
 * @param {string} filename - 文件路径。
 * @returns {LocaleData | null} 解析结果；读不到完整 JSON 时为 null。
 */
function tryLoadLocaleFile(filename) {
	try {
		return loadJsonFile(filename)
	}
	catch {
		return null
	}
}

/** locale 重载防抖窗口（毫秒）：写入方先截断再写满，立刻读会拿到半截文件。 */
const LOCALE_RELOAD_DEBOUNCE_MS = 100
/** 半截 JSON 的额外重试次数（防抖之外的兜底）。 */
const LOCALE_RELOAD_ATTEMPTS = 3

/**
 * 创建 locale 重载调度器：同一 locale 的连续变更合并为一次重载，读到半截 JSON 时保留旧缓存并按退避重试。
 * 关键点：整个过程绝不向外抛错——在 `fs.watch` 回调里抛 `JSON.parse` 会变成未处理拒绝，
 * 把跑绿的套件标记成 noisy（见 `checks` 的噪声检测）。
 * @param {object} [options] - 选项。
 * @param {string} [options.dir] - locale 目录，默认 `FOUNT_LOCALES_DIR`。
 * @param {(filename: string) => LocaleData | null} [options.read] - 读取函数，默认容错读取。
 * @param {number} [options.debounceMs] - 防抖窗口。
 * @param {number} [options.attempts] - 最多尝试次数（含首次）。
 * @param {(locale: string, data: LocaleData) => void} [options.onReloaded] - 成功重载后回调。
 * @param {(locale: string) => void} [options.onGiveUp] - 尝试用尽仍未读到完整 JSON 时回调。
 * @returns {{ notify: (locale: string) => void, pending: () => number, stop: () => void }} 调度器。
 */
export function createLocaleReloadScheduler(options = {}) {
	const dir = options.dir ?? FOUNT_LOCALES_DIR
	const read = options.read ?? tryLoadLocaleFile
	const debounceMs = options.debounceMs ?? LOCALE_RELOAD_DEBOUNCE_MS
	const attempts = Math.max(1, options.attempts ?? LOCALE_RELOAD_ATTEMPTS)
	const onReloaded = options.onReloaded ?? (() => { })
	const onGiveUp = options.onGiveUp ?? (() => { })
	/** @type {Map<string, ReturnType<typeof setTimeout>>} */
	const timers = new Map()

	/**
	 * 读一次；拿不到完整 JSON 就按退避重排，重试仍失败则放弃并保留旧缓存。
	 * @param {string} locale - locale id。
	 * @param {number} attempt - 第几次尝试（0 起）。
	 * @returns {void} 无。
	 */
	function attemptReload(locale, attempt) {
		timers.delete(locale)
		const data = read(`${dir}/${locale}.json`)
		if (data == null) {
			if (attempt + 1 < attempts) {
				schedule(locale, attempt + 1)
				return
			}
			onGiveUp(locale)
			return
		}
		onReloaded(locale, data)
	}

	/**
	 * 排一次重载：同一 locale 已有待处理任务时先取消，避免写入过程中的连续事件反复重载。
	 * @param {string} locale - locale id。
	 * @param {number} attempt - 第几次尝试（0 起）。
	 * @returns {void} 无。
	 */
	function schedule(locale, attempt) {
		const existing = timers.get(locale)
		if (existing) clearTimeout(existing)
		const timer = setTimeout(() => attemptReload(locale, attempt), debounceMs * (attempt + 1))
		timer.unref?.()
		timers.set(locale, timer)
	}

	return {
		/**
		 * @param {string} locale - locale id。
		 * @returns {void} 无。
		 */
		notify(locale) {
			schedule(locale, 0)
		},
		/**
		 * @returns {number} 待处理的重载数量。
		 */
		pending() {
			return timers.size
		},
		/**
		 * @returns {void} 无。
		 */
		stop() {
			for (const timer of timers.values()) clearTimeout(timer)
			timers.clear()
		},
	}
}

const localeReloadScheduler = createLocaleReloadScheduler({
	/**
	 * @param {string} locale - locale id。
	 * @param {LocaleData} data - 新读到的 locale 数据。
	 * @returns {void} 无。
	 */
	onReloaded(locale, data) {
		fountLocaleCache[locale] = data
		localhostLocaleData = getLocaleData(localhostLocales)
		for (const fn of localeFileChangeListeners) fn(locale)
	},
})

fs.watch(FOUNT_LOCALES_DIR, (_event, filename) => {
	if (!filename?.endsWith('.json')) return
	if (!fs.existsSync(`${FOUNT_LOCALES_DIR}/${filename}`)) return
	const locale = filename.slice(0, -5)
	if (!process.env.FOUNT_TEST) console.log(`Detected change in ${filename}.`)

	if (!fountLocaleCache[locale]) return
	// 写入方会先截断再写满：立刻读会拿到半截 JSON。交给调度器防抖 + 容错重试，
	// 读到半截就沿用旧缓存，避免在 fs.watch 回调里抛未处理拒绝。
	localeReloadScheduler.notify(locale)
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
	if (isSwitchValue(translation))
		return applyParamsToTranslation(resolveSwitchCase(translation, params), params, terminal)
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

/** 已告警的未定义占位符签名，避免同一渲染反复刷屏。 @type {Set<string>} */
const warnedPlaceholders = new Set()

/**
 * 翻译含未定义占位符时告警（复用 `[i18n:missing]` 标记，测试噪声检测会捕获）。
 * @param {string} key i18n 键。
 * @param {unknown} translation 原始翻译节点。
 * @param {Record<string, any>} params 插值参数。
 * @returns {void} 无。
 */
function warnMissingPlaceholders(key, translation, params) {
	const missing = collectMissingPlaceholders(translation, params)
	if (!missing.size) return
	const signature = `${key}\0${[...missing].join(',')}`
	if (warnedPlaceholders.has(signature)) return
	warnedPlaceholders.add(signature)
	console.warn(`[i18n:missing] Placeholder(s) ${[...missing].map(name => `"${name}"`).join(', ')} not provided for key "${key}".`)
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
	if (translation === undefined)
		return console.warn(`[i18n:missing] Translation key "${key}" not found.`)
	warnMissingPlaceholders(key, translation, params)
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
 * 包装 console 方法：跳过本栈帧并输出翻译文本。
 * 前缀参数个数取自 `method.length`。
 * @param {(...args: unknown[]) => void} method - console 方法。
 * @returns {(...args: unknown[]) => void} *I18n 包装函数。
 */
function makeConsoleI18n(method) {
	const prefixArgCount = method.length
	return (...args) => {
		try {
			console.stackFrameSkipCount++
			const prefix = args.slice(0, prefixArgCount)
			const [key, params = {}] = args.slice(prefixArgCount)
			return method(...prefix, toString(geti18nForTerminal(key, params)))
		} finally {
			console.stackFrameSkipCount--
		}
	}
}

/**
 * 输出本地化后的info日志
 * @param {LocaleKey} key - 翻译键。
 * @param {object} [params] - 可选的参数，用于插值。
 * @returns {void} 无
 */
console.infoI18n = makeConsoleI18n(console.info)
/**
 * 输出本地化后的log日志
 * @param {LocaleKey} key - 翻译键。
 * @param {object} [params] - 可选的参数，用于插值。
 * @returns {void} 无
 */
console.logI18n = makeConsoleI18n(console.log)
/**
 * 输出本地化后的warn日志
 * @param {LocaleKey} key - 翻译键。
 * @param {object} [params] - 可选的参数，用于插值。
 * @returns {void} 无
 */
console.warnI18n = makeConsoleI18n(console.warn)
/**
 * 输出本地化后的error日志
 * @param {LocaleKey} key - 翻译键。
 * @param {object} [params] - 可选的参数，用于插值。
 * @returns {void} 无
 */
console.errorI18n = makeConsoleI18n(console.error)
/**
 * 输出本地化后的freshLine日志
 * @param {LocaleKey} key - 翻译键。
 * @param {object} [params] - 可选的参数，用于插值。
 * @returns {void} 无
 */
console.freshLineI18n = makeConsoleI18n(console.freshLine)
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
