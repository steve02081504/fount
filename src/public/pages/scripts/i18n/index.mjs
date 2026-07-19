/**
 * Sentry 浏览器 SDK 模块。
 * @type {import('npm:@sentry/browser')}
 */
import * as Sentry from 'https://esm.sh/@sentry/browser'

import { onElementRemoved } from '../lib/onElementRemoved.mjs'
import { escapeRegExp } from '../lib/regex.mjs'

import { initTranslations, preferredLangsStorageKey } from './base.mjs'

/**
 * 本地化键
 * @typedef {import('../../../decl/locale_data.ts').LocaleKey} LocaleKey
 * 无参数的本地化键
 * @typedef {import('../../../decl/locale_data.ts').LocaleKeyWithoutParams} LocaleKeyWithoutParams
 * 有参数的本地化键
 * @typedef {import('../../../decl/locale_data.ts').LocaleKeyWithParams} LocaleKeyWithParams
 * 对应键的本地化参数类型
 * @typedef {import('../../../decl/locale_data.ts').LocaleKeyParams} LocaleKeyParams
 */

const languageChangeCallbacks = []
/**
 * 注册一个语言更改回调。
 * @param {Function} callback - 回调函数。
 * @returns {any} 回调函数的返回值。
 */
export function onLanguageChange(callback) {
	languageChangeCallbacks.push(callback)
	return callback()
}
/**
 * 注销一个语言更改回调。
 * @param {Function} callback - 回调函数。
 * @returns {void}
 */
export function offLanguageChange(callback) {
	const index = languageChangeCallbacks.indexOf(callback)
	if (index > -1) languageChangeCallbacks.splice(index, 1)
}
/**
 * 运行语言更改回调。
 * @returns {Promise<void>}
 */
async function runLanguageChange() {
	for (const callback of languageChangeCallbacks) try {
		await callback()
	} catch (e) {
		console.error('Error in language change callback:', e)
	}
}

const LocalizeLogics = new Map()
/**
 * 设置元素的本地化逻辑。
 * @param {HTMLElement} element - 元素。
 * @param {Function} logic - 本地化逻辑。
 * @returns {any} 语言更改回调的返回值。
 */
export function setLocalizeLogic(element, logic) {
	if (LocalizeLogics.has(element)) offLanguageChange(LocalizeLogics.get(element))
	else onElementRemoved(element, () => offLanguageChange(LocalizeLogics.get(element)))
	LocalizeLogics.set(element, logic)
	return onLanguageChange(logic)
}

let i18n
/**
 * 当前页面 ID（i18n 初始化时保存）。
 * @type {string|undefined}
 */
export let saved_pageid
/**
 * 最近已知的用户首选语言列表。
 * @type {string[]|undefined}
 */
export let lastKnownLangs

/**
 * 主要区域设置。
 * @type {string}
 */
export let main_locale = 'en-UK'

/**
 * 加载首选语言。
 * @returns {string[]} 首选语言列表。
 */
export function loadPreferredLangs() {
	try {
		const parsed = JSON.parse(localStorage.getItem(preferredLangsStorageKey) || '[]')
		return Array.isArray(parsed) ? parsed.filter(Boolean) : []
	} catch {
		return []
	}
}

/**
 * 当前用户主区域：preferredLangs[0] → main_locale（默认 en-UK）。
 * @returns {string} BCP 47
 */
export function primaryLocale() {
	return loadPreferredLangs()[0] || main_locale
}

/**
 * 保存首选语言。
 * @param {string[]} langs - 首选语言列表。
 * @returns {Promise<void>}
 */
export async function savePreferredLangs(langs) {
	const oldLangs = loadPreferredLangs()
	if (JSON.stringify(langs) == JSON.stringify(oldLangs)) return
	await setLocales(langs)
}

/**
 * 写入首选语言并重新加载翻译。
 * @param {string[]} langs - 首选语言列表。
 * @returns {Promise<void>}
 */
export async function setLocales(langs) {
	localStorage.setItem(preferredLangsStorageKey, JSON.stringify(langs || []))
	await initTranslations()
}

/**
 * 从优先列表中选取与可用列表最匹配的区域设置。
 * @param {string[]} preferredlocaleList - 优先区域设置列表。
 * @param {string[]} localeList - 可用区域设置列表。
 * @returns {string} 最佳匹配的区域设置代码。
 */
