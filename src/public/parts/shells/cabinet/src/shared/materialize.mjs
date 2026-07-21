import { HLC } from 'npm:@steve02081504/fount-p2p/core/hlc'

import { normalizeEntry } from '../entryModel.mjs'
import { writeJsonFile } from '../io.mjs'
import { sharedCabinetSnapshotPath } from '../paths.mjs'

import { decryptOperationPayload } from './crypto.mjs'
import { loadSharedKeys, readKeyForGen } from './keys.mjs'
import { loadSharedOperations } from './operationLog.mjs'

/**
 * @param {{ wall: number, logical: number } | null | undefined} left HLC
 * @param {{ wall: number, logical: number } | null | undefined} right HLC
 * @returns {number} compare
 */
function compareHlcJson(left, right) {
	if (!left) return right ? -1 : 0
	if (!right) return 1
	return HLC.fromJSON(left).compare(HLC.fromJSON(right))
}

/**
 * @param {object[]} operations 操作列表
 * @param {import('./keys.mjs').SharedCabinetKeys} keys 密钥
 * @param {string} cabinetId 柜
 * @returns {{ entries: Map<string, object>, tips: Map<string, object> }} 物化结果
 */
export function materializeSharedOperations(operations, keys, cabinetId) {
	/** @type {Map<string, { hlc: object, deleted?: boolean, entry?: object, sealed?: boolean }>} */
	const tips = new Map()
	for (const operation of operations) {
		const entryId = String(operation.entry_id || '')
		if (!entryId) continue
		const existing = tips.get(entryId)
		if (compareHlcJson(operation.hlc, existing?.hlc) < 0) continue

		if (operation.action === 'delete') {
			tips.set(entryId, { hlc: operation.hlc, deleted: true })
			continue
		}

		const readKey = readKeyForGen(keys, operation.gen)
		if (!readKey) {
			// 无对应代读密钥：保留 tip 槽但不暴露明文
			tips.set(entryId, { hlc: operation.hlc, sealed: true })
			continue
		}
		const payload = decryptOperationPayload(operation.payload_ciphertext, readKey, cabinetId, operation.gen)
		if (!payload) continue
		tips.set(entryId, {
			hlc: operation.hlc,
			entry: normalizeEntry({ ...payload, id: entryId }, payload.created?.entity_hash || ''),
		})
	}

	/** @type {Map<string, object>} */
	const entries = new Map()
	for (const [id, tip] of tips) {
		if (tip.deleted || tip.sealed || !tip.entry) continue
		entries.set(id, tip.entry)
	}
	return { entries, tips }
}

/**
 * @param {string} username 用户
 * @param {string} cabinetId 柜
 * @returns {Promise<{ version: number, entries: object[] }>} 索引
 */
export async function loadSharedIndex(username, cabinetId) {
	const keys = await loadSharedKeys(username, cabinetId)
	if (!keys) return { version: 1, entries: [] }
	const { entries } = materializeSharedOperations(
		await loadSharedOperations(username, cabinetId),
		keys,
		cabinetId,
	)
	return { version: 1, entries: [...entries.values()] }
}

/**
 * @param {string} username 用户
 * @param {string} cabinetId 柜
 * @returns {Promise<void>}
 */
export async function persistSharedSnapshot(username, cabinetId) {
	await writeJsonFile(sharedCabinetSnapshotPath(username, cabinetId), await loadSharedIndex(username, cabinetId))
}
