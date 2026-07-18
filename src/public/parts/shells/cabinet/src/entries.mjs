import { randomUUID } from 'node:crypto'

import { loadFileManifest, readManifestPlaintext } from 'npm:@steve02081504/fount-p2p/files/evfs'

import { hardDeleteEntryBlobs, tryDeletePreviewByUrl } from './blobGc.mjs'
import {
	loadCabinetIndex,
	loadPersonalIndex,
	resolveCabinet,
	savePersonalIndex,
} from './cabinets.mjs'
import {
	buildFolderTrail,
	collectSubtreeIds,
	listChildren,
	normalizeEntry,
	normalizeParentId,
	patchEntry,
} from './entryModel.mjs'
import { ensureParentDir } from './io.mjs'
import {
	createFolderEncryption,
	loadEncryptedFolderIndex,
	saveEncryptedFolderIndex,
	unlockFolderKey,
} from './passwordFolder.mjs'
import { evfsBlobPath, evfsPreviewPath, encryptedFolderIndexPath } from './paths.mjs'
import { putCabinetEvfsFile } from './publish.mjs'
import { clearRecovery, loadRecovery, storeRecovery } from './recovery.mjs'
import { countLocalInboundLinks, gcOrphanAfterUnlink } from './refcount.mjs'
import { issueUnlockToken, resolveFolderUnlock, resolveUnlockToken } from './unlockTokens.mjs'

/**
 * @param {string} username 用户
 * @param {string} entityHash 实体
 * @param {string} cabinetId 柜
 * @param {string} entryId 条目
 * @returns {Promise<Buffer | Uint8Array>} 明文
 */
export async function readPersonalEntryBytes(username, entityHash, cabinetId, entryId) {
	const index = await loadPersonalIndex(username, entityHash, cabinetId)
	const entry = index.entries.find(row => row.id === entryId)
	if (!entry?.evfs_path) throw new Error('file not found')
	const manifest = await loadFileManifest(entityHash, entry.evfs_path)
	if (!manifest) throw new Error('blob missing')
	const plain = await readManifestPlaintext(username, manifest)
	if (!plain) throw new Error('decrypt failed')
	return plain
}

/**
 * @param {string} username 用户
 * @param {string} entityHash 实体
 * @param {string} cabinetId 柜
 * @param {{ parent_id?: string | null, show_hidden?: boolean, unlock_token?: string }} [options] 选项
 * @returns {Promise<{ cabinet: object, parent_id: string | null, folder_trail: object[], entries: object[], locked?: boolean }>} 列表
 */
export async function listEntries(username, entityHash, cabinetId, options = {}) {
	const cabinet = await resolveCabinet(username, entityHash, cabinetId)
	if (!cabinet) throw new Error('cabinet not found')
	if (cabinet.type === 'shared') {
		const { listSharedEntries } = await import('./shared/ops.mjs')
		return listSharedEntries(username, cabinetId, options)
	}

	const index = await loadPersonalIndex(username, entityHash, cabinetId)
	const parentId = normalizeParentId(options.parent_id)
	if (parentId) {
		const folder = index.entries.find(entry => entry.id === parentId && entry.kind === 'folder')
		if (folder?.encryption) {
			const folderKey = resolveUnlockToken(options.unlock_token, {
				cabinet_id: cabinetId,
				folder_id: parentId,
				entity_hash: entityHash,
			})
			if (!folderKey)
				return {
					cabinet,
					parent_id: parentId,
					folder_trail: buildFolderTrail(index.entries, parentId),
					entries: [],
					locked: true,
				}
			const encIndex = await loadEncryptedFolderIndex(username, entityHash, cabinetId, parentId, folderKey)
			return {
				cabinet,
				parent_id: parentId,
				folder_trail: buildFolderTrail(index.entries, parentId),
				entries: listChildren(encIndex.entries, null, options),
				locked: false,
			}
		}
	}
	return {
		cabinet,
		parent_id: parentId,
		folder_trail: buildFolderTrail(index.entries, parentId),
		entries: listChildren(index.entries, parentId, options),
	}
}

