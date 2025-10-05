/** @type {import('npm:@sentry/browser')} */
import * as Sentry from 'https://esm.sh/@sentry/browser'

import { onServerEvent } from './server_events.mjs'

const languageChangeCallbacks = []
export function onLanguageChange(callback) {
	languageChangeCallbacks.push(callback)
}
export function offLanguageChange(callback) {
	const index = languageChangeCallbacks.indexOf(callback)
	if (index > -1) languageChangeCallbacks.splice(index, 1)
}
async function runLanguageChange() {
	for (const callback of languageChangeCallbacks) try {
		await callback()
	}
	catch (e) {
		console.error('Error in language change callback:', e)
	}
}

let i18n
let saved_pageid
let lastKnownLangs

export let main_locale = 'en-UK'

export function loadPreferredLangs() {
	return JSON.parse(localStorage.getItem('userPreferredLanguages') || '[]').filter(Boolean)
}

export function savePreferredLangs(langs) {
	const oldLangs = loadPreferredLangs()
	if (JSON.stringify(langs) == JSON.stringify(oldLangs)) return
	localStorage.setItem('userPreferredLanguages', JSON.stringify(langs))
	applyTranslations()
}

/**
 * 从服务器获取多语言数据并初始化翻译。
 * @param {string} [pageid]
 * @param {string[]} [preferredLangs] - 用户手动设置的优先语言列表
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
	skip_report = false
} = {}) {
	const elements = element.querySelectorAll('[data-i18n]')
	let updated = skip_report
	elements.forEach(element => {
		function update(attr, value) {
			if (element[attr] == value) return
			element[attr] = value
			updated = true
		}
		const key = element.dataset.i18n
		if (!key) return
		if (getNestedValue(i18n, key) instanceof Object) {
			const attributes = ['placeholder', 'title', 'label', 'text', 'value', 'alt']
			for (let attr of attributes) {
				const specificKey = `${key}.${attr}`
				const translation = geti18n_nowarn(specificKey)
				if (translation === undefined) continue
				if (attr === 'text') attr = 'textContent'
				update(attr, translation)
			}
		}
		else
			element.innerHTML = geti18n(key)
	})
	if (!updated)
		Sentry.captureException(new Error('i18nElement() did not update any attributes for element.'))
	return element
}

window.addEventListener('languagechange', () => {
	applyTranslations()
})
window.addEventListener('visibilitychange', () => {
	if (document.visibilityState != 'visible') return

	const preferredLangs = loadPreferredLangs()
	if (JSON.stringify(lastKnownLangs) != JSON.stringify(preferredLangs))
		applyTranslations()
})

onServerEvent('locale-updated', () => {
	console.log('Received locale update notification. Re-initializing translations...')
	initTranslations()
})
