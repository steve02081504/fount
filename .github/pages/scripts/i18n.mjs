/** @type {import('npm:@sentry/browser')} */
import * as Sentry from 'https://esm.sh/@sentry/browser'

import { base_dir } from '../base.mjs'

import { onElementRemoved } from './onElementRemoved.mjs'

/**
 * @typedef {import('../../../src/decl/locale_data.ts').LocaleKey} LocaleKey
 * @typedef {import('../../../src/decl/locale_data.ts').LocaleKeyWithoutParams} LocaleKeyWithoutParams
 * @typedef {import('../../../src/decl/locale_data.ts').LocaleKeyWithParams} LocaleKeyWithParams
 * @typedef {import('../../../src/decl/locale_data.ts').LocaleKeyParams} LocaleKeyParams
 */

const languageChangeCallbacks = []
/**
 * 注册一个语言变化回调函数。
 * @param {Function} callback - 语言变化时要执行的回调函数。
 * @returns {any} - 回调函数的执行结果。
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
 * 运行所有语言变化回调函数。
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
let saved_pageid
let lastKnownLangs
let availableLocales = []
const localeNames = new Map()

/**
 * 主要区域设置。
 * @type {string}
 */
export let main_locale = 'en-UK'

/**
 * Sets the application's language.
 * @param {string[]} langs - The language codes (e.g., 'en-UK', 'zh-CN').
 */
export async function setLocales(langs) {
	localStorage.setItem('fountUserPreferredLanguages', JSON.stringify(langs || []))
	await initTranslations()
}

/**
 * 保存首选语言。
 * @param {string[]} langs - 首选语言列表。
 * @returns {Promise<void>}
 */
export async function savePreferredLangs(langs) {
	const oldLangs = loadPreferredLangs()
	if (JSON.stringify(langs) == JSON.stringify(oldLangs)) return
	localStorage.setItem('fountUserPreferredLanguages', JSON.stringify(langs || []))
	await initTranslations()
}

/**
 * Returns the list of available locale codes.
 * @returns {string[]} 可用的语言环境代码列表。
 */
export function getAvailableLocales() {
	return availableLocales
}

/**
 * Returns a map of locale codes to their native names.
 * @returns {Map<string, string>} 语言环境代码到其本地名称的映射。
 */
export function getLocaleNames() {
	return localeNames
}

/**
 * 加载首选语言。
 * @returns {string[]} 首选语言列表。
 */
export function loadPreferredLangs() {
	return JSON.parse(localStorage.getItem('fountUserPreferredLanguages') || '[]').filter(Boolean)
}

/**
 * 从服务器获取多语言数据并初始化翻译。
 * @param {string} [pageid] - 页面 ID。
 * @param {string[]} [preferredLangs] - 用户手动设置的优先语言列表
 * @returns {Promise<void>}
 */