/**
 * @param {string} username 用户
 * @param {string} entityHash 实体
 * @param {string} cabinetId 柜
 * @param {object} draft 条目草稿
 * @returns {Promise<object>} 新条目
 */
export async function registerEntry(username, entityHash, cabinetId, draft) {
	const cabinet = await resolveCabinet(username, entityHash, cabinetId)
	if (!cabinet) throw new Error('cabinet not found')
	if (cabinet.type === 'shared') {
		const { registerSharedEntry } = await import('./shared/ops.mjs')
		return registerSharedEntry(username, entityHash, cabinetId, draft)
	}

	const index = await loadPersonalIndex(username, entityHash, cabinetId)
	const entry = normalizeEntry(draft, entityHash)
	if (entry.kind === 'file' && !entry.evfs_path)
		entry.evfs_path = evfsBlobPath(cabinetId, randomUUID())

	const parentId = entry.parent_id
	if (parentId) {
		const folder = index.entries.find(row => row.id === parentId && row.kind === 'folder')
		if (folder?.encryption) {
			const folderKey = resolveUnlockToken(draft.unlock_token, {
				cabinet_id: cabinetId,
				folder_id: parentId,
				entity_hash: entityHash,
			})
			if (!folderKey) throw new Error('folder locked')
			const encIndex = await loadEncryptedFolderIndex(username, entityHash, cabinetId, parentId, folderKey)
			entry.parent_id = null
			encIndex.entries.push(entry)
			await saveEncryptedFolderIndex(username, entityHash, cabinetId, parentId, folderKey, encIndex)
			return entry
		}
	}

	index.entries.push(entry)
	await savePersonalIndex(username, entityHash, cabinetId, index)
	return entry
}

/**
 * @param {string} username 用户
 * @param {string} entityHash 实体
 * @param {string} cabinetId 柜
 * @param {string} entryId 条目
 * @param {object} patch 补丁
 * @returns {Promise<object>} 更新后的条目
 */
export async function updateEntry(username, entityHash, cabinetId, entryId, patch) {
	const cabinet = await resolveCabinet(username, entityHash, cabinetId)
	if (!cabinet) throw new Error('cabinet not found')
	if (cabinet.type === 'shared') {
		const { updateSharedEntry } = await import('./shared/ops.mjs')
		return updateSharedEntry(username, entityHash, cabinetId, entryId, patch)
	}

	const unlockMeta = resolveFolderUnlock(patch.unlock_token, cabinetId, entityHash)
	if (unlockMeta) {
		const encIndex = await loadEncryptedFolderIndex(username, entityHash, cabinetId, unlockMeta.folder_id, unlockMeta.folder_key)
		const idx = encIndex.entries.findIndex(row => row.id === entryId)
		if (idx >= 0) {
			const next = patchEntry(encIndex.entries[idx], patch, entityHash)
			encIndex.entries[idx] = next
			await saveEncryptedFolderIndex(username, entityHash, cabinetId, unlockMeta.folder_id, unlockMeta.folder_key, encIndex)
			return next
		}
	}

	const index = await loadPersonalIndex(username, entityHash, cabinetId)
	const idx = index.entries.findIndex(row => row.id === entryId)
	if (idx < 0) throw new Error('entry not found')
	let entry = index.entries[idx]

	if (patch.set_password != null) {
		if (entry.kind !== 'folder') throw new Error('only folders support passwords')
		const encryption = createFolderEncryption(String(patch.set_password))
		const children = index.entries.filter(row => row.parent_id === entryId)
		const encEntries = children.map(child => normalizeEntry({ ...child, parent_id: null }, entityHash))
		index.entries = index.entries.filter(row => row.parent_id !== entryId)
		entry = patchEntry(entry, { encryption }, entityHash)
		index.entries[idx] = entry
		await savePersonalIndex(username, entityHash, cabinetId, index)
		const folderKey = unlockFolderKey(String(patch.set_password), encryption)
		await saveEncryptedFolderIndex(username, entityHash, cabinetId, entryId, folderKey, {
			version: 1,
			entries: encEntries,
		})
		return entry
	}

	entry = patchEntry(entry, patch, entityHash)
	index.entries[idx] = entry
	await savePersonalIndex(username, entityHash, cabinetId, index)
	return entry
}

