import { filterSetsFromPersonalListEntries, isAuthorFilteredByPersonalSets } from '../../shared/personalFilter.mjs'

const EMPTY = filterSetsFromPersonalListEntries([])

/**
 * @param {{ entries?: Array<{ scope?: string, kind?: string, value?: string }> }} [raw] API 响应
 * @returns {ReturnType<typeof filterSetsFromPersonalListEntries>} 规范化过滤集
 */
export function normalizePersonalFilterResponse(raw = { entries: [] }) {
	return filterSetsFromPersonalListEntries(raw?.entries)
}

/**
 * @returns {Promise<ReturnType<typeof filterSetsFromPersonalListEntries>>} 过滤集
 */
export async function fetchPersonalFilterSets() {
	const resp = await fetch('/api/parts/shells:chat/personal-lists', { credentials: 'include' })
	if (!resp.ok) return EMPTY
	return normalizePersonalFilterResponse(await resp.json())
}

/**
 * @param {ReturnType<typeof filterSetsFromPersonalListEntries>} filterSets 过滤集
 * @param {string} entityHash 目标实体
 * @param {string} [pubKeyHash] 可选 pubKeyHash
 * @returns {boolean} 是否应隐藏
 */
export function isPersonallyFiltered(filterSets, entityHash, pubKeyHash = '') {
	if (isAuthorFilteredByPersonalSets(filterSets, entityHash)) return true
	if (!pubKeyHash) return false
	return filterSets.blockedSubjects.has(pubKeyHash)
		|| filterSets.hiddenSubjects.has(pubKeyHash)
		|| filterSets.mutedSubjects?.has(pubKeyHash)
}
