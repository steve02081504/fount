import fs from 'node:fs'
import { __dirname } from '../server/server.mjs'
import { loadJsonFile } from './json_loader.mjs'
const fountLocaleList = fs.readdirSync(__dirname + '/src/locale').filter((file) => file.endsWith('.json')).map((file) => file.slice(0, -5))

export function getbestlocale(preferredlocaleList, localeList) {
	for (const preferredlocale of preferredlocaleList) {
		if (localeList.includes(preferredlocale))
			return preferredlocale
		const temp = localeList.find((name) => name.startsWith(preferredlocale.split('-')[0]))
		if (temp) return temp
	}
	return 'en-UK'
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
	let result = fountLocaleCache[resultLocale] ??= loadJsonFile(__dirname + `/src/locale/${resultLocale}.json`)
	for (const part in partsLocaleLists) {
		const resultLocale = getbestlocale(preferredlocaleList, partsLocaleLists[part])
		partsLocaleCache[part] ??= {}
		const partdata = partsLocaleCache[part][resultLocale] ??= await partsLocaleLoaders[part](resultLocale)
		result = { ...result, ...partdata }
	}
	return result
}

export function addPartLocaleData(partname, localeList, loader) {
	partsLocaleLists[partname] = localeList
	partsLocaleLoaders[partname] = loader
}
