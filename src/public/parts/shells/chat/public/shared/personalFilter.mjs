/**
 * @param {Array<{ kind?: string, scope?: string, value?: string }>} entries API 条目
 * @returns {{ blockedEntityHashes: Set<string>, blockedSubjects: Set<string>, hiddenEntityHashes: Set<string>, hiddenSubjects: Set<string> }} 过滤集
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
	for (const entry of entries || []) {
		const kind = String(entry?.kind || '').trim().toLowerCase()
		const scope = String(entry?.scope || '').trim().toLowerCase()
		const value = String(entry?.value || '').trim().toLowerCase()
		if (!value || (scope !== 'entity' && scope !== 'subject')) continue
		if (kind === 'block')
			if (scope === 'entity') blockedEntityHashes.add(value)
			else blockedSubjects.add(value)
		else if (kind === 'hide')
			if (scope === 'entity') hiddenEntityHashes.add(value)
			else hiddenSubjects.add(value)
	}
	return { blockedEntityHashes, blockedSubjects, hiddenEntityHashes, hiddenSubjects }
}
