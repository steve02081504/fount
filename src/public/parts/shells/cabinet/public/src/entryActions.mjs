/**
 * 条目打开 / 下载 / 上传 / CRUD / 剪贴板 / 可恢复删除。
 */
import { confirmI18n, promptI18n } from '/scripts/i18n/index.mjs'
import { showToastI18n } from '/scripts/features/toast.mjs'
import { arrayBufferToBase64, blobToBase64 } from '/scripts/lib/base64.mjs'

import { api, cabinetApi, triggerDownload, unlockHeaders } from './api.mjs'
import { writeClipboard } from './clipboard.mjs'
import { renderEntries, selectedEntries } from './entryGrid.mjs'
import { openCabinet, refreshEntries } from './navigation.mjs'
import {
	finalizeRecovery,
	makeCreateHistory,
	makeDeleteHistory,
	makeMoveHistory,
	makePatchHistory,
	recoverableDelete,
	restoreRecovery,
} from './recoveryHistory.mjs'
import { canWrite, cabinetStore, currentClipboard, currentUnlockToken } from './state.mjs'
import { generateUploadPreview } from './uploadPreview.mjs'

/**
 * @param {string} folderId 文件夹
 * @returns {Promise<void>}
 */
export async function promptUnlock(folderId) {
	const dialog = document.getElementById('passwordDialog')
	dialog.showModal()
	await new Promise(resolve => {
		/**
		 *
		 */
		document.getElementById('unlockSubmit').onclick = async () => {
			try {
				const password = document.getElementById('unlockPassword').value
				const result = await cabinetApi('POST', '/unlock', { folder_id: folderId, password }, { unlock: undefined })
				cabinetStore.unlockTokens.set(folderId, result.unlock_token)
				dialog.close()
				resolve()
				await refreshEntries()
			}
			catch (error) {
				showToastI18n('error', 'cabinet.unlockFailed', { error: error.message })
			}
		}
	})
}

/**
 * @param {object} entry 条目
 * @returns {Promise<void>}
 */
export async function onEntryOpen(entry) {
	const { currentCabinetId, currentParentId, remoteEntityHash, unlockTokens, navStack } = cabinetStore
	if (entry.kind === 'folder') {
		if (entry.encryption && !unlockTokens.has(entry.id)) {
			if (remoteEntityHash) return
			await promptUnlock(entry.id)
		}
		await openCabinet(currentCabinetId, entry.id)
		return
	}
	if (entry.kind === 'link') {
		if (remoteEntityHash) return
		const resolved = await cabinetApi('GET', `/entries/${encodeURIComponent(entry.id)}/resolve`)
		if (!resolved.ok) {
			showToastI18n('warning', 'cabinet.brokenLink', { reason: resolved.reason })
			entry._broken = true
			void renderEntries()
			return
		}
		navStack.push({ cabinet_id: currentCabinetId, parent_id: currentParentId })
		if (resolved.target.kind === 'cabinet') {
			await openCabinet(resolved.target.cabinet_id, null)
			return
		}
		if (resolved.target.entry?.kind === 'folder') {
			await openCabinet(resolved.target.cabinet_id, resolved.target.entry.id)
			return
		}
		await downloadEntry(resolved.target.entry, resolved.target.cabinet_id, resolved.target.owner_entity_hash)
		return
	}
	await downloadEntry(entry, currentCabinetId, remoteEntityHash || undefined)
}

/**
 * @param {object} entry 条目
 * @param {string} [cabinetId] 柜
 * @param {string} [ownerEntityHash] 所有者
 * @returns {Promise<void>}
 */
export async function downloadEntry(entry, cabinetId = cabinetStore.currentCabinetId, ownerEntityHash) {
	if (!entry?.evfs_path) {
		showToastI18n('warning', 'cabinet.noDownload')
		return
	}
	if (String(entry.evfs_path).startsWith('chat/')) {
		showToastI18n('info', 'cabinet.groupDownloadHint')
		return
	}
	if (cabinetStore.currentCabinet?.type === 'shared') {
		triggerDownload(
			`/api/parts/shells:cabinet/cabinets/${encodeURIComponent(cabinetId)}/entries/${encodeURIComponent(entry.id)}/download`,
			entry.name,
		)
		return
	}
	const entity = ownerEntityHash || (await api('GET', '/viewer')).viewer_entity_hash
	triggerDownload(
		`/api/parts/shells:chat/entities/${encodeURIComponent(entity)}/files/${entry.evfs_path.split('/').map(encodeURIComponent).join('/')}`,
		entry.name,
	)
}

