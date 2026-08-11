/**
 * 与 fount-p2p `node/personal_block` 的纯函数形状对齐（含 mute）；前端不能直接 import 包的 node 模块。
 */
import { parseEntityHash } from './entityHash.mjs'

/**
 * @param {Array<{ kind?: string, scope?: string, value?: string }>} entries API 条目
 * @returns {{
 *   blockedEntityHashes: Set<string>,
 *   blockedSubjects: Set<string>,
 *   hiddenEntityHashes: Set<string>,
 *   hiddenSubjects: Set<string>,
 *   mutedEntityHashes: Set<string>,
 *   mutedSubjects: Set<string>,
 * }} 过滤集
 */
export function filterSetsFromPersonalListEntries(entries) {
	/** @type {Set<string>} */
	const blockedEntityHashes = new Set()
	/** @type {Set<string>} */
	const blockedSubjects = new Set()
	/** @type {Set<string>} */
	const hiddenEntityHashes = new Set()
	/** @type {Set<string>} */
	const hiddenSubjects = new Set()
	/** @type {Set<string>} */
	const mutedEntityHashes = new Set()
	/** @type {Set<string>} */
	const mutedSubjects = new Set()
	for (const entry of entries || []) {
		const kind = entry?.kind || ''
		const scope = entry?.scope || ''
		const value = entry?.value || ''
		if (!value || (scope !== 'entity' && scope !== 'subject')) continue
		if (kind === 'block')
			if (scope === 'entity') blockedEntityHashes.add(value)
			else blockedSubjects.add(value)
		else if (kind === 'hide')
			if (scope === 'entity') hiddenEntityHashes.add(value)
			else hiddenSubjects.add(value)
		else if (kind === 'mute')
			if (scope === 'entity') mutedEntityHashes.add(value)
			else mutedSubjects.add(value)
	}
	return {
		blockedEntityHashes,
		blockedSubjects,
		hiddenEntityHashes,
		hiddenSubjects,
		mutedEntityHashes,
		mutedSubjects,
	}
}

/**
 * @param {ReturnType<typeof filterSetsFromPersonalListEntries>} filterSets 过滤集
 * @param {string} authorEntityHash 作者实体
 * @returns {boolean} 是否应过滤
 */
export function isAuthorFilteredByPersonalSets(filterSets, authorEntityHash) {
	if (!authorEntityHash) return false
	if (filterSets.blockedEntityHashes.has(authorEntityHash)
		|| filterSets.hiddenEntityHashes.has(authorEntityHash)
		|| filterSets.mutedEntityHashes?.has(authorEntityHash))
		return true
	const parsed = parseEntityHash(authorEntityHash)
	if (!parsed) return false
	if (filterSets.blockedSubjects.has(parsed.subjectHash)
		|| filterSets.hiddenSubjects.has(parsed.subjectHash)
		|| filterSets.mutedSubjects?.has(parsed.subjectHash))
		return true
	return false
}
