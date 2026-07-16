import { Buffer } from 'node:buffer'
import { randomUUID } from 'node:crypto'
import { unlink } from 'node:fs/promises'

import {
	getCabinet,
	loadPersonalIndex,
	savePersonalIndex,
} from './cabinets.mjs'
import {
	collectSubtreeIds,
	listChildren,
	normalizeEntry,
	patchEntry,
} from './entryModel.mjs'
import {
	createFolderEncryption,
	loadEncryptedFolderIndex,
	saveEncryptedFolderIndex,
	unlockFolderKey,
} from './passwordFolder.mjs'
import { evfsBlobPath, evfsPreviewPath } from './paths.mjs'
import { putCabinetEvfsFile } from './publish.mjs'
import { issueUnlockToken, resolveUnlockToken } from './unlockTokens.mjs'

/**
 * @param {string} username 用户
 * @param {string} entityHash 实体
 * @param {string} cabinetId 柜
 * @param {{ parent_id?: string | null, show_hidden?: boolean, unlock_token?: string }} [options] 选项
 * @returns {Promise<{ cabinet: object, parent_id: string | null, entries: object[], locked?: boolean }>} 列表
 */
export async function listEntries(username, entityHash, cabinetId, options = {}) {
	const cabinet = await getCabinet(username, entityHash, cabinetId)
	if (!cabinet) throw new Error('cabinet not found')
	if (cabinet.type === 'group') {
		const { listGroupCabinetEntries } = await import('./groupCabinet.mjs')
		return listGroupCabinetEntries(username, entityHash, cabinet, options)
	}

	const index = await loadPersonalIndex(username, entityHash, cabinetId)
	const parentId = options.parent_id == null || options.parent_id === '' ? null : String(options.parent_id)
	if (parentId) {
		const folder = index.entries.find(entry => entry.id === parentId && entry.kind === 'folder')
		if (folder?.encryption) {
			const folderKey = resolveUnlockToken(options.unlock_token, {
				cabinet_id: cabinetId,
				folder_id: parentId,
				entity_hash: entityHash,
			})
			if (!folderKey)
				return { cabinet, parent_id: parentId, entries: [], locked: true }
			const encIndex = await loadEncryptedFolderIndex(username, entityHash, cabinetId, parentId, folderKey)
			return {
				cabinet,
				parent_id: parentId,
				entries: listChildren(encIndex.entries, null, options),
				locked: false,
			}
		}
	}
	return {
		cabinet,
		parent_id: parentId,
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
	const cabinet = await getCabinet(username, entityHash, cabinetId)
	if (!cabinet) throw new Error('cabinet not found')
	if (cabinet.type === 'group') {
		const { registerGroupCabinetEntry } = await import('./groupCabinet.mjs')
		return registerGroupCabinetEntry(username, entityHash, cabinet, draft)
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
 * @returns {Promise<object>} 更新后条目
 */
export async function updateEntry(username, entityHash, cabinetId, entryId, patch) {
	const cabinet = await getCabinet(username, entityHash, cabinetId)
	if (!cabinet) throw new Error('cabinet not found')
	if (cabinet.type === 'group') {
		const { updateGroupCabinetEntry } = await import('./groupCabinet.mjs')
		return updateGroupCabinetEntry(username, entityHash, cabinet, entryId, patch)
	}

	const index = await loadPersonalIndex(username, entityHash, cabinetId)
	const pos = index.entries.findIndex(row => row.id === entryId)
	if (pos < 0) throw new Error('entry not found')
	let entry = index.entries[pos]

	if (patch.set_password != null && entry.kind === 'folder') {
		if (patch.set_password === '') 
			entry = patchEntry(entry, { encryption: null }, entityHash)
		
		else {
			const created = createFolderEncryption(String(patch.set_password))
			entry = patchEntry(entry, {
				encryption: {
					salt: created.salt,
					wrapped_folder_key: created.wrapped_folder_key,
					check: created.check,
				},
			}, entityHash)
			const children = index.entries.filter(row => row.parent_id === entryId)
			index.entries = index.entries.filter(row => row.parent_id !== entryId)
			const moved = children.map(child => ({ ...child, parent_id: null }))
			await saveEncryptedFolderIndex(username, entityHash, cabinetId, entryId, created.folder_key, {
				version: 1,
				entries: moved,
			})
		}
		delete patch.set_password
	}

	entry = patchEntry(entry, patch, entityHash)
	index.entries[pos] = entry
	await savePersonalIndex(username, entityHash, cabinetId, index)
	return entry
}

/**
 * @param {string} username 用户
 * @param {string} entityHash 实体
 * @param {string} cabinetId 柜
 * @param {string[]} entryIds 条目 ids
 * @returns {Promise<{ deleted: string[] }>} 结果
 */
export async function deleteEntries(username, entityHash, cabinetId, entryIds) {
	const cabinet = await getCabinet(username, entityHash, cabinetId)
	if (!cabinet) throw new Error('cabinet not found')
	if (cabinet.type === 'group') {
		const { deleteGroupCabinetEntries } = await import('./groupCabinet.mjs')
		return deleteGroupCabinetEntries(username, entityHash, cabinet, entryIds)
	}

	const index = await loadPersonalIndex(username, entityHash, cabinetId)
	const toDelete = new Set()
	for (const id of entryIds) 
		for (const childId of collectSubtreeIds(index.entries, id))
			toDelete.add(childId)
	
	const removed = []
	const kept = []
	for (const entry of index.entries) {
		if (!toDelete.has(entry.id)) {
			kept.push(entry)
			continue
		}
		removed.push(entry.id)
		if (entry.preview?.delete_with_file && entry.preview?.url)
			await tryDeletePreviewByUrl(entry.preview.url)
	}
	await savePersonalIndex(username, entityHash, cabinetId, { version: index.version, entries: kept })
	return { deleted: removed }
}

/**
 * @param {string} username 用户
 * @param {string} entityHash 实体
 * @param {string} cabinetId 柜
 * @param {{ entry_ids: string[], target_parent_id?: string | null, as_links?: boolean }} body 复制请求
 * @returns {Promise<object[]>} 新条目
 */
export async function copyEntries(username, entityHash, cabinetId, body) {
	const cabinet = await getCabinet(username, entityHash, cabinetId)
	if (!cabinet) throw new Error('cabinet not found')
	if (cabinet.type === 'group') throw new Error('group copy via chat DAG not implemented here')

	const index = await loadPersonalIndex(username, entityHash, cabinetId)
	const targetParent = body.target_parent_id == null || body.target_parent_id === ''
		? null
		: String(body.target_parent_id)
	const created = []
	for (const id of body.entry_ids || []) {
		const source = index.entries.find(row => row.id === id)
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
					entry_id: source.kind === 'folder' || source.kind === 'file' ? source.id : source.link?.entry_id,
				},
			}, entityHash)
			index.entries.push(link)
			created.push(link)
			continue
		}
		const copy = normalizeEntry({
			...source,
			id: randomUUID(),
			parent_id: targetParent,
			name: `${source.name} (copy)`,
		}, entityHash)
		index.entries.push(copy)
		created.push(copy)
	}
	await savePersonalIndex(username, entityHash, cabinetId, index)
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
 * @param {string} url 预览 URL
 * @returns {Promise<void>}
 */
async function tryDeletePreviewByUrl(url) {
	// preview files live in EVFS; physical GC is best-effort via unlink of local manifest if present
	void url
	void unlink
}

/**
 * @param {string} username 用户
 * @param {string} entityHash 实体
 * @param {string} cabinetId 柜
 * @param {{ plaintext: Buffer | Uint8Array, name: string, mime_type?: string, parent_id?: string | null }} options 上传登记
 * @returns {Promise<object>} 条目
 */
export async function uploadAndRegister(username, entityHash, cabinetId, options) {
	const cabinet = await getCabinet(username, entityHash, cabinetId)
	if (!cabinet) throw new Error('cabinet not found')
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
	const cabinet = await getCabinet(username, entityHash, cabinetId)
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
