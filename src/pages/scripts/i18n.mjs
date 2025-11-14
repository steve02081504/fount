/** @type {import('npm:@sentry/browser')} */
import * as Sentry from 'https://esm.sh/@sentry/browser'

import { onElementRemoved } from './onElementRemoved.mjs'
import { onServerEvent } from './server_events.mjs'

/**
 * @typedef {import('../../decl/locale_data.ts').LocaleKey} LocaleKey
 * @typedef {import('../../decl/locale_data.ts').LocaleKeyWithoutParams} LocaleKeyWithoutParams
 * @typedef {import('../../decl/locale_data.ts').LocaleKeyWithParams} LocaleKeyWithParams
 * @typedef {import('../../decl/locale_data.ts').LocaleKeyParams} LocaleKeyParams
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
let saved_pageid
let lastKnownLangs

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
	// TODO: remove this
	if (localStorage.getItem('userPreferredLanguages') == 'undefined') localStorage.removeItem('userPreferredLanguages')
	return JSON.parse(localStorage.getItem('userPreferredLanguages') || '[]').filter(Boolean)
}

/**
 * 保存首选语言。
 * @param {string[]} langs - 首选语言列表。
 * @returns {Promise<void>}
 */
export async function savePreferredLangs(langs) {
	const oldLangs = loadPreferredLangs()
	if (JSON.stringify(langs) == JSON.stringify(oldLangs)) return
	localStorage.setItem('userPreferredLanguages', JSON.stringify(langs || []))
	await initTranslations()
}

/**
 * 获取可用的区域设置。
 * @returns {Promise<object>} 可用的区域设置。
 */
export async function getAvailableLocales() {
	const response = await fetch('/api/getavailablelocales')
	if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`)
	return response.json()
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
	main_locale = [...preferredLangs, navigator.language, ...navigator.languages, 'en-UK'].filter(Boolean)[0]
	try {
		const url = new URL('/api/getlocaledata', location.origin)
		url.searchParams.set('preferred', preferredLangs.join(','))

		const response = await fetch(url)
		if (!response.ok)
			throw new Error(`Failed to fetch translations: ${response.status} ${response.statusText}`)

		i18n = await response.json()
	}
	catch (error) {
		console.error('Error initializing translations:', error)
	}
	if (i18n) applyTranslations()
}

/**
 * 获取嵌套对象的值。
 * @param {object} obj - 对象。
 * @param {string} key - 键。
 * @returns {any} 嵌套对象的值。
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
	let translation = getNestedValue(i18n, key)

	if (translation === undefined) return

	// 简单的插值处理
	for (const param in params)
		translation = translation?.replace?.(
			new RegExp(`\\[(?<text>.+)\\]\\(\\$\\{${param}\\}\\)`, 'g'),
			(m, text) => /* html */ `<a href="${params[param]}" target="_blank" rel="noopener" class="link">${text}</a>`
		)?.replaceAll?.(`\${${param}}`, params[param])

	return translation
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
	const translation = geti18n_nowarn(key, params)

	if (translation) return translation

	console.warn(`Translation key "${key}" not found.`)
	Sentry.captureException(new Error(`Translation key "${key}" not found.`))
}
const { console } = globalThis

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
 * 使用 i18n 打印 info 消息。
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
 * 使用 i18n 打印 log 消息。
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
 * 使用 i18n 打印 warn 消息。
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
 * 使用 i18n 打印 error 消息。
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
 * 使用 i18n 打印新行消息。
 * @param {string} id - 消息 ID。
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
 * 使用 i18n 显示 alert。
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
 * 使用 i18n 显示 confirm。
 * @param {LocaleKey} key - 翻译键。
 * @param {object} [params] - 可选的参数，用于插值。
 * @returns {boolean} 如果用户点击“确定”则返回 true，否则返回 false。
 */
export function confirmI18n(key, params = {}) {
	return confirm(geti18n(key, params))
}
/**
 * 导出的控制台对象。
 * @type {Console}
 */
export { console }

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
			if (element.textContent !== literal_value) {
				element.textContent = literal_value
				updated = true
			}
		}
		else if (getNestedValue(i18n, key) instanceof Object) {
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
			const translation = geti18n_nowarn(key, element.dataset)
			if (element.innerHTML !== translation) {
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

window.addEventListener('languagechange', async () => {
	await initTranslations()
})
window.addEventListener('visibilitychange', async () => {
	if (document.visibilityState != 'visible') return

	const preferredLangs = loadPreferredLangs()
	if (saved_pageid && JSON.stringify(lastKnownLangs) != JSON.stringify(preferredLangs))
		await initTranslations()
})

onServerEvent('locale-updated', async () => {
	console.log('Received locale update notification. Re-initializing translations...')
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
 * 观察 body 元素的变化。
 * @returns {void}
 */
function observeBody() {
	i18nObserver.observe(document.body, { attributeFilter: ['data-i18n'], attributes: true, childList: true, subtree: true })
}

if (document.body) observeBody()
else window.addEventListener('DOMContentLoaded', observeBody)
