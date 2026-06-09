import { loadData, saveData } from '../../server/setting_loader.mjs'
import { createLruMap } from '../memo.mjs'

import { compositeKey } from './composite_key.mjs'
import { parseEntityHash } from './entity_id.mjs'
import { isHex64, normalizeHex64 } from './hexIds.mjs'
import { withAsyncMutex } from './utils/async_mutex.mjs'

const DATA_NAME = 'blocklist'
const INDEX_BY_USER_MAX = 256

/** @typedef {'subject' | 'entity' | 'node'} BlockScope */

/**
 * @typedef {{
 *   blocked: Array<{ scope: BlockScope, value: string, groupId?: string }>
 *   keys: Set<string>
 * }} BlocklistIndex
 */

/** @type {ReturnType<typeof createLruMap<string, BlocklistIndex>>} */
const indexByUser = createLruMap(INDEX_BY_USER_MAX)

/**
 * 串行化拉黑表写路径，避免并发 load/save 覆写。
 * @param {string} username replica 登录名
 * @param {() => void | Promise<void>} mutator 突变
 * @returns {Promise<void>}
 */
function mutateBlocklist(username, mutator) {
	return withAsyncMutex(`blocklist:${username}`, mutator)
}

/**
 * @param {unknown} value entityHash
 * @returns {boolean} 是否为 128 位 entityHash
 */
function isEntityHash128(value) {
	return !!parseEntityHash(value)
}

/**
 * @param {BlockScope} scope 拉黑范围
 * @param {string} groupId 群 ID 或 `*`
 * @param {string} value 键值
 * @returns {string} 索引键
 */
function blockKey(scope, groupId, value) {
	return compositeKey(scope, groupId, value)
}

/**
 * @param {Array<{ scope: BlockScope, value: string, groupId?: string }>} blocked 条目
 * @returns {BlocklistIndex} 内存索引
 */
function buildBlocklistIndex(blocked) {
	/** @type {BlocklistIndex} */
	const index = { blocked, keys: new Set() }
	for (const entry of blocked) {
		const gid = String(entry.groupId || '').trim() || '*'
		if (entry.scope === 'entity') {
			if (gid !== '*') continue
			index.keys.add(blockKey('entity', '*', entry.value))
			continue
		}
		index.keys.add(blockKey(entry.scope, gid, entry.value))
	}
	return index
}

/**
 * @param {string} username replica 登录名
 * @returns {void}
 */
function invalidateBlocklistIndex(username) {
	indexByUser.delete(username)
}

/**
 * @param {string} username replica 登录名
 * @returns {BlocklistIndex} LRU 缓存索引
 */
function getBlocklistIndex(username) {
	let index = indexByUser.get(username)
	if (index) {
		indexByUser.touch(username, index)
		return index
	}
	const blocked = normalizeBlocklist(loadData(username, DATA_NAME)).blocked
	index = buildBlocklistIndex(blocked)
	indexByUser.touch(username, index)
	return index
}

/**
 * @param {unknown} raw 磁盘 JSON 或请求体
 * @returns {{ blocked: Array<{ scope: BlockScope, value: string, groupId?: string }> }} 规范化拉黑表
 */
export function normalizeBlocklist(raw) {
	/** @type {Array<{ scope: BlockScope, value: string, groupId?: string }>} */
	const blocked = []
	for (const entry of raw?.blocked || []) {
		const scope = String(entry?.scope || '').trim().toLowerCase()
		const value = String(entry?.value || '').trim().toLowerCase()
		const groupId = String(entry.groupId || '').trim()
		if (!scope || !value) continue
		if (scope === 'entity' && isEntityHash128(value))
			blocked.push({ scope: 'entity', value, ...groupId ? { groupId } : {} })
		else if (scope === 'node' && isHex64(normalizeHex64(value)))
			blocked.push({ scope: 'node', value: normalizeHex64(value), ...groupId ? { groupId } : {} })
		else if (scope === 'subject' && isHex64(normalizeHex64(value)))
			blocked.push({ scope: 'subject', value: normalizeHex64(value), ...groupId ? { groupId } : {} })
	}
	return { blocked }
}

