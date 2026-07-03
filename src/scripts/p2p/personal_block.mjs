/**
 * 按实体的个人列表（Chat 与 Social 共享）。
 * **block**：对外联邦公开拉黑（timeline block 事件 + personal_block 索引）；
 * **hide**：纯本地隐藏（personal_hide.json，永不联邦）。
 */
import { isWritableLocalEntity } from './entity/replica.mjs'
import { parseEntityHash } from './entity_id.mjs'
import { isHex64, normalizeHex64 } from './hexIds.mjs'
import { isNodeInitialized, getEntityStore } from './node/instance.mjs'

/** @typedef {'subject' | 'entity'} PersonalListScope */

const HIDE_JSON = 'personal_hide.json'
const BLOCK_INDEX_JSON = 'personal_block.json'

/**
 * @param {string} targetEntityHash 128 hex
 * @returns {Array<{ scope: PersonalListScope, value: string }>} 规范化条目
 */
export function entriesForTargetEntityHash(targetEntityHash) {
	const parsed = parseEntityHash(targetEntityHash)
	if (!parsed) return []
	/** @type {Map<string, { scope: PersonalListScope, value: string }>} */
	const byKey = new Map()
	byKey.set(`entity:${parsed.entityHash}`, { scope: 'entity', value: parsed.entityHash })
	if (isHex64(parsed.subjectHash))
		byKey.set(`subject:${parsed.subjectHash}`, { scope: 'subject', value: parsed.subjectHash })
	return [...byKey.values()]
}

/**
 * @param {Array<{ scope?: string, value?: string }>} raw 原始条目
 * @returns {Array<{ scope: PersonalListScope, value: string }>} 去重规范化
 */
export function normalizePersonalListEntries(raw) {
	/** @type {Map<string, { scope: PersonalListScope, value: string }>} */
	const byKey = new Map()
	for (const entry of raw || []) {
		const scope = String(entry?.scope || '').trim().toLowerCase()
		const value = String(entry?.value || '').trim().toLowerCase()
		if (scope === 'entity' && parseEntityHash(value))
			byKey.set(`entity:${value}`, { scope: 'entity', value })
		else if (scope === 'subject' && isHex64(normalizeHex64(value)))
			byKey.set(`subject:${normalizeHex64(value)}`, { scope: 'subject', value: normalizeHex64(value) })
	}
	return [...byKey.values()]
}

/**
 * @param {Array<{ scope: PersonalListScope, value: string }>} entries 列表
 * @param {object} subject 待检主体
 * @param {string} [subject.entityHash] 作者实体
 * @param {string} [subject.pubKeyHash] 用户公钥哈希
 * @param {string} [subject.subjectHash] 主体哈希
 * @param {string} [subject.nodeHash] 节点哈希
 * @returns {boolean} 是否命中列表
 */
export function matchesPersonalListEntries(entries, subject) {
	const entity = String(subject?.entityHash || '').trim().toLowerCase()
	const pk = normalizeHex64(subject?.pubKeyHash || subject?.subjectHash || '')
	if (entity) {
		for (const entry of entries)
			if (entry.scope === 'entity' && entry.value === entity) return true
		const parsed = parseEntityHash(entity)
		if (parsed)
			for (const entry of entries)
				if (entry.scope === 'subject' && entry.value === parsed.subjectHash) return true
	}
	if (isHex64(pk))
		for (const entry of entries)
			if (entry.scope === 'subject' && entry.value === pk) return true
	return false
}

/**
 * @param {string} viewerEntityHash 观看者实体
 * @returns {Promise<Array<{ scope: PersonalListScope, value: string }>>} 隐藏条目
 */
export async function loadPersonalHideEntries(viewerEntityHash) {
	if (!isNodeInitialized()) return []
	const data = await getEntityStore().readEntityJson(viewerEntityHash, HIDE_JSON)
	return normalizePersonalListEntries(data?.hidden || [])
}

/**
 * @param {string} viewerEntityHash 观看者实体
 * @returns {Promise<Array<{ scope: PersonalListScope, value: string }>>} 拉黑条目
 */
export async function loadPersonalBlockEntries(viewerEntityHash) {
	if (!isNodeInitialized()) return []
	const data = await getEntityStore().readEntityJson(viewerEntityHash, BLOCK_INDEX_JSON)
	return normalizePersonalListEntries(data?.blocked || [])
}

/**
 * @param {string} viewerEntityHash 观看者实体
 * @param {object} subject 待检主体
 * @returns {Promise<boolean>} 是否被隐藏
 */