/**
 * @param {FileList | File[]} files 文件
 * @returns {Promise<void>}
 */
export async function uploadFiles(files) {
	if (!canWrite()) return
	/** @type {string[]} */
	const createdIds = []
	for (const file of files) {
		const previewBlob = await generateUploadPreview(file)
		let preview
		if (previewBlob) {
			const uploaded = await cabinetApi('POST', '/preview', {
				plaintext_base64: await blobToBase64(previewBlob),
				name: `preview.${previewBlob.type.includes('avif') ? 'avif' : 'webp'}`,
				mime_type: previewBlob.type,
			})
			preview = { url: uploaded.url, delete_with_file: true }
		}
		const { entry } = await cabinetApi('POST', '/entries', {
			plaintext_base64: arrayBufferToBase64(await file.arrayBuffer()),
			name: file.name,
			mime_type: file.type || 'application/octet-stream',
			parent_id: cabinetStore.currentParentId,
			preview,
		})
		if (entry?.id) createdIds.push(entry.id)
	}
	await refreshEntries()
	if (createdIds.length)
		await cabinetStore.history.push(makeCreateHistory(createdIds, 'upload', cabinetStore.currentCabinetId))
}

/**
 * @returns {Promise<void>}
 */
export async function createFolder() {
	if (!canWrite()) return
	const name = await promptI18n('cabinet.newFolderPrompt')
	if (!name) return
	const { entry } = await cabinetApi('POST', '/entries', {
		kind: 'folder',
		name,
		parent_id: cabinetStore.currentParentId,
	})
	await refreshEntries()
	if (entry?.id)
		await cabinetStore.history.push(makeCreateHistory([entry.id], 'newFolder', cabinetStore.currentCabinetId))
}

/**
 * @param {'copy' | 'cut'} mode 模式
 * @returns {void}
 */
export function copySelection(mode) {
	if (!cabinetStore.selected.size) return
	if (mode === 'cut' && !canWrite()) return
	cabinetStore.clipboard = {
		mode,
		cabinet_id: cabinetStore.currentCabinetId,
		entry_ids: [...cabinetStore.selected],
		source_parent_id: cabinetStore.currentParentId,
		at: Date.now(),
	}
	writeClipboard(cabinetStore.clipboard)
	showToastI18n('success', mode === 'copy' ? 'cabinet.copied' : 'cabinet.cutDone')
}

/**
 * @param {boolean} asLinks 是否粘贴为链接
 * @returns {Promise<void>}
 */
