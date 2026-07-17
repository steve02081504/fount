import { getCabinet, loadPersonalIndex } from './cabinets.mjs'
import { getSharedCabinetMeta } from './shared/keys.mjs'
import { loadSharedIndex } from './shared/materialize.mjs'

/**
 * 解析链接条目目标。
 * @param {string} username 用户
 * @param {string} entityHash 当前实体
 * @param {string} cabinetId 柜
 * @param {string} entryId 链接条目
 * @returns {Promise<{ ok: boolean, reason?: string, target?: object }>} 解析结果
 */
export async function resolveLink(username, entityHash, cabinetId, entryId) {
	const entry = await findEntry(username, entityHash, cabinetId, entryId)
	if (!entry) return { ok: false, reason: 'entry not found' }
	if (entry.kind !== 'link' || !entry.link)
		return { ok: false, reason: 'not a link' }

	const targetOwner = entry.link.owner_entity_hash || entityHash
	const targetCabinetId = entry.link.cabinet_id
	const targetEntryId = entry.link.entry_id

	try {
		if (targetEntryId == null)
			return {
				ok: true,
				target: {
					kind: 'cabinet',
					owner_entity_hash: targetOwner,
					cabinet_id: targetCabinetId,
					cabinet: await resolveCabinetMeta(username, targetOwner, targetCabinetId),
				},
			}

		const found = await findEntry(username, targetOwner, targetCabinetId, targetEntryId)
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
	catch (error) {
		return { ok: false, reason: error?.message || 'resolve failed' }
	}
}

/**
 * @param {string} username 用户
 * @param {string} entityHash 实体
 * @param {string} cabinetId 柜
 * @returns {Promise<object | null>} 柜
 */
async function resolveCabinetMeta(username, entityHash, cabinetId) {
	const personal = await getCabinet(username, entityHash, cabinetId)
	if (personal) return personal
	return getSharedCabinetMeta(username, cabinetId)
}

/**
 * @param {string} username 用户
 * @param {string} entityHash 实体
 * @param {string} cabinetId 柜
 * @param {string} entryId 条目
 * @returns {Promise<object | null>} 条目
 */
async function findEntry(username, entityHash, cabinetId, entryId) {
	const cabinet = await resolveCabinetMeta(username, entityHash, cabinetId)
	if (!cabinet) return null
	if (cabinet.type === 'shared') {
		const index = await loadSharedIndex(username, cabinetId)
		return index.entries.find(row => row.id === entryId) || null
	}
	const index = await loadPersonalIndex(username, entityHash, cabinetId)
	return index.entries.find(row => row.id === entryId) || null
}
