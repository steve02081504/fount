import { getCabinet, loadPersonalIndex } from './cabinets.mjs'
import { listGroupCabinetEntries } from './groupCabinet.mjs'

/**
 * 解析链接条目目标。
 * @param {string} username 用户
 * @param {string} entityHash 当前实体
 * @param {string} cabinetId 柜
 * @param {string} entryId 链接条目
 * @returns {Promise<{ ok: boolean, reason?: string, target?: object }>} 解析结果
 */
export async function resolveLink(username, entityHash, cabinetId, entryId) {
	const cabinet = await getCabinet(username, entityHash, cabinetId)
	if (!cabinet) return { ok: false, reason: 'cabinet not found' }
	if (cabinet.type === 'group') return { ok: false, reason: 'links not supported in group cabinets yet' }

	const index = await loadPersonalIndex(username, entityHash, cabinetId)
	const entry = index.entries.find(row => row.id === entryId)
	if (!entry) return { ok: false, reason: 'entry not found' }
	if (entry.kind !== 'link' || !entry.link)
		return { ok: false, reason: 'not a link' }

	const targetOwner = entry.link.owner_entity_hash || entityHash
	const targetCabinetId = entry.link.cabinet_id
	const targetEntryId = entry.link.entry_id

	try {
		const targetCabinet = await getCabinet(username, targetOwner, targetCabinetId)
		if (!targetCabinet && !String(targetCabinetId).startsWith('group:'))
			return { ok: false, reason: 'target cabinet missing' }

		if (targetEntryId == null) 
			return {
				ok: true,
				target: {
					kind: 'cabinet',
					owner_entity_hash: targetOwner,
					cabinet_id: targetCabinetId,
					cabinet: targetCabinet,
				},
			}
		

		if (targetCabinet?.type === 'group') {
			const listed = await listGroupCabinetEntries(username, entityHash, targetCabinet, { show_hidden: true })
			const flat = listed.entries
			// group list is only one folder level; re-fetch root for lookup
			const found = flat.find(row => row.id === targetEntryId)
				|| await findInGroup(username, entityHash, targetCabinet, targetEntryId)
			if (!found) return { ok: false, reason: 'target entry missing' }
			return {
				ok: true,
				target: {
					kind: found.kind,
					owner_entity_hash: targetOwner,
					cabinet_id: targetCabinetId,
					entry: found,
				},
			}
		}

		const targetIndex = await loadPersonalIndex(username, targetOwner, targetCabinetId)
		const targetEntry = targetIndex.entries.find(row => row.id === targetEntryId)
		if (!targetEntry) return { ok: false, reason: 'target entry missing' }
		return {
			ok: true,
			target: {
				kind: targetEntry.kind,
				owner_entity_hash: targetOwner,
				cabinet_id: targetCabinetId,
				entry: targetEntry,
			},
		}
	}
	catch (error) {
		return { ok: false, reason: error?.message || 'resolve failed' }
	}
}

/**
 * @param {string} username 用户
 * @param {string} entityHash 实体
 * @param {object} cabinet 群柜
 * @param {string} entryId 条目
 * @returns {Promise<object | null>} 条目
 */
async function findInGroup(username, entityHash, cabinet, entryId) {
	const listed = await listGroupCabinetEntries(username, entityHash, cabinet, {
		parent_id: null,
		show_hidden: true,
	})
	return listed.entries.find(row => row.id === entryId) || null
}