/**
 * @param {string} username 用户
 * @param {string} entityHash 实体
 * @param {string} cabinetId 柜
 * @param {object[]} entries 条目
 * @param {Set<string>} toDelete 待删
 * @param {boolean} recoverable 可恢复
 * @returns {Promise<{ removed: string[], kept: object[], deferredLinks: object[], stashed: object[] }>} 分区结果
 */
async function partitionPersonalDeletes(username, entityHash, cabinetId, entries, toDelete, recoverable) {
	/** @type {string[]} */
	const removed = []
	/** @type {object[]} */
	const kept = []
	/** @type {object[]} */
	const deferredLinks = []
	/** @type {object[]} */
	const stashed = []

	for (const entry of entries) {
		if (!toDelete.has(entry.id)) {
			kept.push(entry)
			continue
		}
		stashed.push(entry)
		removed.push(entry.id)

		if (recoverable) continue

		if (entry.kind === 'link') {
			deferredLinks.push(entry)
			continue
		}

		const inbound = await countLocalInboundLinks(username, entityHash, {
			owner_entity_hash: entityHash,
			cabinet_id: cabinetId,
			entry_id: entry.id,
		}, { exclude_cabinet_id: cabinetId, exclude_entry_ids: toDelete })

		if (inbound > 0) {
			kept.push({ ...entry, orphaned: true })
			continue
		}

		await hardDeleteEntryBlobs(username, entityHash, entry)
	}

	return { removed, kept, deferredLinks, stashed }
}

/**
 * @param {string} username 用户
 * @param {string} entityHash 实体
 * @param {string} cabinetId 柜
 * @param {string[]} entryIds 条目 ids
 * @param {{ recoverable?: boolean, unlock_token?: string }} [options] 选项
 * @returns {Promise<{ deleted: string[], recovery_token?: string }>} 结果
 */
export async function deleteEntries(username, entityHash, cabinetId, entryIds, options = {}) {
	const cabinet = await resolveCabinet(username, entityHash, cabinetId)
	if (!cabinet) throw new Error('cabinet not found')
	const recoverable = Boolean(options.recoverable)
	if (cabinet.type === 'shared') {
		const { deleteSharedEntries } = await import('./shared/ops.mjs')
		return deleteSharedEntries(username, entityHash, cabinetId, entryIds, { recoverable })
	}

	const unlockMeta = resolveFolderUnlock(options.unlock_token, cabinetId, entityHash)
	if (unlockMeta) {
		const encIndex = await loadEncryptedFolderIndex(username, entityHash, cabinetId, unlockMeta.folder_id, unlockMeta.folder_key)
		const toDelete = new Set()
		for (const id of entryIds)
			for (const childId of collectSubtreeIds(encIndex.entries, id))
				toDelete.add(childId)
		const { removed, kept, deferredLinks, stashed } = await partitionPersonalDeletes(
			username, entityHash, cabinetId, encIndex.entries, toDelete, recoverable,
		)
		await saveEncryptedFolderIndex(username, entityHash, cabinetId, unlockMeta.folder_id, unlockMeta.folder_key, {
			version: encIndex.version || 1,
			entries: kept,
		})
		for (const link of deferredLinks)
			await gcOrphanAfterUnlink(username, entityHash, link)
		if (!recoverable) return { deleted: removed }
		const recovery_token = await storeRecovery(username, entityHash, cabinetId, {
			entries: stashed.map(entry => ({ ...entry, __enc_folder_id: unlockMeta.folder_id })),
		})
		return { deleted: removed, recovery_token }
	}

	const index = await loadPersonalIndex(username, entityHash, cabinetId)
	const toDelete = new Set()
	for (const id of entryIds)
		for (const childId of collectSubtreeIds(index.entries, id))
			toDelete.add(childId)

	/** @type {Record<string, string>} */
	const encrypted_indexes = {}
	if (recoverable) 
		for (const entry of index.entries) {
			if (!toDelete.has(entry.id) || entry.kind !== 'folder' || !entry.encryption) continue
			try {
				const { readFile } = await import('node:fs/promises')
				const { encryptedFolderIndexPath } = await import('./paths.mjs')
				encrypted_indexes[entry.id] = await readFile(
					encryptedFolderIndexPath(username, entityHash, cabinetId, entry.id),
					'utf8',
				)
			}
			catch { /* 无密文索引则跳过 */ }
		}
	

	const { removed, kept, deferredLinks, stashed } = await partitionPersonalDeletes(
		username, entityHash, cabinetId, index.entries, toDelete, recoverable,
	)

	await savePersonalIndex(username, entityHash, cabinetId, { version: index.version, entries: kept })
	for (const link of deferredLinks)
		await gcOrphanAfterUnlink(username, entityHash, link)

	if (!recoverable) return { deleted: removed }
	const recovery_token = await storeRecovery(username, entityHash, cabinetId, {
		entries: stashed,
		encrypted_indexes,
	})
	return { deleted: removed, recovery_token }
}