/**
 * @param {string} username replica 登录名
 * @returns {{ blocked: Array<{ scope: BlockScope, value: string, groupId?: string }> }} 用户级拉黑表
 */
export function loadBlocklist(username) {
	return { blocked: getBlocklistIndex(username).blocked }
}

/**
 * @param {string} username replica 登录名
 * @param {{ blocked: Array<{ scope: BlockScope, value: string, groupId?: string }> }} list 拉黑表
 * @returns {void}
 */
export function saveBlocklist(username, list) {
	const blocked = normalizeBlocklist(list).blocked
	const store = loadData(username, DATA_NAME)
	store.blocked = blocked
	saveData(username, DATA_NAME)
	indexByUser.touch(username, buildBlocklistIndex(blocked))
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
 * @param {BlocklistIndex} index 内存索引
 * @param {object} subject 待检主体
 * @param {string} [groupId] 可选群 scope
 * @returns {boolean} 是否命中
 */
function matchesBlocklistIndex(index, subject, groupId = '') {
	const pk = normalizeHex64(subject?.pubKeyHash)
	const entity = String(subject?.entityHash || '').trim().toLowerCase()
	const node = normalizeHex64(subject?.nodeHash)
	const gid = String(groupId || '').trim()
	const { keys } = index

	if (entity && keys.has(blockKey('entity', '*', entity))) return true
	if (isHex64(node) && keys.has(blockKey('node', '*', node))) return true
	if (isHex64(pk) && keys.has(blockKey('subject', '*', pk))) return true
	if (!gid) return false
	if (isHex64(pk) && keys.has(blockKey('subject', gid, pk))) return true
	if (isHex64(node) && keys.has(blockKey('node', gid, node))) return true
	return false
}

/**
 * @param {string} username replica 登录名
 * @param {object} subject 待检主体
 * @param {string} [groupId] 可选群 scope
 * @returns {boolean} 是否在用户级 blocklist 中
 */
export function isSubjectBlocked(username, subject, groupId = '') {
	return matchesBlocklistIndex(getBlocklistIndex(username), subject, groupId)
}

/**
 * @param {string} username replica 登录名
 * @param {string} groupId 群 ID
 * @param {string} peerKey nodeHash 或 pubKeyHash
 * @returns {boolean} 是否拉黑
 */
export function isPeerKeyBlocked(username, groupId, peerKey) {
	const key = normalizeHex64(peerKey) || String(peerKey || '').trim().toLowerCase()
	if (!key || !isHex64(key)) return false
	return isSubjectBlocked(username, { pubKeyHash: key, nodeHash: key }, groupId)
}

/**
 * @param {string} username replica 登录名
 * @param {string} pubKeyHash 64 hex
 * @returns {boolean} 是否拉黑该 subject
 */
export function isPubKeyHashBlocked(username, pubKeyHash) {
	return isSubjectBlocked(username, { pubKeyHash })
}

/**
 * @param {string} username replica 登录名
 * @param {string} entityHash 128 hex
 * @returns {boolean} 是否拉黑该 entity
 */
export function isEntityHashBlocked(username, entityHash) {
	return isSubjectBlocked(username, { entityHash })
}

/**
 * 追加拉黑并落盘。
 * @param {string} username replica 登录名
 * @param {{ scope: BlockScope, value: string, groupId?: string }} entry 拉黑项
 * @returns {void}
 */
export function addBlocklistEntry(username, entry) {
	const scope = String(entry?.scope || '').trim().toLowerCase()
	const value = String(entry?.value || '').trim().toLowerCase()
	if (!scope || !value)
		throw new Error('scope and value required')
	if (scope === 'subject' && !isHex64(normalizeHex64(value)))
		throw new Error('invalid pubKeyHash')
	if (scope === 'entity' && !isEntityHash128(value))
		throw new Error('invalid entityHash')
	if (scope === 'node' && !isHex64(normalizeHex64(value)))
		throw new Error('invalid nodeHash')

	const normValue = scope === 'node' || scope === 'subject' ? normalizeHex64(value) : value
	const groupId = entry.groupId ? String(entry.groupId).trim() : undefined
	return mutateBlocklist(username, () => {
		const list = loadBlocklist(username)
		if (list.blocked.some(row => row.scope === scope && row.value === normValue && row.groupId === groupId))
			return
		list.blocked.push(groupId ? { scope, value: normValue, groupId } : { scope, value: normValue })
		saveBlocklist(username, list)
	})
}

/**
 * @param {string} username replica 登录名
 * @param {object} banContent member_ban content
 * @param {string} [groupId] 来源群
 * @returns {void}
 */
export function addBlocklistFromBanContent(username, banContent, groupId) {
	const scope = String(banContent?.banScope || 'entity').trim().toLowerCase()
	const sourceGroupId = String(groupId || '').trim()
	if (scope === 'entity' && banContent?.targetEntityHash)
		addBlocklistEntry(username, { scope: 'entity', value: banContent.targetEntityHash })
	if (scope === 'node' && banContent?.targetNodeHash)
		addBlocklistEntry(username, { scope: 'node', value: banContent.targetNodeHash })
	const pk = normalizeHex64(banContent?.targetPubKeyHash)
	if (isHex64(pk))
		addBlocklistEntry(username, { scope: 'subject', value: pk, ...sourceGroupId ? { groupId: sourceGroupId } : {} })
}

/**
 * @param {string} username replica 登录名
 * @param {string} entityHash 128 hex
 * @param {boolean} block true=拉黑
 * @returns {boolean} 当前是否拉黑
 */
export function setEntityBlocked(username, entityHash, block) {
	const id = String(entityHash || '').trim().toLowerCase()
	if (!isEntityHash128(id)) throw new Error('invalid entityHash')
	return mutateBlocklist(username, () => {
		const list = loadBlocklist(username)
		const without = list.blocked.filter(e => !(e.scope === 'entity' && e.value === id))
		if (block) without.push({ scope: 'entity', value: id })
		saveBlocklist(username, { blocked: without })
	}).then(() => block)
}

/**
 * 追加群 scope 拉黑项。
 * @param {string} username replica 登录名
 * @param {string} groupId 群 ID
 * @param {BlockScope} scope subject | entity | node
 * @param {string} value 键值
 * @returns {void}
 */
export function addGroupBlockedPeer(username, groupId, scope, value) {
	addBlocklistEntry(username, { scope, value, groupId })
}

/**
 * @param {string} username replica 登录名
 * @param {string} groupId 群 ID
 * @param {BlockScope} scope subject | entity | node
 * @param {string} value 键值
 * @returns {void}
 */
export function removeGroupBlockedPeer(username, groupId, scope, value) {
	const normScope = String(scope || '').trim().toLowerCase()
	const id = String(value || '').trim().toLowerCase()
	if (!normScope || !id) return Promise.resolve()
	return mutateBlocklist(username, () => {
		const list = loadBlocklist(username)
		list.blocked = list.blocked.filter(entry =>
			!(entry.scope === normScope && entry.value === id && entry.groupId === groupId),
		)
		saveBlocklist(username, list)
	})
}

/**
 * @param {string} username replica 登录名
 * @param {string} groupId 群 ID
 * @param {Array<{ scope: BlockScope, value: string }>} entries 拉黑条目
 * @returns {void}
 */
export function addGroupBlockedPeers(username, groupId, entries) {
	for (const entry of entries) {
		if (!entry?.scope || !entry?.value) continue
		addGroupBlockedPeer(username, groupId, entry.scope, entry.value)
	}
}

/**
 * @param {string} username replica 登录名
 * @returns {void}
 */
export { invalidateBlocklistIndex }
