import { HLC } from 'npm:@steve02081504/fount-p2p/core/hlc'

import { normalizeEntry } from '../entryModel.mjs'
import { writeJsonFile } from '../io.mjs'
import { sharedCabinetSnapshotPath } from '../paths.mjs'

import { decryptOpPayload } from './crypto.mjs'
import { loadSharedKeys, readKeyForGen } from './keys.mjs'
import { loadSharedOps } from './oplog.mjs'

/**
 * @param {{ wall: number, logical: number } | null | undefined} a HLC
 * @param {{ wall: number, logical: number } | null | undefined} b HLC
 * @returns {number} compare
 */
function compareHlcJson(a, b) {
	if (!a) return b ? -1 : 0
	if (!b) return 1
	return HLC.fromJSON(a).compare(HLC.fromJSON(b))
}

/**
 * @param {object[]} ops ops
 * @param {import('./keys.mjs').SharedCabinetKeys} keys 密钥
 * @param {string} cabinetId 柜
 * @returns {{ entries: Map<string, object>, tips: Map<string, object> }} 物化结果
 */
export function materializeSharedOps(ops, keys, cabinetId) {
	/** @type {Map<string, { hlc: object, deleted?: boolean, entry?: object }>} */
	const tips = new Map()
	for (const op of ops) {
		const entryId = String(op.entry_id || '')
		if (!entryId) continue
		const existing = tips.get(entryId)
		if (compareHlcJson(op.hlc, existing?.hlc) < 0) continue

		if (op.action === 'delete') {
			tips.set(entryId, { hlc: op.hlc, deleted: true })
			continue
		}

		const readKey = readKeyForGen(keys, op.gen)
		if (!readKey) {
			// 无对应代读密钥：保留 tip 槽但不暴露明文
			tips.set(entryId, { hlc: op.hlc, sealed: true })
			continue
		}
		const payload = decryptOpPayload(op.payload_ciphertext, readKey, cabinetId, op.gen)
		if (!payload) continue
		tips.set(entryId, {
			hlc: op.hlc,
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
	const ops = await loadSharedOps(username, cabinetId)
	const { entries } = materializeSharedOps(ops, keys, cabinetId)
	return { version: 1, entries: [...entries.values()] }
}

/**
 * @param {string} username 用户
 * @param {string} cabinetId 柜
 * @returns {Promise<void>}
 */
export async function persistSharedSnapshot(username, cabinetId) {
	const index = await loadSharedIndex(username, cabinetId)
	await writeJsonFile(sharedCabinetSnapshotPath(username, cabinetId), index)
}