/**
 * @param {string} username 用户
 * @param {string} entityHash 实体
 * @param {string} cabinetId 柜
 * @param {string} recoveryToken token
 * @param {{ unlock_token?: string }} [options] 选项
 * @returns {Promise<{ restored: string[] }>} 结果
 */
export async function restoreEntries(username, entityHash, cabinetId, recoveryToken, options = {}) {
	const cabinet = await resolveCabinet(username, entityHash, cabinetId)
	if (!cabinet) throw new Error('cabinet not found')
	if (cabinet.type === 'shared') {
		const { restoreSharedEntries } = await import('./shared/ops.mjs')
		return restoreSharedEntries(username, entityHash, cabinetId, recoveryToken)
	}

	const record = await loadRecovery(username, entityHash, cabinetId, recoveryToken, false)
	if (!record) throw new Error('recovery token invalid')

	const encStash = record.entries.filter(row => row.__enc_folder_id)
	const mainEntries = record.entries.filter(row => !row.__enc_folder_id)

	if (encStash.length) {
		const unlockMeta = resolveFolderUnlock(options.unlock_token, cabinetId, entityHash)
		if (!unlockMeta) throw new Error('folder locked')
		const encIndex = await loadEncryptedFolderIndex(username, entityHash, cabinetId, unlockMeta.folder_id, unlockMeta.folder_key)
		const existing = new Set(encIndex.entries.map(row => row.id))
		for (const entry of encStash) {
			if (entry.__enc_folder_id !== unlockMeta.folder_id) continue
			const { __enc_folder_id, ...clean } = entry
			void __enc_folder_id
			if (!existing.has(clean.id)) encIndex.entries.push(clean)
		}
		await saveEncryptedFolderIndex(username, entityHash, cabinetId, unlockMeta.folder_id, unlockMeta.folder_key, encIndex)
	}

	if (mainEntries.length) {
		const index = await loadPersonalIndex(username, entityHash, cabinetId)
		const existing = new Set(index.entries.map(row => row.id))
		for (const entry of mainEntries)
			if (!existing.has(entry.id)) index.entries.push(entry)
		await savePersonalIndex(username, entityHash, cabinetId, index)
		const { writeFile } = await import('node:fs/promises')
		for (const [folderId, raw] of Object.entries(record.encrypted_indexes || {})) {
			const path = encryptedFolderIndexPath(username, entityHash, cabinetId, folderId)
			await ensureParentDir(path)
			await writeFile(path, typeof raw === 'string' ? raw : JSON.stringify(raw), 'utf8')
		}
	}

	await clearRecovery(username, entityHash, cabinetId, recoveryToken, false)
	return { restored: record.entries.map(row => row.id) }
}

/**
 * @param {string} username 用户
 * @param {string} entityHash 实体
 * @param {string} cabinetId 柜
 * @param {string} recoveryToken token
 * @returns {Promise<{ finalized: string[] }>} 结果
 */
