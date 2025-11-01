/** @type {import('npm:@sentry/browser')} */
import * as Sentry from 'https://esm.sh/@sentry/browser'

import { base_dir } from '../base.mjs'

import { onElementRemoved } from './onElementRemoved.mjs'

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
 * 注销一个语言变化回调函数。
 * @param {Function} callback - 要注销的回调函数。
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
 * @param {HTMLElement} element - 要设置本地化逻辑的 DOM 元素。
 * @param {Function} logic - 本地化逻辑函数。
 */
/**
 * 设置元素的本地化逻辑。
 * @param {HTMLElement} element - 要设置本地化逻辑的 DOM 元素。
 * @param {Function} logic - 本地化逻辑函数。
 * @returns {any} - `onLanguageChange` 函数的执行结果。
 */
export function setLocalizeLogic(element, logic) {
	if (LocalizeLogics.has(element)) offLanguageChange(LocalizeLogics.get(element))
	else onElementRemoved(element, () => offLanguageChange(LocalizeLogics.get(element)))
	LocalizeLogics.set(element, logic)
	return onLanguageChange(logic)
}

let i18n
let saved_pageid
let availableLocales = []
const localeNames = new Map()

/**
 * Sets the application's language.
 * @param {string[]} langs - The language codes (e.g., 'en-UK', 'zh-CN').
 */
export async function setLocales(langs) {
	localStorage.setItem('fountUserPreferredLanguages', JSON.stringify(langs))
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
 * 从服务器获取多语言数据并初始化翻译。
 * @param {string} [pageid] - 当前页面的 ID。
 * @param {string[]} preferredlocales - 优先的语言环境列表。
 */
export async function initTranslations(pageid = saved_pageid, preferredlocales = eval(localStorage.getItem('fountUserPreferredLanguages')) || []) {
	saved_pageid = pageid

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

		const lang = getbestlocale([...preferredlocales, ...navigator.languages || [navigator.language]], availableLocales)

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
 * 根据提供的键（key）获取翻译后的文本，不发出警告。
 * @param {string} key - 翻译键。
 * @param {object} [params] - 可选的参数，用于插值（例如 {name: "John"}）。
 * @returns {string|undefined} - 翻译后的文本，如果未找到则返回 undefined。
 */
export function geti18n_nowarn(key, params = {}) {
	let translation = getNestedValue(i18n, key)

	if (!translation) return

	// 简单的插值处理
	for (const param in params)
		translation = translation?.replaceAll?.(`\${${param}}`, params[param])

	return translation
}

/**
 * 根据提供的键（key）获取翻译后的文本。
 * @param {string} key - 翻译键。
 * @param {object} [params] - 可选的参数，用于插值（例如 {name: "John"}）。
 * @returns {string} - 翻译后的文本。
 */
export function geti18n(key, params = {}) {
	const translation = geti18n_nowarn(key, params)

	if (translation !== undefined) return translation

	console.warn(`Translation key "${key}" not found.`)
	Sentry.captureException(new Error(`Translation key "${key}" not found.`))
}
const console = globalThis.console
/**
 * 使用国际化键和参数记录信息。
 * @param {string} key - 翻译键。
 * @param {object} [params] - 可选的参数，用于插值。
 * @returns {void}
 */
console.infoI18n = (key, params = {}) => console.info(geti18n(key, params))
/**
 * 使用国际化键和参数记录日志。
 * @param {string} key - 翻译键。
 * @param {object} [params] - 可选的参数，用于插值。
 * @returns {void}
 */
console.logI18n = (key, params = {}) => console.log(geti18n(key, params))
/**
 * 使用国际化键和参数记录警告。
 * @param {string} key - 翻译键。
 * @param {object} [params] - 可选的参数，用于插值。
 * @returns {void}
 */
console.warnI18n = (key, params = {}) => console.warn(geti18n(key, params))
/**
 * 使用国际化键和参数记录错误。
 * @param {string} key - 翻译键。
 * @param {object} [params] - 可选的参数，用于插值。
 * @returns {void}
 */
console.errorI18n = (key, params = {}) => console.error(geti18n(key, params))
/**
 * 使用国际化键和参数记录新行。
 * @param {string} id - 标识符。
 * @param {string} key - 翻译键。
 * @param {object} [params] - 可选的参数，用于插值。
 * @returns {void}
 */
console.freshLineI18n = (id, key, params = {}) => console.freshLine(id, geti18n(key, params))
/**
 * 显示国际化警告框。
 * @param {string} key - 翻译键。
 * @param {object} [params] - 可选的参数，用于插值。
 * @returns {void}
 */
export function alertI18n(key, params = {}) {
	return alert(geti18n(key, params))
}
/**
 * 显示国际化输入框。
 * @param {string} key - 翻译键。
 * @param {object} [params] - 可选的参数，用于插值。
 * @returns {string|null} - 用户输入的值，如果取消则为 null。
 */
export function promptI18n(key, params = {}) {
	return prompt(geti18n(key, params))
}
/**
 * 显示国际化确认框。
 * @param {string} key - 翻译键。
 * @param {object} [params] - 可选的参数，用于插值。
 * @returns {boolean} - 如果用户点击“确定”则为 true，否则为 false。
 */
export function confirmI18n(key, params = {}) {
	return confirm(geti18n(key, params))
}
/**
 * 导出 console 对象
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
	 * 更新元素的属性。
	 * @param {string} attr - 属性名称。
	 * @param {string} value - 属性值。
	 * @returns {void}
	 */
	function update(attr, value) {
		if (element[attr] == value) return
		element[attr] = value
		updated = true
	}
	const key = element.dataset.i18n
	if (!key) return updated
	if (getNestedValue(i18n, key) instanceof Object) {
		const attributes = ['placeholder', 'title', 'label', 'textContent', 'value', 'alt']
		for (const attr of attributes) {
			const specificKey = `${key}.${attr}`
			const translation = geti18n_nowarn(specificKey)
			if (translation) update(attr, translation)
		}
		const dataset = geti18n_nowarn(`${key}.dataset`)
		if (dataset) Object.assign(element.dataset, dataset)
	}
	else {
		const translation = geti18n(key)
		if (!translation) return
		if (element.innerHTML !== translation) {
			element.innerHTML = translation
			updated = true
		}
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

// Start observing the document body for configured mutations
/**
 * 观察文档主体以进行配置的突变。
 * @returns {void}
 */
function observeBody() {
	i18nObserver.observe(document.body, { attributeFilter: ['data-i18n'], attributes: true, childList: true, subtree: true })
}

if (document.body) observeBody()
else window.addEventListener('DOMContentLoaded', observeBody)