export function getBestLocale(preferredlocaleList, localeList) {
	for (const preferredlocale of preferredlocaleList) {
		if (localeList.includes(preferredlocale))
			return preferredlocale
		const temp = localeList.find(name => name.startsWith(preferredlocale.split('-')[0]))
		if (temp) return temp
	}
	return 'en-UK'
}

/**
 * initTranslations 共用流程：更新状态、加载 bundle、应用到 DOM。
 * @param {string|undefined} pageid - 页面 ID。
 * @param {string[]} preferredLangs - 首选语言列表。
 * @param {() => Promise<{ bundle: object, locale: string }|undefined>} loadBundle - 加载翻译 bundle。
 * @returns {Promise<void>}
 */
export async function runInitTranslations(pageid, preferredLangs, loadBundle) {
	try {
		const result = await loadBundle()
		if (result)
			setI18nBundle(result.bundle, result.locale, pageid, preferredLangs)
		else {
			if (pageid) saved_pageid = pageid
			lastKnownLangs = preferredLangs
		}
		applyTranslations()
	}
	catch (error) {
		console.error('Error initializing translations:', error)
	}
}

/**
 * 设置翻译 bundle。
 * @param {object} bundle 翻译 JSON
 * @param {string} locale 主 locale
 * @param {string} pageid 页面 id
 * @param {string[]} [langs] 已知首选语言
 */
export function setI18nBundle(bundle, locale, pageid, langs) {
	i18n = bundle
	main_locale = locale
	saved_pageid = pageid
	if (langs) lastKnownLangs = langs
}

/**
 * 按点分隔键从嵌套对象中取值。
 * @param {object} obj 对象。
 * @param {string} key 点分隔键。
 * @returns {any|undefined} 嵌套值。
 */
function getNestedValue(obj, key) {
	const keys = key.split('.')
	let value = obj
	for (const k of keys)
		if (value && value instanceof Object && k in value)
			value = value[k]
		else return undefined

	return value
}

/**
 * 对不含字面义占位符片段的字符串做插值（链接、参数占位符、反引号）。
 * @param {string} segment - 翻译片段。
 * @param {Record<string, any>} params - 插值参数。
 * @returns {string} 插值后的片段字符串。
 */