export async function finalizeDelete(username, entityHash, cabinetId, recoveryToken) {
	const cabinet = await resolveCabinet(username, entityHash, cabinetId)
	if (!cabinet) throw new Error('cabinet not found')
	if (cabinet.type === 'shared') {
		const { finalizeSharedDelete } = await import('./shared/ops.mjs')
		return finalizeSharedDelete(username, cabinetId, recoveryToken)
	}

	const record = await loadRecovery(username, entityHash, cabinetId, recoveryToken, false)
	if (!record) return { finalized: [] }

	for (const entry of record.entries) {
		const { __enc_folder_id, ...clean } = entry
		void __enc_folder_id
		if (clean.kind === 'link') {
			await gcOrphanAfterUnlink(username, entityHash, clean)
			continue
		}
		const inbound = await countLocalInboundLinks(username, entityHash, {
			owner_entity_hash: entityHash,
			cabinet_id: cabinetId,
			entry_id: clean.id,
		})
		if (inbound > 0) continue
		await hardDeleteEntryBlobs(username, entityHash, clean)
	}

	await clearRecovery(username, entityHash, cabinetId, recoveryToken, false)
	return { finalized: record.entries.map(row => row.id) }
}

/**
 * @param {string} username 用户
 * @param {string} entityHash 实体
 * @param {string} cabinetId 柜
 * @param {{ entry_ids: string[], target_parent_id?: string | null, as_links?: boolean, target_cabinet_id?: string, unlock_token?: string, source_unlock_token?: string }} body 复制请求
 * @returns {Promise<object[]>} 新条目
 */
export async function copyEntries(username, entityHash, cabinetId, body) {
	const cabinet = await resolveCabinet(username, entityHash, cabinetId)
	if (!cabinet) throw new Error('cabinet not found')
	const targetCabinetId = body.target_cabinet_id || cabinetId
	const targetCabinet = await resolveCabinet(username, entityHash, targetCabinetId)
	if (!targetCabinet) throw new Error('target cabinet not found')

	let sourceEntries = (await loadCabinetIndex(username, entityHash, cabinetId, cabinet)).entries

	const sourceUnlock = resolveFolderUnlock(body.source_unlock_token, cabinetId, entityHash)
	if (sourceUnlock) {
		const encIndex = await loadEncryptedFolderIndex(username, entityHash, cabinetId, sourceUnlock.folder_id, sourceUnlock.folder_key)
		sourceEntries = [...sourceEntries, ...encIndex.entries]
	}

	const targetParent = normalizeParentId(body.target_parent_id)
	const created = []

	/**
	 * @param {object} entry 条目
	 * @returns {Promise<object>} 已写入条目
	 */
	async function writeTarget(entry) {
		if (targetCabinet.type === 'shared') {
			const { registerSharedEntry } = await import('./shared/ops.mjs')
			return registerSharedEntry(username, entityHash, targetCabinetId, entry)
		}
		const unlockMeta = resolveFolderUnlock(body.unlock_token, targetCabinetId, entityHash)
		if (unlockMeta?.folder_id === targetParent) {
			const encIndex = await loadEncryptedFolderIndex(username, entityHash, targetCabinetId, unlockMeta.folder_id, unlockMeta.folder_key)
			const stored = normalizeEntry({ ...entry, parent_id: null }, entityHash)
			encIndex.entries.push(stored)
			await saveEncryptedFolderIndex(username, entityHash, targetCabinetId, unlockMeta.folder_id, unlockMeta.folder_key, encIndex)
			return stored
		}
		const targetIndex = await loadPersonalIndex(username, entityHash, targetCabinetId)
		targetIndex.entries.push(entry)
		await savePersonalIndex(username, entityHash, targetCabinetId, targetIndex)
		return entry
	}

	for (const id of body.entry_ids || []) {
		const source = sourceEntries.find(row => row.id === id)
		if (!source) continue
		if (body.as_links) {
			const link = normalizeEntry({
				kind: 'link',
				name: source.name,
				parent_id: targetParent,
				mime_type: 'inode/symlink',
				link: {
					owner_entity_hash: entityHash,
					cabinet_id: cabinetId,
					entry_id: source.kind === 'folder' || source.kind === 'file'
						? source.id
						: source.link?.entry_id,
				},
			}, entityHash)
			created.push(await writeTarget(link))
			continue
		}
		const copy = normalizeEntry({
			...source,
			id: randomUUID(),
			parent_id: targetParent,
			name: `${source.name} (copy)`,
			orphaned: false,
		}, entityHash)
		created.push(await writeTarget(copy))
	}
	return created
}

