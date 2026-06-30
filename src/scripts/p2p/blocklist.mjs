import { compositeKey } from './composite_key.mjs'
import { parseEntityHash } from './entity_id.mjs'
import { isHex64, normalizeHex64 } from './hexIds.mjs'
import { readNodeJsonSync, writeNodeJsonSync } from './node/storage.mjs'
import { withAsyncMutex } from './utils/async_mutex.mjs'

const DATA_NAME = 'blocklist'

/** @typedef {'subject' | 'entity' | 'node'} BlockScope */

/**
 * @typedef {{
 *   blocked: Array<{ scope: BlockScope, value: string, groupId?: string }>
 *   keys: Set<string>
 * }} BlocklistIndex
 */

/** @type {BlocklistIndex | null} */
let cachedIndex = null

/**
 * 串行化拉黑表写路径，避免并发 load/save 覆写。
 * @param {() => void | Promise<void>} mutator 突变
 * @returns {Promise<void>}
 */
function mutateBlocklist(mutator) {
	return withAsyncMutex('blocklist', mutator)
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
 * @returns {void}
 */
export function invalidateBlocklistIndex() {
	cachedIndex = null
}

/**
 * @returns {BlocklistIndex} 缓存索引
 */
function getBlocklistIndex() {
	if (cachedIndex) return cachedIndex
	const raw = readNodeJsonSync(DATA_NAME)
	const blocked = normalizeBlocklist(raw).blocked
	cachedIndex = buildBlocklistIndex(blocked)
	return cachedIndex
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
 * @returns {{ blocked: Array<{ scope: BlockScope, value: string, groupId?: string }> }} 节点级拉黑表
 */
export function loadBlocklist() {
	return { blocked: getBlocklistIndex().blocked }
}

/**
 * @param {{ blocked: Array<{ scope: BlockScope, value: string, groupId?: string }> }} list 拉黑表
 * @returns {void}
 */
export function saveBlocklist(list) {
	const blocked = normalizeBlocklist(list).blocked
	writeNodeJsonSync(DATA_NAME, { blocked })
	cachedIndex = buildBlocklistIndex(blocked)
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
 * @param {object} subject 待检主体
 * @param {string} [groupId] 可选群 scope
 * @returns {boolean} 是否在节点级 blocklist 中
 */
export function isSubjectBlocked(subject, groupId = '') {
	return matchesBlocklistIndex(getBlocklistIndex(), subject, groupId)
}

/**
 * @param {string} groupId 群 ID
 * @param {string} peerKey nodeHash 或 pubKeyHash
 * @returns {boolean} 是否拉黑
 */
export function isPeerKeyBlocked(groupId, peerKey) {
	const key = normalizeHex64(peerKey) || String(peerKey || '').trim().toLowerCase()
	if (!key || !isHex64(key)) return false
	return isSubjectBlocked({ pubKeyHash: key, nodeHash: key }, groupId)
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
 * @param {{ scope: BlockScope, value: string, groupId?: string }} entry 拉黑项
 * @returns {void}
 */
export function addBlocklistEntry(entry) {
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
	return mutateBlocklist(() => {
		const list = loadBlocklist()
		if (list.blocked.some(row => row.scope === scope && row.value === normValue && row.groupId === groupId))
			return
		list.blocked.push(groupId ? { scope, value: normValue, groupId } : { scope, value: normValue })
		saveBlocklist(list)
	})
}

/**
 * @param {object} banContent member_ban content
 * @param {string} [groupId] 来源群
 * @returns {void}
 */
export function addBlocklistFromBanContent(banContent, groupId) {
	const scope = String(banContent?.banScope || 'entity').trim().toLowerCase()
	const sourceGroupId = String(groupId || '').trim()
	if (scope === 'entity' && banContent?.targetEntityHash)
		addBlocklistEntry({ scope: 'entity', value: banContent.targetEntityHash })
	if (scope === 'node' && banContent?.targetNodeHash)
		addBlocklistEntry({ scope: 'node', value: banContent.targetNodeHash })
	const pk = normalizeHex64(banContent?.targetPubKeyHash)
	if (isHex64(pk))
		addBlocklistEntry({ scope: 'subject', value: pk, ...sourceGroupId ? { groupId: sourceGroupId } : {} })
}

/**
 * @param {string} entityHash 128 hex
 * @param {boolean} block true=拉黑
 * @returns {boolean} 当前是否拉黑
 */
export function setEntityBlocked(entityHash, block) {
	const id = String(entityHash || '').trim().toLowerCase()
	if (!isEntityHash128(id)) throw new Error('invalid entityHash')
	return mutateBlocklist(() => {
		const list = loadBlocklist()
		const without = list.blocked.filter(e => !(e.scope === 'entity' && e.value === id))
		if (block) without.push({ scope: 'entity', value: id })
		saveBlocklist({ blocked: without })
	}).then(() => block)
}

/**
 * 追加群 scope 拉黑项。
 * @param {string} groupId 群 ID
 * @param {BlockScope} scope subject | entity | node
 * @param {string} value 键值
 * @returns {void}
 */
export function addGroupBlockedPeer(groupId, scope, value) {
	addBlocklistEntry({ scope, value, groupId })
}

/**
 * @param {string} groupId 群 ID
 * @param {BlockScope} scope subject | entity | node
 * @param {string} value 键值
 * @returns {void}
 */
export function removeGroupBlockedPeer(groupId, scope, value) {
	const normScope = String(scope || '').trim().toLowerCase()
	const id = String(value || '').trim().toLowerCase()
	if (!normScope || !id) return Promise.resolve()
	return mutateBlocklist(() => {
		const list = loadBlocklist()
		list.blocked = list.blocked.filter(entry =>
			!(entry.scope === normScope && entry.value === id && entry.groupId === groupId),
		)
		saveBlocklist(list)
	})
}

/**
 * @param {string} groupId 群 ID
 * @param {Array<{ scope: BlockScope, value: string }>} entries 拉黑条目
 * @returns {void}
 */
export function addGroupBlockedPeers(groupId, entries) {
	for (const entry of entries) {
		if (!entry?.scope || !entry?.value) continue
		addGroupBlockedPeer(groupId, entry.scope, entry.value)
	}
}
