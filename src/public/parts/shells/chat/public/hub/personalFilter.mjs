/**
 * Hub 侧加载当前 viewer 实体的个人拉黑/隐藏列表（与 Social 共享）。
 */
import {
	fetchPersonalFilterSets,
	isPersonallyFiltered,
	normalizePersonalFilterResponse,
} from '../src/lib/personalFilterClient.mjs'

import { hubStore } from './core/state.mjs'

/** @type {ReturnType<typeof normalizePersonalFilterResponse> | null} */
let cachedFilter = null

/**
 * @returns {Promise<ReturnType<typeof normalizePersonalFilterResponse>>} 过滤集
 */
export async function loadHubPersonalFilter() {
	cachedFilter = await fetchPersonalFilterSets()
	return cachedFilter
}

/**
 * @returns {ReturnType<typeof normalizePersonalFilterResponse>} 缓存或空过滤集
 */
export function getHubPersonalFilter() {
	return cachedFilter || normalizePersonalFilterResponse()
}

/**
 * @param {string} entityHash 成员实体
 * @param {string} [pubKeyHash] 用户成员 pubKeyHash
 * @returns {boolean} 是否应隐藏（拉黑或隐藏）
 */
export function isHubMemberPersonallyFiltered(entityHash, pubKeyHash = '') {
	return isPersonallyFiltered(getHubPersonalFilter(), entityHash, pubKeyHash)
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
	const actingEntityHash = hubStore.operatorEntityHash
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
	await loadHubPersonalFilter()
}
