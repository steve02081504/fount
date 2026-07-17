import { Buffer } from 'node:buffer'
import { randomUUID } from 'node:crypto'

import {
	buildFolderTrail,
	collectSubtreeIds,
	listChildren,
	normalizeEntry,
	patchEntry,
} from '../entryModel.mjs'

import { getSharedCabinetBlob, putSharedCabinetBlob } from './blobs.mjs'
import { encryptOpPayload, signOp } from './crypto.mjs'
import {
	getSharedCabinetMeta,
	loadSharedKeys,
	nextSharedHlc,
	readKeyForGen,
	saveSharedKeys,
} from './keys.mjs'
import { loadSharedIndex, persistSharedSnapshot } from './materialize.mjs'
import { appendSharedOp } from './oplog.mjs'

/**
 * @param {string} username 用户
 * @param {string} cabinetId 柜
 * @param {string} action upsert|delete
 * @param {string} entryId 条目
 * @param {object | null} payload 明文 payload（delete 可为 null）
 * @returns {Promise<object>} 签名 op
 */
async function commitSharedOp(username, cabinetId, action, entryId, payload) {
	const keys = await loadSharedKeys(username, cabinetId)
	if (!keys?.write_privkey) throw new Error('write key required')
	const readKey = readKeyForGen(keys)
	if (!readKey) throw new Error('read key missing')
	const { hlc, keys: nextKeys } = nextSharedHlc(keys)
	await saveSharedKeys(username, cabinetId, nextKeys)

	const payloadCipher = action === 'delete'
		? null
		: encryptOpPayload(payload, readKey, cabinetId, nextKeys.current_gen)

	const unsigned = {
		op_id: randomUUID(),
		hlc,
		gen: nextKeys.current_gen,
		entry_id: entryId,
		action,
		payload_ciphertext: payloadCipher,
	}
	const op = await signOp(unsigned, Buffer.from(keys.write_privkey, 'hex'))
	await appendSharedOp(username, cabinetId, op)
	await persistSharedSnapshot(username, cabinetId)
	try {
		const { broadcastSharedOp } = await import('./sync.mjs')
		await broadcastSharedOp(username, cabinetId, op)
	}
	catch { /* sync optional */ }
	return op
}

/**
 * @param {string} username 用户
 * @param {string} cabinetId 柜
 * @param {{ parent_id?: string | null, show_hidden?: boolean }} [options] 选项
 * @returns {Promise<{ cabinet: object, parent_id: string | null, entries: object[] }>} 列表
 */
export async function listSharedEntries(username, cabinetId, options = {}) {
	const cabinet = await getSharedCabinetMeta(username, cabinetId)
	if (!cabinet) throw new Error('cabinet not found')
	const index = await loadSharedIndex(username, cabinetId)
	const parentId = options.parent_id == null || options.parent_id === '' ? null : String(options.parent_id)
	const entries = listChildren(
		index.entries.filter(entry => !entry.orphaned || options.show_orphaned),
		parentId,
		options,
	)
	return {
		cabinet,
		parent_id: parentId,
		folder_trail: buildFolderTrail(index.entries, parentId),
		entries,
	}
}

/**
 * @param {string} username 用户
 * @param {string} entityHash 操作者
 * @param {string} cabinetId 柜
 * @param {object} draft 草稿
 * @returns {Promise<object>} 条目
 */
export async function registerSharedEntry(username, entityHash, cabinetId, draft) {
	const entry = normalizeEntry(draft, entityHash)
	await commitSharedOp(username, cabinetId, 'upsert', entry.id, entry)
	return entry
}

/**
 * @param {string} username 用户
 * @param {string} entityHash 操作者
 * @param {string} cabinetId 柜
 * @param {string} entryId 条目
 * @param {object} patch 补丁
 * @returns {Promise<object>} 更新后条目
 */
export async function updateSharedEntry(username, entityHash, cabinetId, entryId, patch) {
	const index = await loadSharedIndex(username, cabinetId)
	const current = index.entries.find(row => row.id === entryId)
	if (!current) throw new Error('entry not found')
	const next = patchEntry(current, patch, entityHash)
	await commitSharedOp(username, cabinetId, 'upsert', entryId, next)
	return next
}

/**
 * @param {string} username 用户
 * @param {string} entityHash 操作者
 * @param {string} cabinetId 柜
 * @param {string[]} entryIds 条目
 * @returns {Promise<{ deleted: string[] }>} 结果
 */
export async function deleteSharedEntries(username, entityHash, cabinetId, entryIds) {
	void entityHash
	const index = await loadSharedIndex(username, cabinetId)
	/** @type {string[]} */
	const deleted = []
	for (const id of entryIds) {
		const subtree = collectSubtreeIds(index.entries, id)
		for (const entryId of subtree) {
			await commitSharedOp(username, cabinetId, 'delete', entryId, null)
			deleted.push(entryId)
		}
	}
	return { deleted }
}

/**
 * @param {string} username 用户
 * @param {string} entityHash 操作者
 * @param {string} cabinetId 柜
 * @param {{ name?: string, mime_type?: string, parent_id?: string | null, plaintext: Buffer | Uint8Array, description?: string }} options 上传
 * @returns {Promise<object>} 条目
 */
export async function uploadSharedAndRegister(username, entityHash, cabinetId, options) {
	const entryId = randomUUID()
	const blob = await putSharedCabinetBlob(username, cabinetId, {
		plaintext: options.plaintext,
		name: options.name,
		mime_type: options.mime_type,
		entry_id: entryId,
	})
	const entry = normalizeEntry({
		id: entryId,
		name: options.name || 'file',
		kind: 'file',
		parent_id: options.parent_id,
		size: blob.size,
		mime_type: options.mime_type,
		description: options.description,
		evfs_path: blob.evfs_path,
	}, entityHash)
	await commitSharedOp(username, cabinetId, 'upsert', entry.id, entry)
	return entry
}

/**
 * @param {string} username 用户
 * @param {string} cabinetId 柜
 * @param {string} entryId 条目
 * @returns {Promise<Buffer>} 明文
 */
export async function downloadSharedEntry(username, cabinetId, entryId) {
	const index = await loadSharedIndex(username, cabinetId)
	const entry = index.entries.find(row => row.id === entryId)
	if (!entry?.evfs_path) throw new Error('file not found')
	return getSharedCabinetBlob(username, cabinetId, entry.evfs_path)
}
