import { getAllCachedPartDetails } from '../../../../../scripts/parts.mjs'

/**
 * 部件详细信息缓存，以便其他模块可以访问。
 * @type {object}
 */
export let partDetailsCache = {}
/**
 * 每个部件类型的项目列表缓存。
 * @type {object}
 */
export let partListsCache = {}

/**
 * 清除所有缓存数据。
 */
export function clearCache() {
	partDetailsCache = {}
	partListsCache = {}
}

/**
 * 异步获取指定路径的部件的详细信息。
 * @param {string} partPath - 部件的路径 (例如, 'shells/home')。
 * @param {boolean} [useCache=true] - 是否应使用缓存数据（如果可用）。
 * @returns {Promise<any>} 返回一个解析为部件详细信息的Promise。
 */
export async function getpartDetails(partPath, useCache = true) {
	if (useCache && partDetailsCache[partPath] && !partDetailsCache[partPath].supportedInterfaces.includes('info'))
		return partDetailsCache[partPath]

	const url = new URL(`/api/getdetails/${partPath}`, window.location.origin)
	if (!useCache) url.searchParams.set('nocache', 'true')
	const response = await fetch(url)
	if (!response.ok) throw new Error(`Failed to fetch part details for ${partPath}: ${response.status}`)
	partDetailsCache[partPath] = await response.json()
	return partDetailsCache[partPath]
}

/**
 * 获取指定根路径下的所有部件路径，结合缓存和非缓存列表。
 * @param {string} partRoot - 要获取名称的部件根路径（例如 'shells'）。
 * @returns {Promise<string[]>} 一个解析为排序后的部件路径数组的Promise。
 */
export async function getAllpartNames(partRoot) {
	const { cachedDetails, uncachedNames } = await getAllCachedPartDetails(partRoot).catch(e => {
		console.error(`Failed to get all part details for ${partRoot}`, e)
		return { cachedDetails: {}, uncachedNames: [] } // return empty object on failure
	})

	for (const partName in cachedDetails) {
		const partPath = `${partRoot}/${partName}`
		partDetailsCache[partPath] = cachedDetails[partName]
	}

	const allNames = [
		...Object.keys(cachedDetails),
		...uncachedNames,
	].map(name => `${partRoot}/${name}`)

	return allNames.sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()))
}
