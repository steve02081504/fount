import { Buffer } from 'node:buffer'
import { randomUUID } from 'node:crypto'

import {
	buildFolderTrail,
	collectSubtreeIds,
	listChildren,
	normalizeEntry,
	normalizeParentId,
	patchEntry,
} from '../entryModel.mjs'
import { clearRecovery, loadRecovery, storeRecovery } from '../recovery.mjs'

import { getSharedCabinetBlob, putSharedCabinetBlob } from './blobs.mjs'
import { encryptOperationPayload, signOperation } from './crypto.mjs'
import {
	getSharedCabinetMeta,
	loadSharedKeys,
	nextSharedHlc,
	readKeyForGen,
	saveSharedKeys,
} from './keys.mjs'
import { loadSharedIndex, persistSharedSnapshot } from './materialize.mjs'
import { appendSharedOperation } from './operationLog.mjs'

/**
 * 签名并追加一条操作（不物化、不广播）。
 * @param {string} username 用户
 * @param {string} cabinetId 柜
 * @param {string} action upsert|delete
 * @param {string} entryId 条目
 * @param {object | null} payload 明文 payload（delete 可为 null）
 * @returns {Promise<object>} 签名操作
 */
async function appendSharedOperationRecord(username, cabinetId, action, entryId, payload) {
	const keys = await loadSharedKeys(username, cabinetId)
	if (!keys?.write_privkey) throw new Error('write key required')
	const readKey = readKeyForGen(keys)
	if (!readKey) throw new Error('read key missing')
	const { hlc, keys: nextKeys } = nextSharedHlc(keys)
	await saveSharedKeys(username, cabinetId, nextKeys)
	const operation = await signOperation({
		operation_id: randomUUID(),
		hlc,
		gen: nextKeys.current_gen,
		entry_id: entryId,
		action,
		payload_ciphertext: action === 'delete'
			? null
			: encryptOperationPayload(payload, readKey, cabinetId, nextKeys.current_gen),
	}, Buffer.from(keys.write_privkey, 'hex'))
	await appendSharedOperation(username, cabinetId, operation)
	return operation
}

/**
 * 物化快照并广播一批操作。
 * @param {string} username 用户
 * @param {string} cabinetId 柜
 * @param {object[]} operations 已追加操作
 * @returns {Promise<void>}
 */
async function flushSharedOperations(username, cabinetId, operations) {
	if (!operations.length) return
	await persistSharedSnapshot(username, cabinetId)
	const { broadcastSharedOperation } = await import('./sync.mjs')
	for (const operation of operations)
		await broadcastSharedOperation(username, cabinetId, operation).catch(() => { })
}

/**
 * @param {string} username 用户
 * @param {string} cabinetId 柜
 * @param {string} action upsert|delete
 * @param {string} entryId 条目
 * @param {object | null} payload 明文 payload（delete 可为 null）
 * @returns {Promise<object>} 签名操作
 */
async function commitSharedOperation(username, cabinetId, action, entryId, payload) {
	const operation = await appendSharedOperationRecord(username, cabinetId, action, entryId, payload)
	await flushSharedOperations(username, cabinetId, [operation])
	return operation
}

/**
 * @param {string} username 用户
 * @param {string} cabinetId 柜
 * @param {{ parent_id?: string | null, show_hidden?: boolean, show_orphaned?: boolean }} [options] 选项
 * @returns {Promise<{ cabinet: object, parent_id: string | null, folder_trail: object[], entries: object[] }>} 列表
 */
export async function listSharedEntries(username, cabinetId, options = {}) {
	const cabinet = await getSharedCabinetMeta(username, cabinetId)
	if (!cabinet) throw new Error('cabinet not found')
	const index = await loadSharedIndex(username, cabinetId)
	const parentId = normalizeParentId(options.parent_id)
	return {
		cabinet,
		parent_id: parentId,
		folder_trail: buildFolderTrail(index.entries, parentId),
		entries: listChildren(
			index.entries.filter(entry => !entry.orphaned || options.show_orphaned),
			parentId,
			options,
		),
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
	await commitSharedOperation(username, cabinetId, 'upsert', entry.id, entry)
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
	await commitSharedOperation(username, cabinetId, 'upsert', entryId, next)
	return next
}

/**
 * @param {string} username 用户
 * @param {string} entityHash 操作者
 * @param {string} cabinetId 柜
 * @param {string[]} entryIds 条目
 * @param {{ recoverable?: boolean }} [options] 选项
 * @returns {Promise<{ deleted: string[], recovery_token?: string }>} 结果
 */
export async function deleteSharedEntries(username, entityHash, cabinetId, entryIds, options = {}) {
	void entityHash
	const index = await loadSharedIndex(username, cabinetId)
	/** @type {string[]} */
	const deleted = []
	/** @type {object[]} */
	const stashed = []
	/** @type {object[]} */
	const operations = []
	for (const id of entryIds) {
		const subtree = collectSubtreeIds(index.entries, id)
		for (const entryId of subtree) {
			const entry = index.entries.find(row => row.id === entryId)
			if (entry) stashed.push(entry)
			operations.push(await appendSharedOperationRecord(username, cabinetId, 'delete', entryId, null))
			deleted.push(entryId)
		}
	}
	await flushSharedOperations(username, cabinetId, operations)
	if (!options.recoverable) return { deleted }
	return {
		deleted,
		recovery_token: await storeRecovery(username, entityHash, cabinetId, {
			shared: true,
			entries: stashed,
		}),
	}
}

/**
 * @param {string} username 用户
 * @param {string} entityHash 操作者
 * @param {string} cabinetId 柜
 * @param {string} recoveryToken token
 * @returns {Promise<{ restored: string[] }>} 结果
 */
export async function restoreSharedEntries(username, entityHash, cabinetId, recoveryToken) {
	const record = await loadRecovery(username, entityHash, cabinetId, recoveryToken, true)
	if (!record) throw new Error('recovery token invalid')
	/** @type {string[]} */
	const restored = []
	/** @type {object[]} */
	const operations = []
	for (const entry of record.entries) {
		operations.push(await appendSharedOperationRecord(username, cabinetId, 'upsert', entry.id, entry))
		restored.push(entry.id)
	}
	await flushSharedOperations(username, cabinetId, operations)
	await clearRecovery(username, entityHash, cabinetId, recoveryToken, true)
	return { restored }
}

/**
 * 共享柜 finalize：条目已是 delete 操作，仅丢弃 recovery 记录（blob 由后续 GC 处理）。
 * @param {string} username 用户
 * @param {string} cabinetId 柜
 * @param {string} recoveryToken token
 * @returns {Promise<{ finalized: string[] }>} 结果
 */
export async function finalizeSharedDelete(username, cabinetId, recoveryToken) {
	const record = await loadRecovery(username, '', cabinetId, recoveryToken, true)
	if (!record) return { finalized: [] }
	await clearRecovery(username, '', cabinetId, recoveryToken, true)
	return { finalized: record.entries.map(row => row.id) }
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
	await commitSharedOperation(username, cabinetId, 'upsert', entry.id, entry)
	return entry
}

/**
 * @param {string} username 用户
 * @param {string} cabinetId 柜
 * @param {string} entryId 条目
 * @returns {Promise<Buffer>} 明文
 */
export async function downloadSharedEntry(username, cabinetId, entryId) {
	const entry = (await loadSharedIndex(username, cabinetId)).entries.find(row => row.id === entryId)
	if (!entry?.evfs_path) throw new Error('file not found')
	return getSharedCabinetBlob(username, cabinetId, entry.evfs_path)
}