export async function initTranslations(pageid = saved_pageid, preferredLangs = loadPreferredLangs()) {
	saved_pageid = pageid
	lastKnownLangs = preferredLangs

	try {
		const listRes = await fetch(base_dir + '/locales/list.csv')

		if (listRes.ok) {
			const csvText = await listRes.text()
			const lines = csvText.split('\n').slice(1) // Skip header
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

		const lang = getbestlocale([...preferredLangs, ...navigator.languages || [navigator.language]], availableLocales)
		main_locale = lang

		const translationResponse = await fetch(base_dir + `/locales/${lang}.json`)
		if (!translationResponse.ok)
			throw new Error(`Failed to fetch translations: ${translationResponse.status} ${translationResponse.statusText}`)

		i18n = await translationResponse.json()
	}
	catch (error) {
		console.error('Error initializing translations:', error)
	}
	if (i18n) applyTranslations()
}

/**
 * Determines the best locale to use based on a prioritized list.
 * The priority is:
 * 1. The explicit list passed as the first argument (for immediate user actions).
 * 2. The list saved in localStorage (for session persistence).
 * 3. The browser's language settings.
 * 4. A hardcoded fallback ('en-UK').
 * @param {string[]} preferredlocaleList - The list of preferred locales, including the newly selected one and browser defaults.
 * @param {string[]} localeList - The list of available locales for the application.
 * @returns {string} The best matching locale code.
 */
function getbestlocale(preferredlocaleList, localeList) {
	for (const preferredlocale of preferredlocaleList) {
		if (localeList.includes(preferredlocale))
			return preferredlocale
		const temp = localeList.find(name => name.startsWith(preferredlocale.split('-')[0]))
		if (temp) return temp
	}
	return 'en-UK'
}

/**
 * 根据点分隔的键字符串获取嵌套对象的值。
 * @param {object} obj - 要从中获取值的对象。
 * @param {string} key - 点分隔的键字符串（例如 'a.b.c'）。
 * @returns {any|undefined} - 嵌套的值，如果路径不存在则返回 undefined。
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
 * 对单条翻译字符串做插值（链接、占位符、反引号）。
 * 链接 [text](${param}) → <a>；`xxx` → <code>xxx</code>。
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
	for (const param in params)
		result = result?.replace?.(
			new RegExp(`\\[(?<text>.+)\\]\\(\\$\\{${param}\\}\\)`, 'g'),
			(m, text) => /* html */ `<a href="${params[param]}" target="_blank" rel="noopener" class="link">${text}</a>`
		)?.replaceAll?.(`\${${param}}`, params[param])
	result = result?.replace?.(/`([^`]*)`/g, '<code>$1</code>')
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
 * @overload
 * @template {LocaleKeyWithoutParams} TKey
 * @param {TKey} key
 * @param {Record<string, any>} [params]
 * @returns {string | undefined}
 */
/**
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
 * @returns {string} - 翻译后的文本。
 */
export function geti18n(key, params = {}) {
	const translation = geti18n_nowarn(key, params)

	if (translation) return translation

	console.warn(`Translation key "${key}" not found.`)
	Sentry.captureException(new Error(`Translation key "${key}" not found.`))
	return key
}
const { console } = globalThis
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
 * 使用国际化键和参数记录信息。
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
 * 使用国际化键和参数记录日志。
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
 * 使用国际化键和参数记录警告。
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
 * 使用国际化键和参数记录错误。
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
 * 使用国际化键和参数记录新行。
 * @param {string} id - 标识符。
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
 * 使用 i18n 显示 alert。
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
 * @returns {string|null}
 */
/**
 * @overload
 * @template {LocaleKeyWithParams} TKey
 * @param {TKey} key
 * @param {LocaleKeyParams[TKey]} params
 * @returns {string|null}
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
 * 使用 i18n 显示 confirm。
 * @param {LocaleKey} key - 翻译键。
 * @param {object} [params] - 可选的参数，用于插值。
 * @returns {boolean} 如果用户点击“确定”则返回 true，否则返回 false。
 */
export function confirmI18n(key, params = {}) {
	return confirm(toString(geti18n(key, params)))
}
/**
 * 导出的控制台对象。
 * @type {Console}
 */
export { console }

/**
 * 翻译单个元素。
 * @param {HTMLElement} element - 要翻译的 DOM 元素。
 * @returns {boolean} - 如果元素被更新则返回 true，否则返回 false。
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
		else if (!Array.isArray(getNestedValue(i18n, key)) && (getNestedValue(i18n, key) instanceof Object)) {
			if (!Object.keys(getNestedValue(i18n, key)).length) break
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
		if (updated) break
	}
	return updated
}

/**
 * 将翻译应用到 DOM 元素。
 * @private
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
 * 翻译 DOM 元素及其子元素中带有 `data-i18n` 属性的文本。
 * @param {HTMLElement} element - 要翻译的 DOM 元素。
 * @param {object} [options] - 选项对象。
 * @param {boolean} [options.skip_report=false] - 是否跳过未更新元素的报告。
 * @returns {HTMLElement} - 传入的元素。
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

window.addEventListener('languagechange', async () => {
	await initTranslations()
})
window.addEventListener('visibilitychange', async () => {
	if (document.visibilityState != 'visible') return

	const preferredLangs = loadPreferredLangs()
	if (saved_pageid && JSON.stringify(lastKnownLangs) != JSON.stringify(preferredLangs))
		await initTranslations()
})

// Watch for changes in the DOM
const i18nObserver = new MutationObserver((mutationsList) => {
	if (!i18n) return
	for (const mutation of mutationsList)
		if (mutation.type === 'childList')
			mutation.addedNodes.forEach(node => {
				if (node.nodeType === Node.ELEMENT_NODE)
					i18nElement(node, { skip_report: true })
			})
		else if (mutation.type === 'attributes')  // No need to check attributeName, since we are filtering
			translateSingularElement(mutation.target)
})

/**
 * 观察文档主体以进行配置的突变。
 * @returns {void}
 */
function observeBody() {
	i18nObserver.observe(document.body, { attributeFilter: ['data-i18n'], attributes: true, childList: true, subtree: true })
}

if (document.body) observeBody()
else window.addEventListener('DOMContentLoaded', observeBody)