function applyInterpolationToPlainSegment(segment, params) {
	let result = segment
	for (const key in params) {
		const escapedKey = escapeRegExp(key)
		result = result?.replace?.(
			new RegExp(`\\[([^\\]]+)\\]\\(\\$\\{${escapedKey}\\}\\)`, 'g'),
			(match, text) => /* html */ `<a href="${params[key]}" target="_blank" rel="noopener" class="link">${text}</a>`
		)
		const paramPlaceholderRegex = new RegExp(`\\$\\{${escapedKey}\\}`, 'g')
		result = result?.replace?.(paramPlaceholderRegex, () => params[key])
	}
	result = result?.replace?.(/`([^`]*)`/g, '<code>$1</code>')
	return result
}

/**
 * 对单条翻译字符串做插值（链接、占位符、反引号）。
 * 链接 [text](${param}) → <a>；`xxx` → <code>xxx</code>。
 * 字面义占位符：`\${foo}` 渲染为 `${foo}`，且不当作参数插值。
 * 若 translation 非字符串（如嵌套对象），则原样返回。
 * @template TTranslation - 翻译字符串或嵌套对象的类型。
 * @param {TTranslation} translation - 原始翻译字符串或嵌套对象。
 * @param {Record<string, any>} params - 插值参数。
 * @returns {TTranslation} 替换后的翻译字符串或原对象。
 */
function applyParamsToTranslation(translation, params) {
	if (Array.isArray(translation)) return createI18nArrayProxy(translation, params)
	if (!translation || !(Object(translation) instanceof String)) return translation
	const translationText = translation + ''
	let result = ''
	let scanIndex = 0
	while (scanIndex < translationText.length) {
		const literalEscapeStart = translationText.indexOf('\\${', scanIndex)
		const plainSegmentEnd = literalEscapeStart === -1 ? translationText.length : literalEscapeStart
		result += applyInterpolationToPlainSegment(
			translationText.slice(scanIndex, plainSegmentEnd),
			params
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
					return applyParamsToTranslation(target[i], params)
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
 * 无参数的本地化键重载
 * @overload
 * @template {LocaleKeyWithoutParams} TKey
 * @param {TKey} key
 * @param {Record<string, any>} [params]
 * @returns {string | undefined}
 */
/**
 * 有参数的本地化键重载
 * @overload
 * @template {LocaleKeyWithParams} TKey
 * @param {TKey} key
 * @param {LocaleKeyParams[TKey]} params
 * @returns {string | undefined}
 */
/**
 * 根据提供的键（key）获取翻译后的文本（未找到时不警告）。
 * @param {LocaleKey} key - 翻译键。
 * @param {object} [params] - 可选的参数，用于插值（例如 {name: "John"}）。
 * @returns {string | undefined} - 翻译后的文本，如果未找到则返回 undefined。
 */
export function geti18n_nowarn(key, params = {}) {
	return applyParamsToTranslation(getNestedValue(i18n, key), params)
}

/**
 * 无参数的本地化键重载
 * @overload
 * @template {LocaleKeyWithoutParams} TKey
 * @param {TKey} key
 * @param {Record<string, any>} [params]
 * @returns {string}
 */
/**
 * 有参数的本地化键重载
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
	const translation = geti18n_nowarn(key, params)
	if (translation) return translation

	console.warn(`Translation key "${key}" not found.`)
	Sentry.captureException(new Error(`Translation key "${key}" not found.`))
	return key
}

/**
 * 重导出全局 `console`，并挂载 i18n 日志方法（`infoI18n` 等）。
 * @type {Console}
 */
export const { console } = globalThis

/**
 * 将值转换为字符串。
 * @param {any} value - 要转换的值。
 * @returns {string} - 转换后的字符串。
 */
function toString(value) {
	return value + ''
}

/**
 * 将底层日志函数包装为支持本地化键的日志函数。
 * @param {(text: string) => void} log - 底层日志函数。
 * @returns {(key: LocaleKey, params?: object) => void} 本地化日志函数。
 */
function withI18n(log) {
	return (key, params = {}) => {
		try {
			console.stackFrameSkipCount++
			log(toString(geti18n(key, params)))
		} finally {
			console.stackFrameSkipCount--
		}
	}
}

/**
 * 无参数的本地化键重载
 * @overload
 * @template {LocaleKeyWithoutParams} TKey
 * @param {TKey} key
 * @param {Record<string, any>} [params]
 * @returns {void}
 */
/**
 * 有参数的本地化键重载
 * @overload
 * @template {LocaleKeyWithParams} TKey
 * @param {TKey} key
 * @param {LocaleKeyParams[TKey]} params
 * @returns {void}
 */
/**
 * 使用 i18n 打印 info 消息。
 * @param {LocaleKey} key - 翻译键。
 * @param {object} [params] - 可选的参数，用于插值。
 * @returns {void}
 */
console.infoI18n = withI18n(console.info)

/**
 * 无参数的本地化键重载
 * @overload
 * @template {LocaleKeyWithoutParams} TKey
 * @param {TKey} key
 * @param {Record<string, any>} [params]
 * @returns {void}
 */
/**
 * 有参数的本地化键重载
 * @overload
 * @template {LocaleKeyWithParams} TKey
 * @param {TKey} key
 * @param {LocaleKeyParams[TKey]} params
 * @returns {void}
 */
/**
 * 使用 i18n 打印 log 消息。
 * @param {LocaleKey} key - 翻译键。
 * @param {object} [params] - 可选的参数，用于插值。
 * @returns {void}
 */
console.logI18n = withI18n(console.log)

/**
 * 无参数的本地化键重载
 * @overload
 * @template {LocaleKeyWithoutParams} TKey
 * @param {TKey} key
 * @param {Record<string, any>} [params]
 * @returns {void}
 */
/**
 * 有参数的本地化键重载
 * @overload
 * @template {LocaleKeyWithParams} TKey
 * @param {TKey} key
 * @param {LocaleKeyParams[TKey]} params
 * @returns {void}
 */
/**
 * 使用 i18n 打印 warn 消息。
 * @param {LocaleKey} key - 翻译键。
 * @param {object} [params] - 可选的参数，用于插值。
 * @returns {void}
 */
console.warnI18n = withI18n(console.warn)

/**
 * 无参数的本地化键重载
 * @overload
 * @template {LocaleKeyWithoutParams} TKey
 * @param {TKey} key
 * @param {Record<string, any>} [params]
 * @returns {void}
 */
/**
 * 有参数的本地化键重载
 * @overload
 * @template {LocaleKeyWithParams} TKey
 * @param {TKey} key
 * @param {LocaleKeyParams[TKey]} params
 * @returns {void}
 */
/**
 * 使用 i18n 打印 error 消息。
 * @param {LocaleKey} key - 翻译键。
 * @param {object} [params] - 可选的参数，用于插值。
 * @returns {void}
 */
console.errorI18n = withI18n(console.error)

/**
 * 无参数的本地化键重载
 * @overload
 * @template {LocaleKeyWithoutParams} TKey
 * @param {TKey} key
 * @param {Record<string, any>} [params]
 * @returns {void}
 */
/**
 * 有参数的本地化键重载
 * @overload
 * @template {LocaleKeyWithParams} TKey
 * @param {TKey} key
 * @param {LocaleKeyParams[TKey]} params
 * @returns {void}
 */
/**
 * 使用 i18n 打印新行消息。
 * @param {string} id - 消息 ID。
 * @param {LocaleKey} key - 翻译键。
 * @param {object} [params] - 可选的参数，用于插值。
 * @returns {void}
 */
console.freshLineI18n = (id, key, params = {}) => {
	try {
		console.stackFrameSkipCount++
		console.freshLine(id, toString(geti18n(key, params)))
	} finally {
		console.stackFrameSkipCount--
	}
}

/**
 * 无参数的本地化键重载
 * @overload
 * @template {LocaleKeyWithoutParams} TKey
 * @param {TKey} key
 * @param {Record<string, any>} [params]
 * @returns {void}
 */
/**
 * 有参数的本地化键重载
 * @overload
 * @template {LocaleKeyWithParams} TKey
 * @param {TKey} key
 * @param {LocaleKeyParams[TKey]} params
 * @returns {void}
 */
/**
 * 使用 i18n 显示 alert。
 * @param {LocaleKey} key - 翻译键。
 * @param {object} [params] - 可选的参数，用于插值。
 * @returns {void}
 */
export function alertI18n(key, params = {}) {
	return alert(toString(geti18n(key, params)))
}

/**
 * 无参数的本地化键重载
 * @overload
 * @template {LocaleKeyWithoutParams} TKey
 * @param {TKey} key
 * @param {Record<string, any>} [params]
 * @returns {string | null}
 */
/**
 * 有参数的本地化键重载
 * @overload
 * @template {LocaleKeyWithParams} TKey
 * @param {TKey} key
 * @param {LocaleKeyParams[TKey]} params
 * @returns {string | null}
 */
/**
 * 使用 i18n 显示 prompt。
 * @param {LocaleKey} key - 翻译键。
 * @param {object} [params] - 可选的参数，用于插值。
 * @returns {string|null} 用户输入的文本或 null。
 */
export function promptI18n(key, params = {}) {
	return prompt(toString(geti18n(key, params)))
}

/**
 * 无参数的本地化键重载
 * @overload
 * @template {LocaleKeyWithoutParams} TKey
 * @param {TKey} key
 * @param {Record<string, any>} [params]
 * @returns {boolean}
 */
/**
 * 有参数的本地化键重载
 * @overload
 * @template {LocaleKeyWithParams} TKey
 * @param {TKey} key
 * @param {LocaleKeyParams[TKey]} params
 * @returns {boolean}
 */
/**
 * 使用 i18n 显示 confirm。
 * @param {LocaleKey} key - 翻译键。
 * @param {object} [params] - 可选的参数，用于插值。
 * @returns {boolean} 如果用户点击“确定”则返回 true，否则返回 false。
 */
export function confirmI18n(key, params = {}) {
	return confirm(toString(geti18n(key, params)))
}
/**
 * 翻译单个元素。
 * @param {HTMLElement} element - 要翻译的元素。
 * @returns {boolean} 如果元素已更新，则返回 true。
 */
function translateSingularElement(element) {
	let updated = false
	/**
	 * 更新元素的值。
	 * @param {string} attr - 属性名。
	 * @param {string} value - 属性值。
	 * @returns {void}
	 */
	function updateValue(attr, value) {
		if (element[attr] == value) return
		element[attr] = value
		updated = true
	}
	/**
	 * 更新元素的属性。
	 * @param {string} attr - 属性名。
	 * @param {string} value - 属性值。
	 * @returns {void}
	 */
	function updateAttribute(attr, value) {
		if (element.getAttribute(attr) == value) return
		element.setAttribute(attr, value)
		updated = true
	}
	for (const key of element.dataset.i18n.split(';').map(k => k.trim())) {
		if (key.startsWith('\'') && key.endsWith('\'')) {
			const literal_value = key.slice(1, -1)
			// deno-lint-ignore no-cond-assign
			if (element.textContent ||= literal_value) updated = true
		}
		else {
			const nested = getNestedValue(i18n, key)
			if (!Array.isArray(nested) && nested instanceof Object) {
				if (!Object.keys(nested).length) break
				const attributes = ['placeholder', 'title', 'label', 'value', 'alt', 'aria-label']
				for (const attr of attributes) {
					const specificKey = `${key}.${attr}`
					const translation = geti18n_nowarn(specificKey, element.dataset)
					if (translation) updateAttribute(attr, translation)
				}
				const values = ['textContent', 'innerHTML']
				for (const attr of values) {
					const specificKey = `${key}.${attr}`
					const translation = geti18n_nowarn(specificKey, element.dataset)
					if (translation) updateValue(attr, translation)
				}
				const dataset = geti18n_nowarn(`${key}.dataset`)
				if (dataset) Object.assign(element.dataset, dataset)
				updated = true
			}
			else if (geti18n_nowarn(key)) {
				const translation = toString(geti18n_nowarn(key, element.dataset))
				if (element.innerHTML !== translation)
					element.innerHTML = translation
				updated = true
			}
		}
		if (updated) break
	}
	return updated
}

/**
 * 将翻译应用到 DOM 元素。
 * @private
 * @returns {void}
 */
function applyTranslations() {
	// 翻译 <title> 标签
	document.title = geti18n(`${saved_pageid}.title`)

	const descriptionMeta = document.querySelector('meta[name="description"]')
	if (descriptionMeta)
		descriptionMeta.content = geti18n(`${saved_pageid}.description`)
	document.documentElement.lang = geti18n('lang')

	i18nElement(document, { skip_report: true })
	runLanguageChange()
}

/**
 * 翻译元素及其子元素。
 * @param {HTMLElement} element - 要翻译的元素。
 * @param {object} options - 选项。
 * @param {boolean} [options.skip_report=false] - 是否跳过报告。
 * @returns {HTMLElement} 翻译后的元素。
 */
export function i18nElement(element, {
	skip_report = false,
} = {}) {
	let updated = skip_report
	if (element.matches?.('[data-i18n]'))
		if (translateSingularElement(element)) updated = true

	const elements = element.querySelectorAll('[data-i18n]')
	elements.forEach(el => {
		if (translateSingularElement(el)) updated = true
	})
	if (!updated)
		Sentry.captureException(new Error('i18nElement() did not update any attributes for element.'))
	return element
}

/**
 * 写入 `data-i18n` 键与插值参数（其余 `data-*` → `dataset`），并立即翻译。
 * MutationObserver 只监听 `data-i18n`；同键仅改参时不会触发观察器，必须走本函数或 `i18nElement`。
 * @param {HTMLElement} element - 目标元素。
 * @param {LocaleKey} key - 翻译键。
 * @param {Record<string, string | number | boolean | null | undefined>} [params] - 插值参数（写入 dataset）。
 * @returns {HTMLElement} 原元素。
 */
export function setElementI18n(element, key, params = {}) {
	for (const [name, value] of Object.entries(params))
		element.dataset[name] = value
	element.dataset.i18n = key
	translateSingularElement(element)
	return element
}


// Watch for changes in the DOM
const i18nObserver = new MutationObserver((mutationsList) => {
	if (!i18n) return
	for (const mutation of mutationsList)
		if (mutation.type === 'childList')
			mutation.addedNodes.forEach(node => {
				if (node.nodeType === Node.ELEMENT_NODE)
					i18nElement(node, { skip_report: true })
			})
		else if (mutation.type === 'attributes' && mutation.target.dataset.i18n)
			translateSingularElement(mutation.target)
})

/**
 * 观察 body 元素的变化。
 * @returns {void}
 */
function observeBody() {
	i18nObserver.observe(document.body, { attributeFilter: ['data-i18n'], attributes: true, childList: true, subtree: true })
}

if (document.body) observeBody()
else window.addEventListener('DOMContentLoaded', observeBody)

/**
 * 重导出 i18n 初始化与 locale 工具（`initTranslations` 等）。
 */
export {
	preferredLangsStorageKey,
	initTranslations,
	getAvailableLocales,
	getLocaleNames,
} from './base.mjs'

window.addEventListener('languagechange', () => initTranslations())
window.addEventListener('visibilitychange', async () => {
	if (document.visibilityState !== 'visible') return
	const preferredLangs = loadPreferredLangs()
	if (saved_pageid && JSON.stringify(lastKnownLangs) !== JSON.stringify(preferredLangs))
		await initTranslations()
})

