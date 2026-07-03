import { compositeKey } from './composite_key.mjs'
import { isEntityHash128 } from './entity_id.mjs'
import { isHex64, normalizeHex64 } from './hexIds.mjs'
import { readNodeJsonSync, writeNodeJsonSync } from './node/storage.mjs'
import { withAsyncMutex } from './utils/async_mutex.mjs'

const DATA_NAME = 'denylist'

/** @typedef {'subject' | 'entity' | 'node'} DenyScope — 节点连接拒绝（deny），非 Social block / 群 ban */

/**
 * @typedef {{
 *   blocked: Array<{ scope: DenyScope, value: string, groupId?: string }>
 *   keys: Set<string>
 * }} DenylistIndex
 */

/** @type {DenylistIndex | null} */
let cachedIndex = null

/**
 * 串行化 denylist 写路径，避免并发 load/save 覆写。
 * @param {() => void | Promise<void>} mutator 突变
 * @returns {Promise<void>}
 */
function mutateDenylist(mutator) {
	return withAsyncMutex('denylist', mutator)
}

/**
 * @param {DenyScope} scope 拉黑范围
 * @param {string} groupId 群 ID 或 `*`
 * @param {string} value 键值
 * @returns {string} 索引键
 */
function denyKey(scope, groupId, value) {
	return compositeKey(scope, groupId, value)
}

/**
 * @param {Array<{ scope: DenyScope, value: string, groupId?: string }>} blocked 条目
 * @returns {DenylistIndex} 内存索引
 */
function buildDenylistIndex(blocked) {
	/** @type {DenylistIndex} */
	const index = { blocked, keys: new Set() }
	for (const entry of blocked) {
		const gid = String(entry.groupId || '').trim() || '*'
		if (entry.scope === 'entity') {
			index.keys.add(denyKey('entity', '*', entry.value))
			continue
		}
		index.keys.add(denyKey(entry.scope, gid, entry.value))
	}
	return index
}

/**
 * @returns {void}
 */
export function invalidateDenylistIndex() {
	cachedIndex = null
}

/**
 * @returns {DenylistIndex} 缓存索引
 */
function getDenylistIndex() {
	if (cachedIndex) return cachedIndex
	const raw = readNodeJsonSync(DATA_NAME)
	const blocked = normalizeDenylist(raw).blocked
	cachedIndex = buildDenylistIndex(blocked)
	return cachedIndex
}

/**
 * @param {unknown} raw 磁盘 JSON 或请求体
 * @returns {{ blocked: Array<{ scope: DenyScope, value: string, groupId?: string }> }} 规范化 denylist
 */
export function normalizeDenylist(raw) {
	/** @type {Array<{ scope: DenyScope, value: string, groupId?: string }>} */
	const blocked = []
	for (const entry of raw?.blocked || []) {
		const scope = String(entry?.scope || '').trim().toLowerCase()
		const value = String(entry?.value || '').trim().toLowerCase()
		const groupId = String(entry.groupId || '').trim()
		if (!scope || !value) continue
		if (scope === 'entity') {
			if (isEntityHash128(value))
				blocked.push({ scope: 'entity', value })
			continue
		}
		if (scope === 'node' && isHex64(normalizeHex64(value)))
			blocked.push({ scope: 'node', value: normalizeHex64(value), ...groupId ? { groupId } : {} })
		else if (scope === 'subject' && isHex64(normalizeHex64(value)))
			blocked.push({ scope: 'subject', value: normalizeHex64(value), ...groupId ? { groupId } : {} })
	}
	return { blocked }
}

/**
 * @returns {{ blocked: Array<{ scope: DenyScope, value: string, groupId?: string }> }} 节点级 denylist
 */
export function loadDenylist() {
	return { blocked: getDenylistIndex().blocked }
}

/**
 * @param {{ blocked: Array<{ scope: DenyScope, value: string, groupId?: string }> }} list denylist
 * @returns {void}
 */
export function saveDenylist(list) {
	const blocked = normalizeDenylist(list).blocked
	writeNodeJsonSync(DATA_NAME, { blocked })
	cachedIndex = buildDenylistIndex(blocked)
}

/**
 * @param {object} state 物化群状态
 * @param {object} subject 待检主体
 * @returns {boolean} 是否命中群级 ban 集合
 */
export function isSubjectBannedByState(state, subject) {
	const pk = normalizeHex64(subject?.pubKeyHash)
	if (isHex64(pk) && state?.bannedMembers?.has?.(pk)) return true
	const entity = String(subject?.entityHash || '').trim().toLowerCase()
	if (isEntityHash128(entity) && state?.bannedEntities?.has?.(entity)) return true
	const node = normalizeHex64(subject?.nodeHash)
	if (isHex64(node) && state?.bannedNodes?.has?.(node)) return true
	return false
}

/**
 * @param {DenylistIndex} index 内存索引
 * @param {object} subject 待检主体
 * @param {string} [groupId] 可选群 scope
 * @returns {boolean} 是否命中
 */
function matchesDenylistIndex(index, subject, groupId = '') {
	const pk = normalizeHex64(subject?.pubKeyHash)
	const entity = String(subject?.entityHash || '').trim().toLowerCase()
	const node = normalizeHex64(subject?.nodeHash)
	const gid = String(groupId || '').trim()
	const { keys } = index

	if (entity && keys.has(denyKey('entity', '*', entity))) return true
	if (isHex64(node) && keys.has(denyKey('node', '*', node))) return true
	if (isHex64(pk) && keys.has(denyKey('subject', '*', pk))) return true
	if (!gid) return false
	if (isHex64(pk) && keys.has(denyKey('subject', gid, pk))) return true
	if (isHex64(node) && keys.has(denyKey('node', gid, node))) return true
	return false
}

