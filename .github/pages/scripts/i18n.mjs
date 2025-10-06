/** @type {import('npm:@sentry/browser')} */
import * as Sentry from 'https://esm.sh/@sentry/browser'

import { base_dir } from '../base.mjs'

import { onElementRemoved } from './onElementRemoved.mjs'

const languageChangeCallbacks = []
export function onLanguageChange(callback) {
	languageChangeCallbacks.push(callback)
	return callback()
}
export function offLanguageChange(callback) {
	const index = languageChangeCallbacks.indexOf(callback)
	if (index > -1) languageChangeCallbacks.splice(index, 1)
}
async function runLanguageChange() {
	for (const callback of languageChangeCallbacks) try {
		await callback()
	} catch (e) {
		console.error('Error in language change callback:', e)
	}
}

const LocalizeLogics = new Map()
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

	if (translation !== undefined) return translation

	console.warn(`Translation key "${key}" not found.`)
	Sentry.captureException(new Error(`Translation key "${key}" not found.`))
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

function translateSingularElement(element) {
	let updated = false
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
	for (const mutation of mutationsList)
		if (mutation.type === 'childList')
			mutation.addedNodes.forEach(node => {
				if (node.nodeType === Node.ELEMENT_NODE)
					i18nElement(node)
			})
		else if (mutation.type === 'attributes')  // No need to check attributeName, since we are filtering
			translateSingularElement(mutation.target)
})

// Start observing the document body for configured mutations
if (document.body)
	i18nObserver.observe(document.body, { attributeFilter: ['data-i18n'], attributes: true, childList: true, subtree: true })
else
	window.addEventListener('DOMContentLoaded', () => {
		i18nObserver.observe(document.body, { attributeFilter: ['data-i18n'], attributes: true, childList: true, subtree: true })
	})
