import { randomUUID } from 'node:crypto'

import {
	getCabinet,
	loadPersonalIndex,
	savePersonalIndex,
} from './cabinets.mjs'
import { hardDeleteEntryBlobs, tryDeletePreviewByUrl } from './blobGc.mjs'
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
import { countLocalInboundLinks, gcOrphanAfterUnlink } from './refcount.mjs'
import { issueUnlockToken, resolveUnlockToken } from './unlockTokens.mjs'

/**
 * @param {string} cabinetId 柜 id
 * @returns {boolean} 是否共享柜
 */
function isSharedCabinetId(cabinetId) {
	return Boolean(cabinetId) && !cabinetId.includes(':') && cabinetId.length === 64
}

/**
 * @param {string} username 用户
 * @param {string} entityHash 实体
 * @param {string} cabinetId 柜
 * @returns {Promise<object | null>} 柜；共享柜走 meta
 */
async function resolveCabinet(username, entityHash, cabinetId) {
	const personal = await getCabinet(username, entityHash, cabinetId)
	if (personal) return personal
	if (isSharedCabinetId(cabinetId) || String(cabinetId).length >= 32) {
		const { getSharedCabinetMeta } = await import('./shared/keys.mjs')
		return getSharedCabinetMeta(username, cabinetId)
	}
	return null
}

/**
 * @param {string} username 用户
 * @param {string} entityHash 实体
 * @param {string} cabinetId 柜
 * @param {{ parent_id?: string | null, show_hidden?: boolean, unlock_token?: string }} [options] 选项
 * @returns {Promise<{ cabinet: object, parent_id: string | null, entries: object[], locked?: boolean }>} 列表
 */
export async function listEntries(username, entityHash, cabinetId, options = {}) {
	const cabinet = await resolveCabinet(username, entityHash, cabinetId)
	if (!cabinet) throw new Error('cabinet not found')
	if (cabinet.type === 'shared') {
		const { listSharedEntries } = await import('./shared/ops.mjs')
		return listSharedEntries(username, cabinetId, options)
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
 * @param {string[]} entryIds 条目 ids
 * @returns {Promise<{ deleted: string[] }>} 结果
 */
export async function deleteEntries(username, entityHash, cabinetId, entryIds) {
	const cabinet = await resolveCabinet(username, entityHash, cabinetId)
	if (!cabinet) throw new Error('cabinet not found')
	if (cabinet.type === 'shared') {
		const { deleteSharedEntries } = await import('./shared/ops.mjs')
		return deleteSharedEntries(username, entityHash, cabinetId, entryIds)
	}

	const index = await loadPersonalIndex(username, entityHash, cabinetId)
	const toDelete = new Set()
	for (const id of entryIds)
		for (const childId of collectSubtreeIds(index.entries, id))
			toDelete.add(childId)

	/** @type {string[]} */
	const removed = []
	/** @type {object[]} */
	const kept = []
	/** @type {object[]} */
	const deferredLinks = []

	for (const entry of index.entries) {
		if (!toDelete.has(entry.id)) {
			kept.push(entry)
			continue
		}

		if (entry.kind === 'link') {
			deferredLinks.push(entry)
			removed.push(entry.id)
			continue
		}

		const inbound = await countLocalInboundLinks(username, entityHash, {
			owner_entity_hash: entityHash,
			cabinet_id: cabinetId,
			entry_id: entry.id,
		}, { exclude_cabinet_id: cabinetId, exclude_entry_ids: toDelete })

		if (inbound > 0) {
			kept.push({ ...entry, orphaned: true })
			removed.push(entry.id)
			continue
		}

		removed.push(entry.id)
		await hardDeleteEntryBlobs(username, entityHash, entry)
	}

	await savePersonalIndex(username, entityHash, cabinetId, { version: index.version, entries: kept })
	for (const link of deferredLinks)
		await gcOrphanAfterUnlink(username, entityHash, link)
	return { deleted: removed }
}

/**
 * @param {string} username 用户
 * @param {string} entityHash 实体
 * @param {string} cabinetId 柜
 * @param {{ entry_ids: string[], target_parent_id?: string | null, as_links?: boolean, target_cabinet_id?: string }} body 复制请求
 * @returns {Promise<object[]>} 新条目
 */
export async function copyEntries(username, entityHash, cabinetId, body) {
	const cabinet = await resolveCabinet(username, entityHash, cabinetId)
	if (!cabinet) throw new Error('cabinet not found')
	const targetCabinetId = body.target_cabinet_id || cabinetId
	const targetCabinet = await resolveCabinet(username, entityHash, targetCabinetId)
	if (!targetCabinet) throw new Error('target cabinet not found')

	const sourceIndex = cabinet.type === 'shared'
		? await (await import('./shared/materialize.mjs')).loadSharedIndex(username, cabinetId)
		: await loadPersonalIndex(username, entityHash, cabinetId)

	const targetParent = body.target_parent_id == null || body.target_parent_id === ''
		? null
		: String(body.target_parent_id)
	const created = []

	for (const id of body.entry_ids || []) {
		const source = sourceIndex.entries.find(row => row.id === id)
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
			if (targetCabinet.type === 'shared') {
				const { registerSharedEntry } = await import('./shared/ops.mjs')
				created.push(await registerSharedEntry(username, entityHash, targetCabinetId, link))
			}
			else {
				const targetIndex = await loadPersonalIndex(username, entityHash, targetCabinetId)
				targetIndex.entries.push(link)
				await savePersonalIndex(username, entityHash, targetCabinetId, targetIndex)
				created.push(link)
			}
			continue
		}
		const copy = normalizeEntry({
			...source,
			id: randomUUID(),
			parent_id: targetParent,
			name: `${source.name} (copy)`,
			orphaned: false,
		}, entityHash)
		if (targetCabinet.type === 'shared') {
			const { registerSharedEntry } = await import('./shared/ops.mjs')
			created.push(await registerSharedEntry(username, entityHash, targetCabinetId, copy))
		}
		else {
			const targetIndex = await loadPersonalIndex(username, entityHash, targetCabinetId)
			targetIndex.entries.push(copy)
			await savePersonalIndex(username, entityHash, targetCabinetId, targetIndex)
			created.push(copy)
		}
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

export { tryDeletePreviewByUrl }
