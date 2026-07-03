import { filterSetsFromPersonalListEntries } from '../../../../../../../scripts/p2p/personal_block.mjs'

import { parseEntityHash } from './entityHash.mjs'

const EMPTY = filterSetsFromPersonalListEntries([])

/**
 * @param {object} filterSets loadPersonalFilterSets 结果
 * @param {string} authorEntityHash 作者实体
 * @returns {boolean} 是否应过滤
 */
function isAuthorFilteredByPersonalSets(filterSets, authorEntityHash) {
	const entity = String(authorEntityHash || '').trim().toLowerCase()
	if (!entity) return false
	if (filterSets.blockedEntityHashes.has(entity) || filterSets.hiddenEntityHashes.has(entity))
		return true
	const parsed = parseEntityHash(entity)
	if (!parsed) return false
	if (filterSets.blockedSubjects.has(parsed.subjectHash) || filterSets.hiddenSubjects.has(parsed.subjectHash))
		return true
	return false
}

/**
 * @param {{ entries?: Array<{ scope?: string, kind?: string, value?: string }> }} [raw] API 响应
 * @returns {{ blockedEntityHashes: Set<string>, blockedSubjects: Set<string>, hiddenEntityHashes: Set<string>, hiddenSubjects: Set<string> }} 规范化过滤集
 */
export function normalizePersonalFilterResponse(raw = { entries: [] }) {
	return filterSetsFromPersonalListEntries(raw?.entries)
}

/**
 * @returns {Promise<{ blockedEntityHashes: Set<string>, blockedSubjects: Set<string>, hiddenEntityHashes: Set<string>, hiddenSubjects: Set<string> }>} 过滤集
 */
export async function fetchPersonalFilterSets() {
	const resp = await fetch('/api/p2p/personal-lists', { credentials: 'include' })
	if (!resp.ok) return EMPTY
	return normalizePersonalFilterResponse(await resp.json())
}

/**
 * @param {{ blockedEntityHashes: Set<string>, blockedSubjects: Set<string>, hiddenEntityHashes: Set<string>, hiddenSubjects: Set<string> }} filterSets 过滤集
 * @param {string} entityHash 目标实体
 * @param {string} [pubKeyHash] 可选 pubKeyHash
 * @returns {boolean} 是否应隐藏
 */
export function isPersonallyFiltered(filterSets, entityHash, pubKeyHash = '') {
	if (isAuthorFilteredByPersonalSets(filterSets, entityHash)) return true
	if (!pubKeyHash) return false
	return filterSets.blockedSubjects.has(pubKeyHash) || filterSets.hiddenSubjects.has(pubKeyHash)
}