export async function isHiddenBy(viewerEntityHash, subject) {
	return matchesPersonalListEntries(await loadPersonalHideEntries(viewerEntityHash), subject)
}

/**
 * @param {string} viewerEntityHash 观看者实体
 * @param {object} subject 待检主体
 * @returns {Promise<boolean>} 是否被拉黑
 */
export async function isBlockedBy(viewerEntityHash, subject) {
	return matchesPersonalListEntries(await loadPersonalBlockEntries(viewerEntityHash), subject)
}

/**
 * @param {string} viewerEntityHash 观看者实体
 * @param {object} subject 待检主体
 * @returns {Promise<boolean>} 是否应过滤
 */
export async function isFilteredByPersonalLists(viewerEntityHash, subject) {
	if (!viewerEntityHash) return false
	const [blocked, hidden] = await Promise.all([
		loadPersonalBlockEntries(viewerEntityHash),
		loadPersonalHideEntries(viewerEntityHash),
	])
	return matchesPersonalListEntries(blocked, subject) || matchesPersonalListEntries(hidden, subject)
}

/**
 * @param {string} viewerEntityHash 本地可写实体
 * @param {string} targetEntityHash 目标
 * @param {boolean} hide true=隐藏
 * @returns {Promise<boolean>} 当前是否隐藏
 */
export async function setPersonalHidden(viewerEntityHash, targetEntityHash, hide) {
	if (!isWritableLocalEntity(viewerEntityHash)) throw new Error('entity not writable on this replica')
	const target = String(targetEntityHash || '').trim().toLowerCase()
	if (!parseEntityHash(target)) throw new Error('invalid targetEntityHash')
	const store = getEntityStore()
	const current = normalizePersonalListEntries((await store.readEntityJson(viewerEntityHash, HIDE_JSON))?.hidden || [])
	const addEntries = entriesForTargetEntityHash(target)
	const addKeys = new Set(addEntries.map(e => `${e.scope}:${e.value}`))
	const next = hide
		? normalizePersonalListEntries([...current, ...addEntries])
		: current.filter(entry => !addKeys.has(`${entry.scope}:${entry.value}`))
	await store.writeEntityJson(viewerEntityHash, HIDE_JSON, { hidden: next })
	return hide
}

/**
 * 从物化公开拉黑名单同步本地索引（真相源 = 时间线 blocked 集）。
 * @param {string} viewerEntityHash 实体
 * @param {string[]} blockedEntityHashes 物化 blocked entityHash 列表
 * @returns {Promise<void>}
 */
export async function rebuildPersonalBlockIndex(viewerEntityHash, blockedEntityHashes) {
	if (!isWritableLocalEntity(viewerEntityHash)) return
	/** @type {Map<string, { scope: PersonalListScope, value: string }>} */
	const byKey = new Map()
	for (const raw of blockedEntityHashes || []) 
		for (const entry of entriesForTargetEntityHash(raw))
			byKey.set(`${entry.scope}:${entry.value}`, entry)
	
	await getEntityStore().writeEntityJson(viewerEntityHash, BLOCK_INDEX_JSON, {
		blocked: [...byKey.values()],
	})
}

/**
 * 将 personal-lists API `{ entries }` 转为内存过滤集。
 * @param {Array<{ scope?: string, kind?: string, value?: string }>} entries API 条目
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

/**
 * @param {string} viewerEntityHash 观看者实体
 * @returns {Promise<{ blockedEntityHashes: Set<string>, blockedSubjects: Set<string>, hiddenEntityHashes: Set<string>, hiddenSubjects: Set<string> }>} 过滤集
 */
export async function loadPersonalFilterSets(viewerEntityHash) {
	if (!viewerEntityHash)
		return filterSetsFromPersonalListEntries([])
	const [blockedEntries, hiddenEntries] = await Promise.all([
		loadPersonalBlockEntries(viewerEntityHash),
		loadPersonalHideEntries(viewerEntityHash),
	])
	return filterSetsFromPersonalListEntries([
		...blockedEntries.map(entry => ({ ...entry, kind: 'block' })),
		...hiddenEntries.map(entry => ({ ...entry, kind: 'hide' })),
	])
}

/**
 * @param {object} filterSets loadPersonalFilterSets 结果
 * @param {string} authorEntityHash 作者实体
 * @returns {boolean} 是否应过滤
 */
export function isAuthorFilteredByPersonalSets(filterSets, authorEntityHash) {
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