export async function pasteClipboard(asLinks = false) {
	if (!canWrite()) return
	const clip = currentClipboard()
	if (!clip?.entry_ids?.length) return
	cabinetStore.clipboard = clip

	const sameCabinet = clip.cabinet_id === cabinetStore.currentCabinetId
	if (!asLinks && clip.mode === 'cut' && sameCabinet) {
		const targetParent = cabinetStore.currentParentId
		const sourceParent = clip.source_parent_id ?? null
		const movedIds = [...clip.entry_ids]
		for (const id of movedIds)
			await cabinetApi('PATCH', `/entries/${encodeURIComponent(id)}`, { parent_id: targetParent })
		writeClipboard(null)
		cabinetStore.clipboard = null
		await refreshEntries()
		await cabinetStore.history.push(makeMoveHistory({
			entryIds: movedIds,
			fromParent: sourceParent,
			toParent: targetParent,
			cabinetId: cabinetStore.currentCabinetId,
		}))
		return
	}

	const sourceUnlock = clip.source_parent_id ? cabinetStore.unlockTokens.get(clip.source_parent_id) : undefined
	const created = await api('POST', `/cabinets/${encodeURIComponent(clip.cabinet_id)}/entries/copy`, {
		entry_ids: clip.entry_ids,
		target_parent_id: cabinetStore.currentParentId,
		target_cabinet_id: cabinetStore.currentCabinetId,
		...asLinks ? { as_links: true } : {},
		...sourceUnlock ? { source_unlock_token: sourceUnlock } : {},
	}, unlockHeaders(currentUnlockToken()))
	const createdIds = (created.entries || []).map(row => row.id).filter(Boolean)
	/** @type {string | undefined} */
	let sourceRecovery
	if (!asLinks && clip.mode === 'cut') {
		const result = await recoverableDelete(clip.cabinet_id, clip.entry_ids, sourceUnlock)
		sourceRecovery = result.recovery_token
		writeClipboard(null)
		cabinetStore.clipboard = null
	}
	await refreshEntries()
	/** @type {string | undefined} */
	let createdRecovery
	const targetCabinetId = cabinetStore.currentCabinetId
	await cabinetStore.history.push({
		label: asLinks ? 'pasteLink' : clip.mode === 'cut' ? 'cut' : 'paste',
		/**
		 *
		 */
		async undo() {
			if (createdIds.length) {
				const result = await recoverableDelete(targetCabinetId, createdIds)
				createdRecovery = result.recovery_token
			}
			if (sourceRecovery) {
				await restoreRecovery(clip.cabinet_id, sourceRecovery, sourceUnlock)
				sourceRecovery = undefined
			}
			await refreshEntries()
		},
		/**
		 *
		 */
		async redo() {
			if (createdRecovery) {
				await restoreRecovery(targetCabinetId, createdRecovery)
				createdRecovery = undefined
			}
			if (clip.mode === 'cut' && !asLinks) {
				const result = await recoverableDelete(clip.cabinet_id, clip.entry_ids, sourceUnlock)
				sourceRecovery = result.recovery_token
			}
			await refreshEntries()
		},
		/**
		 *
		 */
		async discard() {
			if (createdRecovery) await finalizeRecovery(targetCabinetId, createdRecovery)
			if (sourceRecovery) await finalizeRecovery(clip.cabinet_id, sourceRecovery)
		},
	})
}

/**
 * @returns {Promise<void>}
 */
export async function renameSelection() {
	if (!canWrite()) return
	const [entry] = selectedEntries()
	if (!entry) return
	const name = await promptI18n('cabinet.renamePrompt', entry.name)
	if (!name || name === entry.name) return
	await cabinetApi('PATCH', `/entries/${encodeURIComponent(entry.id)}`, { name })
	await refreshEntries()
	await cabinetStore.history.push(makePatchHistory({
		entryId: entry.id,
		before: { name: entry.name },
		after: { name },
		label: 'rename',
		cabinetId: cabinetStore.currentCabinetId,
	}))
}

/**
 * @returns {Promise<void>}
 */
export async function deleteSelection() {
	if (!canWrite()) return
	const rows = selectedEntries()
	if (!rows.length) return
	if (rows.some(row => row.attrs?.system) && !await confirmI18n('cabinet.confirmDeleteSystem')) return
	if (!rows.some(row => row.attrs?.system) && !await confirmI18n('cabinet.confirmDelete')) return
	const ids = rows.map(row => row.id)
	const cabinetId = cabinetStore.currentCabinetId
	const result = await recoverableDelete(cabinetId, ids)
	cabinetStore.selected.clear()
	await refreshEntries()
	await cabinetStore.history.push(makeDeleteHistory(ids, result.recovery_token, cabinetId))
}

/**
 * @param {string | null} folderId 文件夹；null 表示当前目录
 * @param {string} name 下载名称
 * @returns {Promise<void>}
 */
export async function downloadFolder(folderId, name) {
	const query = folderId ? `folder_id=${encodeURIComponent(folderId)}` : ''
	const blob = await cabinetApi('GET', `/zip?${query}`, null, folderId
		? { unlock: cabinetStore.unlockTokens.get(folderId) }
		: {})
	const url = URL.createObjectURL(blob)
	triggerDownload(url, `${name || cabinetStore.currentCabinet?.name || 'cabinet'}.zip`)
	URL.revokeObjectURL(url)
}

/**
 * @returns {Promise<void>}
 */
export async function downloadSelection() {
	for (const entry of selectedEntries())
		if (entry.kind === 'folder') await downloadFolder(entry.id, entry.name)
		else if (entry.kind === 'file') await downloadEntry(entry)
}
