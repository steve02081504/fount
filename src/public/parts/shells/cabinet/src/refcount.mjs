import { loadCabinets, loadPersonalIndex, savePersonalIndex } from './cabinets.mjs'
import { listLocalSharedCabinets } from './shared/keys.mjs'
import { loadSharedIndex } from './shared/materialize.mjs'

/**
 * @param {object} link 链接
 * @param {string} owner 目标 owner
 * @param {string} cabinetId 目标柜
 * @param {string | null} entryId 目标条目
 * @returns {boolean} 是否匹配
 */
function matchLink(link, owner, cabinetId, entryId) {
	const linkOwner = String(link.owner_entity_hash || '').toLowerCase()
	if (linkOwner && linkOwner !== owner) return false
	if (String(link.cabinet_id || '') !== cabinetId) return false
	const linkEntry = link.entry_id == null || link.entry_id === '' ? null : String(link.entry_id)
	return linkEntry === entryId
}

/**
 * @param {object[]} entries 条目
 * @param {string} owner 目标 owner
 * @param {string} cabinetId 目标柜
 * @param {string | null} entryId 目标条目
 * @param {Set<string>} [excludeIds] 排除的条目
 * @returns {number} 命中数
 */
function countMatchingLinks(entries, owner, cabinetId, entryId, excludeIds) {
	let count = 0
	for (const entry of entries) {
		if (excludeIds?.has(entry.id)) continue
		if (entry.kind !== 'link' || !entry.link) continue
		if (matchLink(entry.link, owner, cabinetId, entryId)) count++
	}
	return count
}

/**
 * 统计本实体范围内指向某条目的链接数（不含自身）。
 * @param {string} username 用户
 * @param {string} entityHash 实体
 * @param {{ owner_entity_hash: string, cabinet_id: string, entry_id: string | null }} target 目标
 * @param {{ exclude_cabinet_id?: string, exclude_entry_ids?: Set<string> }} [opts] 排除
 * @returns {Promise<number>} 入链数
 */
export async function countLocalInboundLinks(username, entityHash, target, opts = {}) {
	const targetOwner = String(target.owner_entity_hash || entityHash).toLowerCase()
	const targetCabinet = String(target.cabinet_id || '')
	const targetEntry = target.entry_id == null || target.entry_id === '' ? null : String(target.entry_id)
	const excludeCabinet = opts.exclude_cabinet_id
	const excludeIds = opts.exclude_entry_ids || new Set()

	let count = 0
	for (const cabinet of await loadCabinets(username, entityHash)) {
		if (cabinet.type === 'shared' || cabinet.type === 'group') continue
		const index = await loadPersonalIndex(username, entityHash, cabinet.cabinet_id)
		const skip = excludeCabinet && cabinet.cabinet_id === excludeCabinet ? excludeIds : undefined
		count += countMatchingLinks(index.entries, targetOwner, targetCabinet, targetEntry, skip)
	}

	for (const cabinet of await listLocalSharedCabinets(username)) {
		if (excludeCabinet && cabinet.cabinet_id === excludeCabinet) continue
		const index = await loadSharedIndex(username, cabinet.cabinet_id)
		count += countMatchingLinks(index.entries, targetOwner, targetCabinet, targetEntry, excludeIds)
	}
	return count
}

/**
 * 删除链接后：若目标 orphaned 且入链归零则真删。
 * @param {string} username 用户
 * @param {string} entityHash 实体
 * @param {object} linkEntry 被删的链接条目
 * @returns {Promise<void>}
 */
export async function gcOrphanAfterUnlink(username, entityHash, linkEntry) {
	if (linkEntry?.kind !== 'link' || !linkEntry.link) return
	const targetOwner = String(linkEntry.link.owner_entity_hash || entityHash).toLowerCase()
	if (targetOwner !== String(entityHash).toLowerCase()) return
	const cabinetId = String(linkEntry.link.cabinet_id || '')
	const entryId = linkEntry.link.entry_id
	if (!cabinetId || entryId == null || entryId === '') return

	const inbound = await countLocalInboundLinks(username, entityHash, {
		owner_entity_hash: targetOwner,
		cabinet_id: cabinetId,
		entry_id: String(entryId),
	})
	if (inbound > 0) return

	const personal = await loadCabinets(username, entityHash)
	const cabinet = personal.find(row => row.cabinet_id === cabinetId)
	if (cabinet && cabinet.type !== 'shared') {
		const index = await loadPersonalIndex(username, entityHash, cabinetId)
		const target = index.entries.find(row => row.id === entryId)
		if (target?.orphaned) {
			await savePersonalIndex(username, entityHash, cabinetId, {
				version: index.version,
				entries: index.entries.filter(row => row.id !== entryId),
			})
			const { hardDeleteEntryBlobs } = await import('./blobGc.mjs')
			await hardDeleteEntryBlobs(username, entityHash, target)
		}
		return
	}

	const { deleteSharedEntries } = await import('./shared/ops.mjs')
	const sharedIndex = await loadSharedIndex(username, cabinetId)
	const target = sharedIndex.entries.find(row => row.id === entryId)
	if (target?.orphaned)
		await deleteSharedEntries(username, entityHash, cabinetId, [entryId])
}
