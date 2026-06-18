/**
 * Hub 侧加载当前 viewer 实体的个人拉黑/隐藏列表（与 Social 共享）。
 */
import { hubStore } from './core/state.mjs'

/** @type {{ blockedEntityHashes: Set<string>, blockedSubjects: Set<string>, hiddenEntityHashes: Set<string>, hiddenSubjects: Set<string> } | null} */
let cachedFilter = null

/**
 * @param {object} raw API 响应
 * @returns {{ blockedEntityHashes: Set<string>, blockedSubjects: Set<string>, hiddenEntityHashes: Set<string>, hiddenSubjects: Set<string> }} 规范化过滤集
 */
function normalizeFilterResponse(raw) {
	return {
		blockedEntityHashes: new Set((raw?.blockedEntityHashes || []).map(id => String(id).toLowerCase())),
		blockedSubjects: new Set((raw?.blockedSubjects || []).map(id => String(id).toLowerCase())),
		hiddenEntityHashes: new Set((raw?.hiddenEntityHashes || []).map(id => String(id).toLowerCase())),
		hiddenSubjects: new Set((raw?.hiddenSubjects || []).map(id => String(id).toLowerCase())),
	}
}

/**
 * @param {string} [actingEntityHash] viewer 实体，默认 hubStore.viewerEntityHash
 * @returns {Promise<{ blockedEntityHashes: Set<string>, blockedSubjects: Set<string>, hiddenEntityHashes: Set<string>, hiddenSubjects: Set<string> }>} 过滤集
 */
export async function loadHubPersonalFilter(actingEntityHash = hubStore.viewerEntityHash) {
	const actor = String(actingEntityHash || '').trim().toLowerCase()
	if (!actor) return normalizeFilterResponse({})
	const url = new URL('/api/parts/shells:social/profile/personal-lists', window.location.origin)
	url.searchParams.set('actingEntityHash', actor)
	const resp = await fetch(url, { credentials: 'include' })
	if (!resp.ok) return normalizeFilterResponse({})
	cachedFilter = normalizeFilterResponse(await resp.json())
	return cachedFilter
}

/**
 * @returns {{ blockedEntityHashes: Set<string>, blockedSubjects: Set<string>, hiddenEntityHashes: Set<string>, hiddenSubjects: Set<string> }} 缓存或空过滤集
 */
export function getHubPersonalFilter() {
	return cachedFilter || normalizeFilterResponse({})
}

/**
 * @param {string} entityHash 成员实体
 * @param {string} [pubKeyHash] 用户成员 pubKeyHash
 * @returns {boolean} 是否应隐藏（拉黑或隐藏）
 */
export function isHubMemberPersonallyFiltered(entityHash, pubKeyHash = '') {
	const filter = getHubPersonalFilter()
	const entity = String(entityHash || '').trim().toLowerCase()
	const pk = String(pubKeyHash || '').trim().toLowerCase()
	if (entity && (filter.blockedEntityHashes.has(entity) || filter.hiddenEntityHashes.has(entity)))
		return true
	if (pk && (filter.blockedSubjects.has(pk) || filter.hiddenSubjects.has(pk)))
		return true
	if (entity.length === 128) {
		const subject = entity.slice(64)
		if (filter.blockedSubjects.has(subject) || filter.hiddenSubjects.has(subject))
			return true
	}
	return false
}

/**
 * @returns {void}
 */
export function invalidateHubPersonalFilter() {
	cachedFilter = null
}

/**
 * @param {string} targetEntityHash 目标
 * @param {boolean} block true=拉黑
 * @returns {Promise<void>}
 */
export async function postPersonalBlock(targetEntityHash, block) {
	const actingEntityHash = hubStore.viewerEntityHash
	if (!actingEntityHash) throw new Error('viewer entity required')
	const resp = await fetch('/api/parts/shells:social/profile/block', {
		method: 'POST',
		credentials: 'include',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ entityHash: targetEntityHash, actingEntityHash, block }),
	})
	if (!resp.ok) {
		const data = await resp.json().catch(() => ({}))
		throw new Error(data.error || resp.statusText)
	}
	invalidateHubPersonalFilter()
	await loadHubPersonalFilter(actingEntityHash)
}