/**
 * @param {string} username 用户
 * @param {string} entityHash 实体
 * @param {string} cabinetId 柜
 * @param {string} folderId 文件夹
 * @param {string} password 密码
 * @returns {Promise<{ unlock_token: string }>} token
 */
export async function unlockFolder(username, entityHash, cabinetId, folderId, password) {
	const index = await loadPersonalIndex(username, entityHash, cabinetId)
	const folder = index.entries.find(row => row.id === folderId && row.kind === 'folder')
	if (!folder?.encryption) throw new Error('not encrypted')
	const folderKey = unlockFolderKey(password, folder.encryption)
	const unlockToken = issueUnlockToken({
		folder_key: folderKey,
		cabinet_id: cabinetId,
		folder_id: folderId,
		entity_hash: entityHash,
	})
	return { unlock_token: unlockToken }
}

/**
 * @param {string} username 用户
 * @param {string} entityHash 实体
 * @param {string} cabinetId 柜
 * @param {{ plaintext: Buffer | Uint8Array, name: string, mime_type?: string, parent_id?: string | null }} options 上传登记
 * @returns {Promise<object>} 条目
 */
export async function uploadAndRegister(username, entityHash, cabinetId, options) {
	const cabinet = await resolveCabinet(username, entityHash, cabinetId)
	if (!cabinet) throw new Error('cabinet not found')
	if (cabinet.type === 'shared') {
		const { uploadSharedAndRegister } = await import('./shared/ops.mjs')
		return uploadSharedAndRegister(username, entityHash, cabinetId, options)
	}

	const { Buffer } = await import('node:buffer')
	const blobId = randomUUID()
	const logicalPath = evfsBlobPath(cabinetId, blobId)
	await putCabinetEvfsFile(username, entityHash, {
		logical_path: logicalPath,
		plaintext: options.plaintext,
		name: options.name,
		mime_type: options.mime_type,
		visibility: cabinet.visibility,
	})
	return registerEntry(username, entityHash, cabinetId, {
		kind: 'file',
		name: options.name,
		mime_type: options.mime_type || 'application/octet-stream',
		size: Buffer.byteLength(options.plaintext),
		parent_id: options.parent_id ?? null,
		evfs_path: logicalPath,
		attrs: options.attrs,
		preview: options.preview,
		description: options.description,
		unlock_token: options.unlock_token,
	})
}

/**
 * @param {string} username 用户
 * @param {string} entityHash 实体
 * @param {string} cabinetId 柜
 * @param {{ plaintext: Buffer | Uint8Array, name?: string }} options 预览
 * @returns {Promise<{ url: string, path: string }>} 预览信息
 */
export async function uploadPreview(username, entityHash, cabinetId, options) {
	const cabinet = await resolveCabinet(username, entityHash, cabinetId)
	if (!cabinet) throw new Error('cabinet not found')
	const previewId = randomUUID()
	const logicalPath = evfsPreviewPath(cabinetId, previewId)
	await putCabinetEvfsFile(username, entityHash, {
		logical_path: logicalPath,
		plaintext: options.plaintext,
		name: options.name || 'preview.avif',
		mime_type: options.mime_type || 'image/avif',
		visibility: cabinet.visibility,
	})
	const url = `/api/parts/shells:chat/entities/${encodeURIComponent(entityHash)}/files/${logicalPath.split('/').map(encodeURIComponent).join('/')}`
	return { url, path: logicalPath }
}

/**
 *
 */
export { tryDeletePreviewByUrl }
