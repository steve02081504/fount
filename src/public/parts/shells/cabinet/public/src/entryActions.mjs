/**
 * 条目打开 / 下载 / 上传 / CRUD / 剪贴板 / 可恢复删除。
 */
import { confirmI18n, promptI18n } from '/scripts/i18n/index.mjs'
import { showToastI18n } from '/scripts/features/toast.mjs'

import { api, unlockHeaders } from './api.mjs'
import { readClipboard, writeClipboard } from './clipboard.mjs'
import { renderEntries, selectedEntries } from './entryGrid.mjs'
import { openCabinet, refreshEntries } from './navigation.mjs'
import { canWrite, cabinetStore, currentUnlockToken } from './state.mjs'
import { arrayBufferToBase64, blobToBase64, generateUploadPreview } from './uploadPreview.mjs'

/**
 * @param {string} cabinetId 柜
 * @param {string} recoveryToken token
 * @returns {Promise<void>}
 */
async function finalizeRecovery(cabinetId, recoveryToken) {
	if (!recoveryToken) return
	await api('POST', `/cabinets/${encodeURIComponent(cabinetId)}/entries/finalize-delete`, {
		recovery_token: recoveryToken,
	}).catch(() => { })
}

/**
 * @param {string} cabinetId 柜
 * @param {string[]} entryIds ids
 * @returns {Promise<{ deleted: string[], recovery_token?: string }>} 删除结果
 */
async function recoverableDelete(cabinetId, entryIds) {
	return api('DELETE', `/cabinets/${encodeURIComponent(cabinetId)}/entries`, {
		entry_ids: entryIds,
		recoverable: true,
	}, unlockHeaders(currentUnlockToken()))
}

/**
 * @param {string} cabinetId 柜
 * @param {string} recoveryToken token
 * @param {string} [unlockToken] unlock
 * @returns {Promise<void>}
 */
async function restoreRecovery(cabinetId, recoveryToken, unlockToken = currentUnlockToken()) {
	await api('POST', `/cabinets/${encodeURIComponent(cabinetId)}/entries/restore`, {
		recovery_token: recoveryToken,
	}, unlockHeaders(unlockToken))
}

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
				const result = await api('POST', `/cabinets/${encodeURIComponent(cabinetStore.currentCabinetId)}/unlock`, {
					folder_id: folderId,
					password,
				})
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
		const resolved = await api('GET', `/cabinets/${encodeURIComponent(currentCabinetId)}/entries/${encodeURIComponent(entry.id)}/resolve`)
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
		const a = document.createElement('a')
		a.href = `/api/parts/shells:cabinet/cabinets/${encodeURIComponent(cabinetId)}/entries/${encodeURIComponent(entry.id)}/download`
		a.download = entry.name
		a.click()
		return
	}
	const entity = ownerEntityHash || (await api('GET', '/viewer')).viewer_entity_hash
	const url = `/api/parts/shells:chat/entities/${encodeURIComponent(entity)}/files/${entry.evfs_path.split('/').map(encodeURIComponent).join('/')}`
	const a = document.createElement('a')
	a.href = url
	a.download = entry.name
	a.click()
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
			const uploaded = await api('POST', `/cabinets/${encodeURIComponent(cabinetStore.currentCabinetId)}/preview`, {
				plaintext_base64: await blobToBase64(previewBlob),
				name: `preview.${previewBlob.type.includes('avif') ? 'avif' : 'webp'}`,
				mime_type: previewBlob.type,
			})
			preview = { url: uploaded.url, delete_with_file: true }
		}
		const buffer = await file.arrayBuffer()
		const { entry } = await api('POST', `/cabinets/${encodeURIComponent(cabinetStore.currentCabinetId)}/entries`, {
			plaintext_base64: arrayBufferToBase64(buffer),
			name: file.name,
			mime_type: file.type || 'application/octet-stream',
			parent_id: cabinetStore.currentParentId,
			preview,
		}, unlockHeaders(currentUnlockToken()))
		if (entry?.id) createdIds.push(entry.id)
	}
	await refreshEntries()
	if (createdIds.length)
		await cabinetStore.history.push(makeCreateHistory(createdIds, 'upload'))
}

/**
 * @param {string[]} createdIds 新建 id
 * @param {string} label 标签
 * @returns {import('./commandHistory.mjs').HistoryEntry} 历史条目
 */
function makeCreateHistory(createdIds, label) {
	const cabinetId = cabinetStore.currentCabinetId
	/** @type {string | undefined} */
	let recoveryToken
	return {
		label,
		/**
		 *
		 */
		async undo() {
			const result = await recoverableDelete(cabinetId, createdIds)
			recoveryToken = result.recovery_token
			await refreshEntries()
		},
		/**
		 *
		 */
		async redo() {
			if (!recoveryToken) return
			await restoreRecovery(cabinetId, recoveryToken)
			recoveryToken = undefined
			await refreshEntries()
		},
		/**
		 *
		 */
		async discard() {
			if (recoveryToken) await finalizeRecovery(cabinetId, recoveryToken)
			recoveryToken = undefined
		},
	}
}

/**
 * @returns {Promise<void>}
 */