/**
 * @param {object} subject 待检主体
 * @param {string} [groupId] 可选群 scope
 * @returns {boolean} 是否在节点级 denylist 中（deny，非 Social block）
 */
export function isSubjectBlocked(subject, groupId = '') {
	return matchesDenylistIndex(getDenylistIndex(), subject, groupId)
}

/**
 * @param {string} groupId 群 ID
 * @param {string} peerKey pubKeyHash 或 nodeHash（按 scope 分别匹配，不混填）
 * @returns {boolean} 是否拉黑
 */
export function isPeerKeyBlocked(groupId, peerKey) {
	const key = normalizeHex64(peerKey)
	if (!isHex64(key)) return false
	const index = getDenylistIndex()
	const gid = String(groupId || '').trim()
	const { keys } = index
	if (keys.has(denyKey('subject', '*', key))) return true
	if (keys.has(denyKey('node', '*', key))) return true
	if (!gid) return false
	if (keys.has(denyKey('subject', gid, key))) return true
	if (keys.has(denyKey('node', gid, key))) return true
	return false
}

/**
 * @param {string} pubKeyHash 64 hex
 * @returns {boolean} 是否拉黑该 subject
 */
export function isPubKeyHashBlocked(pubKeyHash) {
	return isSubjectBlocked({ pubKeyHash })
}

/**
 * @param {string} entityHash 128 hex
 * @returns {boolean} 是否拉黑该 entity
 */
export function isEntityHashBlocked(entityHash) {
	return isSubjectBlocked({ entityHash })
}

/**
 * 追加拉黑并落盘。
 * @param {{ scope: DenyScope, value: string, groupId?: string }} entry 拉黑项
 * @returns {Promise<void>}
 */
export function addDenylistEntry(entry) {
	const scope = String(entry?.scope || '').trim().toLowerCase()
	const value = String(entry?.value || '').trim().toLowerCase()
	if (!scope || !value)
		throw new Error('scope and value required')
	if (scope === 'entity' && entry.groupId)
		throw new Error('entity scope does not use groupId')
	if (scope === 'subject' && !isHex64(normalizeHex64(value)))
		throw new Error('invalid pubKeyHash')
	if (scope === 'entity' && !isEntityHash128(value))
		throw new Error('invalid entityHash')
	if (scope === 'node' && !isHex64(normalizeHex64(value)))
		throw new Error('invalid nodeHash')

	const normValue = scope === 'node' || scope === 'subject' ? normalizeHex64(value) : value
	const groupId = entry.groupId ? String(entry.groupId).trim() : undefined
	return mutateDenylist(() => {
		const list = loadDenylist()
		if (list.blocked.some(row => row.scope === scope && row.value === normValue && row.groupId === groupId))
			return
		list.blocked.push(groupId ? { scope, value: normValue, groupId } : { scope, value: normValue })
		saveDenylist(list)
	})
}

/**
 * @param {object} banContent member_ban content
 * @param {string} [groupId] 来源群
 * @returns {Promise<void>}
 */
export async function addDenylistFromBanContent(banContent, groupId) {
	const scope = String(banContent?.banScope || 'entity').trim().toLowerCase()
	const sourceGroupId = String(groupId || '').trim()
	if (scope === 'entity' && banContent?.targetEntityHash)
		await addDenylistEntry({ scope: 'entity', value: banContent.targetEntityHash })
	if (scope === 'node' && banContent?.targetNodeHash)
		await addDenylistEntry({ scope: 'node', value: banContent.targetNodeHash })
	const pk = normalizeHex64(banContent?.targetPubKeyHash)
	if (isHex64(pk))
		await addDenylistEntry({ scope: 'subject', value: pk, ...sourceGroupId ? { groupId: sourceGroupId } : {} })
}

/**
 * @param {string} entityHash 128 hex
 * @param {boolean} block true=拉黑
 * @returns {Promise<boolean>} 当前是否拉黑
 */
export async function setEntityBlocked(entityHash, block) {
	const id = String(entityHash || '').trim().toLowerCase()
	if (!isEntityHash128(id)) throw new Error('invalid entityHash')
	await mutateDenylist(() => {
		const list = loadDenylist()
		const without = list.blocked.filter(e => !(e.scope === 'entity' && e.value === id))
		if (block) without.push({ scope: 'entity', value: id })
		saveDenylist({ blocked: without })
	})
	return block
}

/**
 * 追加群 scope 拉黑项。
 * @param {string} groupId 群 ID
 * @param {DenyScope} scope subject | entity | node
 * @param {string} value 键值
 * @returns {Promise<void>}
 */
export function addGroupBlockedPeer(groupId, scope, value) {
	return addDenylistEntry({ scope, value, groupId })
}

/**
 * @param {string} groupId 群 ID
 * @param {DenyScope} scope subject | entity | node
 * @param {string} value 键值
 * @returns {Promise<void>}
 */
export function removeGroupBlockedPeer(groupId, scope, value) {
	const normScope = String(scope || '').trim().toLowerCase()
	const id = String(value || '').trim().toLowerCase()
	if (!normScope || !id) return Promise.resolve()
	return mutateDenylist(() => {
		const list = loadDenylist()
		list.blocked = list.blocked.filter(entry =>
			!(entry.scope === normScope && entry.value === id && entry.groupId === groupId),
		)
		saveDenylist(list)
	})
}

/**
 * @param {string} groupId 群 ID
 * @param {Array<{ scope: DenyScope, value: string }>} entries 拉黑条目
 * @returns {Promise<void>}
 */
export async function addGroupBlockedPeers(groupId, entries) {
	for (const entry of entries) {
		if (!entry?.scope || !entry?.value) continue
		await addGroupBlockedPeer(groupId, entry.scope, entry.value)
	}
}
