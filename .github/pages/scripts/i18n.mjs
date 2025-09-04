import { base_dir } from '../base.mjs'

let i18n = {}
let saved_pageid
let availableLocales = []
const localeNames = new Map()

/**
 * Sets the application's language.
 * @param {string[]} langs - The language codes (e.g., 'en-UK', 'zh-CN').
 */
export async function setLocales(langs) {
	localStorage.setItem('fountUserPreferredLanguage', JSON.stringify(langs))
	await initTranslations(saved_pageid, langs)
}

/**
 * Returns the list of available locale codes.
 * @returns {string[]}
 */
export function getAvailableLocales() {
	return availableLocales
}

/**
 * Returns a map of locale codes to their native names.
 * @returns {Map<string, string>}
 */
export function getLocaleNames() {
	return localeNames
}

/**
 * 从服务器获取多语言数据并初始化翻译。
 * @param {string} [pageid]
 */
export async function initTranslations(pageid = saved_pageid, preferredlocales = JSON.parse(localStorage.getItem('fountUserPreferredLanguage') || '[]')) {
	saved_pageid = pageid

	try {
		const listRes = await fetch(base_dir + '/locales/list.csv')

		if (listRes.ok) {
			const csvText = await listRes.text()
			const lines = csvText.split('\n').slice(1) // Skip header
			availableLocales = []
			for (const line of lines) {
				const [code, name] = line.split(',')
				if (code && name) {
					const a = code.trim()
					availableLocales.push(a)
					localeNames.set(a, name.trim())
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
		applyTranslations()
	} catch (error) {
		console.error('Error initializing translations:', error)
	}
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
 * @returns {string} - 翻译后的文本，如果未找到则返回键本身。
 */
export function geti18n_nowarn(key, params = {}) {
	let translation = getNestedValue(i18n, key)

	if (translation === undefined) return

	// 简单的插值处理
	for (const param in params)
		translation = translation?.replaceAll?.(`\${${param}}`, params[param])

	return translation
}

/**
 * 根据提供的键（key）获取翻译后的文本。
 * @param {string} key - 翻译键。
 * @param {object} [params] - 可选的参数，用于插值（例如 {name: "John"}）。
 * @returns {string} - 翻译后的文本，如果未找到则返回键本身。
 */
export function geti18n(key, params = {}) {
	const translation = geti18n_nowarn(key, params)

	if (translation === undefined)
		console.warn(`Translation key "${key}" not found.`)

	return translation
}
const console = globalThis.console
console.infoI18n = (key, params = {}) => console.info(geti18n(key, params))
console.logI18n = (key, params = {}) => console.log(geti18n(key, params))
console.warnI18n = (key, params = {}) => console.warn(geti18n(key, params))
console.errorI18n = (key, params = {}) => console.error(geti18n(key, params))
console.freshLineI18n = (id, key, params = {}) => console.freshLine(id, geti18n(key, params))
export function alertI18n(key, params = {}) {
	return alert(geti18n(key, params))
}
export function promptI18n(key, params = {}) {
	return prompt(geti18n(key, params))
}
export function confirmI18n(key, params = {}) {
	return confirm(geti18n(key, params))
}
export { console }

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

	i18nElement(document)
}

export function i18nElement(element) {
	const elements = element.querySelectorAll('[data-i18n]')
	elements.forEach(element => {
		const key = element.dataset.i18n
		if (!key) return
		if (getNestedValue(i18n, key) instanceof Object) {
			const attributes = ['placeholder', 'title', 'label', 'text', 'value', 'alt']

			for (const attr of attributes) {
				const specificKey = `${key}.${attr}`
				const translation = geti18n_nowarn(specificKey)
				if (translation === undefined) continue
				if (attr === 'text')
					element.textContent = translation
				else
					element[attr] = translation
			}
		}
		else
			element.innerHTML = geti18n(key)
	})
	return element
}

window.addEventListener('languagechange', () => {
	initTranslations()
})