export async function createFolder() {
	if (!canWrite()) return
	const name = await promptI18n('cabinet.newFolderPrompt')
	if (!name) return
	const { entry } = await api('POST', `/cabinets/${encodeURIComponent(cabinetStore.currentCabinetId)}/entries`, {
		kind: 'folder',
		name,
		parent_id: cabinetStore.currentParentId,
	}, unlockHeaders(currentUnlockToken()))
	await refreshEntries()
	if (entry?.id)
		await cabinetStore.history.push(makeCreateHistory([entry.id], 'newFolder'))
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
	const clip = cabinetStore.clipboard || readClipboard()
	if (!clip?.entry_ids?.length) return
	cabinetStore.clipboard = clip

	const sameCabinet = clip.cabinet_id === cabinetStore.currentCabinetId
	if (!asLinks && clip.mode === 'cut' && sameCabinet) {
		const targetParent = cabinetStore.currentParentId
		const sourceParent = clip.source_parent_id ?? null
		const movedIds = [...clip.entry_ids]
		for (const id of movedIds)
			await api('PATCH', `/cabinets/${encodeURIComponent(cabinetStore.currentCabinetId)}/entries/${encodeURIComponent(id)}`, {
				parent_id: targetParent,
			}, unlockHeaders(currentUnlockToken()))
		writeClipboard(null)
		cabinetStore.clipboard = null
		await refreshEntries()
		const cabinetId = cabinetStore.currentCabinetId
		await cabinetStore.history.push({
			label: 'cut',
			/**
			 *
			 */
			async undo() {
				for (const id of movedIds)
					await api('PATCH', `/cabinets/${encodeURIComponent(cabinetId)}/entries/${encodeURIComponent(id)}`, {
						parent_id: sourceParent,
					}, unlockHeaders(currentUnlockToken()))
				await refreshEntries()
			},
			/**
			 *
			 */
			async redo() {
				for (const id of movedIds)
					await api('PATCH', `/cabinets/${encodeURIComponent(cabinetId)}/entries/${encodeURIComponent(id)}`, {
						parent_id: targetParent,
					}, unlockHeaders(currentUnlockToken()))
				await refreshEntries()
			},
		})
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
		const result = await api('DELETE', `/cabinets/${encodeURIComponent(clip.cabinet_id)}/entries`, {
			entry_ids: clip.entry_ids,
			recoverable: true,
		}, unlockHeaders(sourceUnlock))
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
				const result = await api('DELETE', `/cabinets/${encodeURIComponent(clip.cabinet_id)}/entries`, {
					entry_ids: clip.entry_ids,
					recoverable: true,
				}, unlockHeaders(sourceUnlock))
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
	const before = entry.name
	await api('PATCH', `/cabinets/${encodeURIComponent(cabinetStore.currentCabinetId)}/entries/${encodeURIComponent(entry.id)}`, {
		name,
	}, unlockHeaders(currentUnlockToken()))
	await refreshEntries()
	const cabinetId = cabinetStore.currentCabinetId
	const entryId = entry.id
	await cabinetStore.history.push({
		label: 'rename',
		/**
		 *
		 */
		async undo() {
			await api('PATCH', `/cabinets/${encodeURIComponent(cabinetId)}/entries/${encodeURIComponent(entryId)}`, {
				name: before,
			}, unlockHeaders(currentUnlockToken()))
			await refreshEntries()
		},
		/**
		 *
		 */
		async redo() {
			await api('PATCH', `/cabinets/${encodeURIComponent(cabinetId)}/entries/${encodeURIComponent(entryId)}`, {
				name,
			}, unlockHeaders(currentUnlockToken()))
			await refreshEntries()
		},
	})
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
	let recoveryToken = result.recovery_token
	await cabinetStore.history.push({
		label: 'delete',
		/**
		 *
		 */
		async undo() {
			if (!recoveryToken) return
			await restoreRecovery(cabinetId, recoveryToken)
			recoveryToken = undefined
			await refreshEntries()
		},
		/**
		 *
		 */
		async redo() {
			const again = await recoverableDelete(cabinetId, ids)
			recoveryToken = again.recovery_token
			await refreshEntries()
		},
		/**
		 *
		 */
		async discard() {
			if (recoveryToken) await finalizeRecovery(cabinetId, recoveryToken)
			recoveryToken = undefined
		},
	})
}

/**
 * @param {string | null} folderId 文件夹；null 表示当前目录
 * @param {string} name 下载名称
 * @returns {Promise<void>}
 */
export async function downloadFolder(folderId, name) {
	const query = folderId ? `folder_id=${encodeURIComponent(folderId)}` : ''
	const token = folderId ? cabinetStore.unlockTokens.get(folderId) : currentUnlockToken()
	const blob = await api('GET', `/cabinets/${encodeURIComponent(cabinetStore.currentCabinetId)}/zip?${query}`, null, unlockHeaders(token))
	const url = URL.createObjectURL(blob)
	const a = document.createElement('a')
	a.href = url
	a.download = `${name || cabinetStore.currentCabinet?.name || 'cabinet'}.zip`
	a.click()
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
