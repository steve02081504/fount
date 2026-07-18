import { randomUUID } from 'node:crypto'

import { normalizeVisibilitySpec } from '../../social/src/lib/visibilitySpec.mjs'

import { normalizeIndex } from './entryModel.mjs'
import { readJsonFile, writeJsonFile } from './io.mjs'
import { cabinetIndexPath, cabinetsListPath } from './paths.mjs'
import { publishCabinetLists } from './publish.mjs'

/**
 * @param {string} username 用户
 * @param {string} entityHash 实体
 * @returns {Promise<object[]>} 柜列表
 */
export async function loadCabinets(username, entityHash) {
	const raw = await readJsonFile(cabinetsListPath(username, entityHash), { cabinets: [] })
	return Array.isArray(raw?.cabinets) ? raw.cabinets : []
}

/**
 * @param {string} username 用户
 * @param {string} entityHash 实体
 * @param {object[]} cabinets 柜列表
 * @returns {Promise<void>}
 */
export async function saveCabinets(username, entityHash, cabinets) {
	await writeJsonFile(cabinetsListPath(username, entityHash), { cabinets })
	await publishCabinetLists(username, entityHash, cabinets).catch(() => { })
}

/**
 * @param {object} draft 草稿
 * @returns {object} 规范化柜
 */
export function normalizeCabinet(draft) {
	const type = draft?.type === 'shared' ? 'shared' : 'personal'
	const visibility = normalizeVisibilitySpec(draft?.visibility || draft || { visibility: 'private' })
	return {
		cabinet_id: String(draft?.cabinet_id || randomUUID()),
		name: String(draft?.name || 'untitled').slice(0, 256),
		type,
		visibility,
		write_pubkey: type === 'shared' ? String(draft?.write_pubkey || '') : undefined,
		created_at: Number(draft?.created_at) || Date.now(),
		sync_binding: draft?.sync_binding || null,
	}
}

/**
 * @param {string} username 用户
 * @param {string} entityHash 实体
 * @param {object} draft 草稿
 * @returns {Promise<object>} 新建柜
 */
export async function createCabinet(username, entityHash, draft) {
	const cabinets = await loadCabinets(username, entityHash)
	const cabinet = normalizeCabinet(draft)
	if (cabinets.some(row => row.cabinet_id === cabinet.cabinet_id))
		throw new Error('cabinet exists')
	cabinets.push(cabinet)
	await saveCabinets(username, entityHash, cabinets)
	if (cabinet.type === 'personal') {
		const indexPath = cabinetIndexPath(username, entityHash, cabinet.cabinet_id)
		await writeJsonFile(indexPath, normalizeIndex({ version: 1, entries: [] }))
	}
	return cabinet
}

/**
 * @param {string} username 用户
 * @param {string} entityHash 实体
 * @param {string} cabinetId 柜 id
 * @returns {Promise<object | null>} 柜
 */
export async function getCabinet(username, entityHash, cabinetId) {
	const cabinets = await loadCabinets(username, entityHash)
	return cabinets.find(row => row.cabinet_id === cabinetId) || null
}

/**
 * @param {string} username 用户
 * @param {string} entityHash 实体
 * @param {string} cabinetId 柜
 * @returns {Promise<object | null>} 个人或共享柜
 */
export async function resolveCabinet(username, entityHash, cabinetId) {
	const personal = await getCabinet(username, entityHash, cabinetId)
	if (personal) return personal
	const { getSharedCabinetMeta } = await import('./shared/keys.mjs')
	return getSharedCabinetMeta(username, cabinetId)
}

/**
 * @param {string} username 用户
 * @param {string} entityHash 实体
 * @param {string} cabinetId 柜
 * @param {object} cabinet 柜元数据
 * @returns {Promise<{ version: number, entries: object[] }>} 索引
 */
export async function loadCabinetIndex(username, entityHash, cabinetId, cabinet) {
	if (cabinet.type === 'shared') {
		const { loadSharedIndex } = await import('./shared/materialize.mjs')
		return loadSharedIndex(username, cabinetId)
	}
	return loadPersonalIndex(username, entityHash, cabinetId)
}

/**
 * @param {string} username 用户
 * @param {string} entityHash 实体
 * @param {string} cabinetId 柜 id
 * @param {object} patch 补丁
 * @returns {Promise<object>} 更新后的柜
 */
export async function updateCabinet(username, entityHash, cabinetId, patch) {
	const cabinets = await loadCabinets(username, entityHash)
	const index = cabinets.findIndex(row => row.cabinet_id === cabinetId)
	if (index < 0) throw new Error('cabinet not found')
	const current = cabinets[index]
	const next = { ...current }
	if (patch.name != null) next.name = String(patch.name).slice(0, 256)
	if (patch.visibility != null) next.visibility = normalizeVisibilitySpec(patch.visibility)
	if (patch.sync_binding !== undefined) next.sync_binding = patch.sync_binding
	cabinets[index] = next
	await saveCabinets(username, entityHash, cabinets)
	return next
}

/**
 * @param {string} username 用户
 * @param {string} entityHash 实体
 * @param {string} cabinetId 柜 id
 * @returns {Promise<void>}
 */
export async function deleteCabinet(username, entityHash, cabinetId) {
	const cabinets = await loadCabinets(username, entityHash)
	const next = cabinets.filter(row => row.cabinet_id !== cabinetId)
	if (next.length === cabinets.length) throw new Error('cabinet not found')
	await saveCabinets(username, entityHash, next)
}

/**
 * @param {string} username 用户
 * @param {string} entityHash 实体
 * @param {string} cabinetId 柜 id
 * @returns {Promise<{ version: number, entries: object[] }>} 索引
 */
export async function loadPersonalIndex(username, entityHash, cabinetId) {
	const raw = await readJsonFile(cabinetIndexPath(username, entityHash, cabinetId), null)
	return normalizeIndex(raw || { version: 1, entries: [] })
}

/**
 * @param {string} username 用户
 * @param {string} entityHash 实体
 * @param {string} cabinetId 柜 id
 * @param {{ version: number, entries: object[] }} index 索引
 * @returns {Promise<void>}
 */
export async function savePersonalIndex(username, entityHash, cabinetId, index) {
	const normalized = normalizeIndex(index)
	await writeJsonFile(cabinetIndexPath(username, entityHash, cabinetId), normalized)
	const cabinet = await getCabinet(username, entityHash, cabinetId)
	if (cabinet?.type === 'personal') {
		const { publishCabinetIndex } = await import('./publish.mjs')
		await publishCabinetIndex(username, entityHash, cabinet, normalized).catch(() => { })
	}
}
