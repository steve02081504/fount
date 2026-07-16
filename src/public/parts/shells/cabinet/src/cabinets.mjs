import { randomUUID } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'

import { normalizeVisibilitySpec } from '../../social/src/lib/visibilitySpec.mjs'

import { normalizeIndex } from './entryModel.mjs'
import { cabinetIndexPath, cabinetsListPath } from './paths.mjs'
import { publishCabinetLists } from './publish.mjs'

/**
 * @param {string} username 用户
 * @param {string} entityHash 实体
 * @returns {Promise<object[]>} 柜列表
 */
export async function loadCabinets(username, entityHash) {
	try {
		const raw = JSON.parse(await readFile(cabinetsListPath(username, entityHash), 'utf8'))
		return Array.isArray(raw?.cabinets) ? raw.cabinets : []
	}
	catch {
		return []
	}
}

/**
 * @param {string} username 用户
 * @param {string} entityHash 实体
 * @param {object[]} cabinets 柜列表
 * @returns {Promise<void>}
 */
export async function saveCabinets(username, entityHash, cabinets) {
	const path = cabinetsListPath(username, entityHash)
	await mkdir(path.replace(/[/\\][^/\\]+$/, ''), { recursive: true })
	await writeFile(path, JSON.stringify({ cabinets }, null, '\t'), 'utf8')
	await publishCabinetLists(username, entityHash, cabinets).catch(() => { })
}

/**
 * @param {object} draft 草稿
 * @returns {object} 规范化柜
 */
export function normalizeCabinet(draft) {
	const type = draft?.type === 'group' ? 'group' : 'personal'
	const visibility = normalizeVisibilitySpec(draft?.visibility || draft || { visibility: 'private' })
	return {
		cabinet_id: String(draft?.cabinet_id || randomUUID()),
		name: String(draft?.name || 'untitled').slice(0, 256),
		type,
		visibility,
		group_id: type === 'group' ? String(draft?.group_id || '') : undefined,
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
		await mkdir(indexPath.replace(/[/\\][^/\\]+$/, ''), { recursive: true })
		await writeFile(indexPath, JSON.stringify(normalizeIndex({ version: 1, entries: [] }), null, '\t'), 'utf8')
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
	if (cabinetId === 'default') throw new Error('cannot delete default cabinet')
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
	try {
		const raw = JSON.parse(await readFile(cabinetIndexPath(username, entityHash, cabinetId), 'utf8'))
		return normalizeIndex(raw)
	}
	catch {
		return normalizeIndex({ version: 1, entries: [] })
	}
}

/**
 * @param {string} username 用户
 * @param {string} entityHash 实体
 * @param {string} cabinetId 柜 id
 * @param {{ version: number, entries: object[] }} index 索引
 * @returns {Promise<void>}
 */
export async function savePersonalIndex(username, entityHash, cabinetId, index) {
	const path = cabinetIndexPath(username, entityHash, cabinetId)
	await mkdir(path.replace(/[/\\][^/\\]+$/, ''), { recursive: true })
	await writeFile(path, JSON.stringify(normalizeIndex(index), null, '\t'), 'utf8')
}
