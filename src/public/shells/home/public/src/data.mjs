import { getAllCachedPartDetails, getPartDetails, noCacheGetPartDetails } from '../../../../scripts/parts.mjs'

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
 * 异步获取指定类型和名称的部件的详细信息。
 * @param {string} partType - 部件的类型 (例如, 'chars')。
 * @param {string} partName - 部件的名称。
 * @param {boolean} [useCache=true] - 是否应使用缓存数据（如果可用）。
 * @returns {Promise<any>} 返回一个解析为部件详细信息的Promise。
 */
export async function getpartDetails(partType, partName, useCache = true) {
	// New cache access
	if (useCache && partDetailsCache[partType]?.[partName] && !partDetailsCache[partType][partName].supportedInterfaces.includes('info'))
		return partDetailsCache[partType][partName]

	const fetchFunction = useCache ? getPartDetails : noCacheGetPartDetails
	// New cache assignment
	partDetailsCache[partType] ??= {}
	partDetailsCache[partType][partName] = await fetchFunction(partType, partName)
	return partDetailsCache[partType][partName]
}

/**
 * 获取指定类型的所有部件名称，结合缓存和非缓存列表。
 * @param {string} partType - 要获取名称的部件类型。
 * @returns {Promise<string[]>} 一个解析为排序后的部件名称数组的Promise。
 */
export async function getAllpartNames(partType) {
	const { cachedDetails, uncachedNames } = await getAllCachedPartDetails(partType).catch(e => {
		console.error(`Failed to get all part details for ${partType}`, e)
		return { cachedDetails: {}, uncachedNames: [] } // return empty object on failure
	})

	// 从批量获取中填充全局缓存
	partDetailsCache[partType] ??= {}
	for (const partName in cachedDetails)
		partDetailsCache[partType][partName] = cachedDetails[partName]

	return [
		...Object.keys(cachedDetails),
		...uncachedNames,
	].sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()))
}
