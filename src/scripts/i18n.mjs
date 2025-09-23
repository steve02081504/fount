import fs from 'node:fs'
import process from 'node:process'

import { console as baseConsole } from 'npm:@steve02081504/virtual-console'

import { __dirname } from '../server/base.mjs'

import { exec } from './exec.mjs'
import { loadJsonFile } from './json_loader.mjs'

const console = baseConsole
export const fountLocaleList = fs.readFileSync(__dirname + '/src/locales/list.csv', 'utf8')
	.trim()
	.split('\n')
	.slice(1) // Skip header
	.map(line => {
		const [id, ...nameParts] = line.split(',')
		return { id: id.trim(), name: nameParts.join(',').trim() }
	})
	.filter(locale => locale.id)

export function getbestlocale(preferredlocaleList, localeList) {
	const available = new Set(localeList.map(l => l?.id ?? l).filter(Boolean))

	for (const preferred of preferredlocaleList ?? []) {
		// 1. Exact match
		if (available.has(preferred))
			return preferred

		// 2. Partial match (e.g., 'en' from 'en-US')
		const prefix = preferred.split('-')[0]
		for (const locale of available)
			if (locale.startsWith(prefix))
				return locale
	}

	return 'en-UK' // Default
}

const fountLocaleCache = {}
/**
 * @type {Record<string, string[]>}
 */
const partsLocaleLists = {}
/**
 * @type {Record<string, (locale: string) => Promise<any>>}
 */
const partsLocaleLoaders = {}
const partsLocaleCache = {}

export async function getLocaleData(preferredlocaleList) {
	const resultLocale = getbestlocale(preferredlocaleList, fountLocaleList)
	let result = fountLocaleCache[resultLocale] ??= loadJsonFile(__dirname + `/src/locales/${resultLocale}.json`)
	for (const part in partsLocaleLists) {
		const resultLocale = getbestlocale(preferredlocaleList, partsLocaleLists[part])
		partsLocaleCache[part] ??= {}
		const partdata = partsLocaleCache[part][resultLocale] ??= await partsLocaleLoaders[part](resultLocale)
		result = { ...result, ...partdata }
	}
	return result
}

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
export let localhostLocaleData = await getLocaleData(localhostLocales)

// 中国大陆且今天周四
if (localhostLocales[0] === 'zh-CN')
	setInterval(() => {
		if (new Date().getDay() === 4)
			console.error('%cException Error Syntax Unexpected string: Crazy Thursday vivo 50', 'color: red')
	}, 5 * 60 * 1000)

export async function addPartLocaleData(partname, localeList, loader) {
	partsLocaleLists[partname] = localeList
	partsLocaleLoaders[partname] = loader
	localhostLocaleData = await getLocaleData(localhostLocales)
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
 * @returns {Promise<string>} - 翻译后的文本，如果未找到则返回键本身。
 */
export function geti18n(key, params = {}) {
	let translation = getNestedValue(localhostLocaleData, key)

	if (translation === undefined)
		console.warn(`Translation key "${key}" not found.`)

	// 简单的插值处理
	for (const param in params)
		translation = translation?.replaceAll?.(`\${${param}}`, params[param])

	return translation
}
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
