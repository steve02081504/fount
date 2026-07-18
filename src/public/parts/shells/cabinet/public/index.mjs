import { initTranslations, geti18n, setElementI18n, console, confirmI18n, promptI18n } from '/scripts/i18n/index.mjs'
import { showToastI18n } from '/scripts/features/toast.mjs'
import { renderTemplate, usingTemplates } from '/scripts/features/template.mjs'
import { createReadyGate } from '/scripts/test/ready_gate.mjs'
import { formatEntityAtId, formatHashShort } from '/parts/shells:chat/shared/entityHash.mjs'

usingTemplates('/parts/shells:cabinet/src/templates')

import { api, unlockHeaders } from './src/api.mjs'
import { readClipboard, writeClipboard, subscribeClipboard } from './src/clipboard.mjs'
import { createCommandHistory } from './src/commandHistory.mjs'
import { CABINET_APP_GATE } from './src/gate.mjs'
import { matchCabinetShortcut, shortcutLabels } from './src/keyboard.mjs'
import { blobToBase64, generateUploadPreview } from './src/uploadPreview.mjs'

await initTranslations()

const cabinetGate = createReadyGate(CABINET_APP_GATE)
cabinetGate.markPending()

/** @type {object[]} */
let cabinets = []
/** @type {string | null} */
let currentCabinetId = null
/** @type {string | null} */
let currentParentId = null
/** @type {object[]} */
let entries = []
/** @type {{ id: string, name: string }[]} */
let folderTrail = []
/** @type {object | null} */
let currentCabinet = null
/** @type {string | null} 远端浏览中的实体（#user:） */
let remoteEntityHash = null
/** @type {Set<string>} */
const selected = new Set()
/** @type {string | null} */
let rangeAnchor = null
/** @type {Map<string, string>} folderId -> unlock token */
const unlockTokens = new Map()
/** @type {Array<{ cabinet_id: string, parent_id: string | null }>} */
const navStack = []
/** @type {ReturnType<typeof createCommandHistory>} */
const history = createCommandHistory(50)
/** @type {{ mode: 'copy' | 'cut', cabinet_id: string, entry_ids: string[], source_parent_id: string | null, at: number } | null} */
let clipboard = readClipboard()

const isMac = /Mac|iPhone|iPad/.test(navigator.platform || '')
const hotkeys = shortcutLabels(isMac)

subscribeClipboard(value => {
	clipboard = value
})

/**
 * @returns {string | undefined} 当前解锁 token
 */
function currentUnlockToken() {
	return currentParentId ? unlockTokens.get(currentParentId) : undefined
}

/**
 * @returns {boolean} 当前柜是否可写
 */
function canWrite() {
	if (remoteEntityHash) return false
	if (!currentCabinet) return false
	if (currentCabinet.type === 'shared') return Boolean(currentCabinet.can_write)
	if (currentCabinet.type === 'group') return Boolean(currentCabinet.permissions?.can_write)
	return true
}

/**
 * @returns {void}
 */
function syncRemoteChrome() {
	document.body.classList.toggle('cabinet-remote', Boolean(remoteEntityHash))
}

/**
 * @param {string} cabinetId 柜
 * @param {string | null} [parentId] 父目录
 * @returns {string} hash
 */
function locationHashFor(cabinetId, parentId = null) {
	if (remoteEntityHash) {
		const base = `user:${remoteEntityHash}/${cabinetId}`
		return parentId ? `${base}/${parentId}` : base
	}
	const cabinet = cabinets.find(row => row.cabinet_id === cabinetId) || currentCabinet
	const shared = cabinet?.type === 'shared' || (/^[0-9a-f]{64}$/i.test(cabinetId) && !cabinetId.includes(':'))
	const base = shared ? `shared:${cabinetId}` : `cabinet:${cabinetId}`
	return parentId ? `${base}/${parentId}` : base
}

/**
 * 远端索引本地过滤子目录（服务端返回整柜）。
 * @param {object[]} all 全部条目
 * @param {string | null} parentId 父
 * @param {boolean} showHidden 显示隐藏
 * @returns {object[]} 子条目
 */
function filterRemoteChildren(all, parentId, showHidden) {
	const parent = parentId == null || parentId === '' ? null : String(parentId)
	return all
		.filter(entry => (entry.parent_id ?? null) === parent)
		.filter(entry => showHidden || !entry.attrs?.hidden)
		.sort((a, b) => {
			if (a.kind === 'folder' && b.kind !== 'folder') return -1
			if (a.kind !== 'folder' && b.kind === 'folder') return 1
			return String(a.name).localeCompare(String(b.name))
		})
}

/**
 * @param {object[]} all 全部条目
 * @param {string | null} folderId 当前文件夹
 * @returns {{ id: string, name: string }[]} trail
 */
function buildRemoteTrail(all, folderId) {
	const byId = new Map(all.map(entry => [entry.id, entry]))
	const trail = []
	let cur = folderId
	const seen = new Set()
	while (cur && !seen.has(cur)) {
		seen.add(cur)
		const entry = byId.get(cur)
		if (!entry) break
		trail.unshift({ id: entry.id, name: entry.name })
		cur = entry.parent_id
	}
	return trail
}

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
 * @returns {Promise<void>}
 */
async function refreshCabinets() {
	const data = await api('GET', '/cabinets')
	cabinets = data.cabinets || []
	cabinets.sort((a, b) => {
		if (a.cabinet_id === 'default') return -1
		if (b.cabinet_id === 'default') return 1
		if (a.type !== b.type) return a.type === 'personal' ? -1 : 1
		return String(a.name).localeCompare(String(b.name))
	})
	renderCabinetList()
}

/**
 * @returns {void}
 */
function renderCabinetList() {
	const host = document.getElementById('cabinetList')
	host.replaceChildren()
	for (const cabinet of cabinets) {
		const li = document.createElement('li')
		const a = document.createElement('a')
		a.href = `#${locationHashFor(cabinet.cabinet_id)}`
		a.className = cabinet.cabinet_id === currentCabinetId ? 'active' : ''
		const badge = cabinet.type === 'shared' ? '🔗 ' : cabinet.cabinet_id === 'default' ? '★ ' : ''
		a.textContent = `${badge}${cabinet.name}`
		a.addEventListener('click', event => {
			event.preventDefault()
			navStack.length = 0
			const toggle = document.getElementById('cabinet-drawer-toggle')
			if (toggle instanceof HTMLInputElement) toggle.checked = false
			void openCabinet(cabinet.cabinet_id)
		})
		a.addEventListener('contextmenu', event => {
			event.preventDefault()
			void cabinetContext(cabinet)
		})
		li.appendChild(a)
		host.appendChild(li)
	}
}

/**
 * @param {object} cabinet 柜
 * @returns {Promise<void>}
 */
async function cabinetContext(cabinet) {
	if (remoteEntityHash || cabinet.type === 'shared') {
		navStack.length = 0
		await openCabinet(cabinet.cabinet_id)
		return
	}
	const action = await promptI18n('cabinet.cabinetActionPrompt')
	if (action === 'rename') {
		const name = await promptI18n('cabinet.renamePrompt', cabinet.name)
		if (!name) return
		await api('PATCH', `/cabinets/${encodeURIComponent(cabinet.cabinet_id)}`, { name })
		await refreshCabinets()
	}
	else if (action === 'delete' && cabinet.cabinet_id !== 'default') {
		if (!await confirmI18n('cabinet.confirmDeleteCabinet')) return
		await api('DELETE', `/cabinets/${encodeURIComponent(cabinet.cabinet_id)}`)
		if (currentCabinetId === cabinet.cabinet_id) currentCabinetId = 'default'
		await refreshCabinets()
		await openCabinet(currentCabinetId || 'default')
	}
	else if (action === 'visibility') {
		const visibility = await promptI18n('cabinet.visibilityPrompt', cabinet.visibility?.visibility || 'private')
		if (!visibility) return
		await api('PATCH', `/cabinets/${encodeURIComponent(cabinet.cabinet_id)}`, { visibility: { visibility } })
		await refreshCabinets()
	}
}

/**
 * @param {string} cabinetId 柜
 * @param {string | null} [parentId] 父目录
 * @returns {Promise<void>}
 */
async function openCabinet(cabinetId, parentId = null) {
	currentCabinetId = cabinetId
	currentParentId = parentId
	selected.clear()
	rangeAnchor = null
	location.hash = locationHashFor(cabinetId, parentId)
	await refreshEntries()
	renderCabinetList()
}

/**
 * @returns {Promise<void>}
 */
async function refreshEntries() {
	if (!currentCabinetId) return
	const showHidden = document.getElementById('showHidden').checked
	if (remoteEntityHash) {
		const data = await api(
			'GET',
			`/remote/${encodeURIComponent(remoteEntityHash)}/cabinets/${encodeURIComponent(currentCabinetId)}/index`,
		)
		currentCabinet = data.cabinet
		const all = data.entries || []
		folderTrail = buildRemoteTrail(all, currentParentId)
		await renderBreadcrumb()
		entries = filterRemoteChildren(all, currentParentId, showHidden)
		await renderEntries()
		renderStatus()
		return
	}
	const query = new URLSearchParams()
	if (currentParentId) query.set('parent_id', currentParentId)
	if (showHidden) query.set('show_hidden', '1')
	const data = await api(
		'GET',
		`/cabinets/${encodeURIComponent(currentCabinetId)}/index?${query}`,
		null,
		unlockHeaders(currentUnlockToken()),
	)
	currentCabinet = data.cabinet
	folderTrail = data.folder_trail || []
	await renderBreadcrumb()
	if (data.locked) {
		await promptUnlock(currentParentId)
		return
	}
	entries = data.entries || []
	await renderEntries()
	renderStatus()
}

/**
 * @param {string} folderId 文件夹
 * @returns {Promise<void>}
 */
async function promptUnlock(folderId) {
	const dialog = document.getElementById('passwordDialog')
	dialog.showModal()
	await new Promise(resolve => {
		/**
		 *
		 */
		document.getElementById('unlockSubmit').onclick = async () => {
			try {
				const password = document.getElementById('unlockPassword').value
				const result = await api('POST', `/cabinets/${encodeURIComponent(currentCabinetId)}/unlock`, {
					folder_id: folderId,
					password,
				})
				unlockTokens.set(folderId, result.unlock_token)
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
 * @returns {Promise<void>}
 */
async function renderBreadcrumb() {
	const host = document.getElementById('breadcrumb')
	host.replaceChildren()
	const ul = document.createElement('ul')
	if (navStack.length) {
		const back = document.createElement('li')
		back.className = 'breadcrumb-back'
		const button = document.createElement('button')
		button.type = 'button'
		button.dataset.i18n = 'cabinet.back'
		button.textContent = '←'
		button.addEventListener('click', () => {
			const prev = navStack.pop()
			if (prev) void openCabinet(prev.cabinet_id, prev.parent_id)
		})
		back.appendChild(button)
		ul.appendChild(back)
	}
	const segments = [
		{ id: null, name: currentCabinet?.name || currentCabinetId, root: true },
		...folderTrail,
	]
	for (const [index, segment] of segments.entries()) {
		const li = document.createElement('li')
		const isCurrent = index === segments.length - 1
		const label = segment.root ? `⌂  ${segment.name}` : segment.name
		if (isCurrent) {
			const current = document.createElement('span')
			current.className = 'breadcrumb-current'
			current.textContent = label
			current.title = segment.name
			current.setAttribute('aria-current', 'page')
			li.appendChild(current)
		}
		else {
			const button = document.createElement('button')
			button.type = 'button'
			button.textContent = label
			button.title = segment.name
			button.addEventListener('click', () => void openCabinet(currentCabinetId, segment.id))
			li.appendChild(button)
		}
		ul.appendChild(li)
	}
	host.appendChild(ul)
}

/**
 * @returns {Promise<void>}
 */
async function renderEntries() {
	const host = document.getElementById('entryGrid')
	host.replaceChildren()
	for (const entry of entries) {
		const thumbHtml = entry.preview?.url
			? `<img class="entry-thumb" src="${escapeAttr(entry.preview.url)}" alt="" />`
			: `<div class="entry-thumb flex items-center justify-center text-2xl">${iconFor(entry)}</div>`
		const card = await renderTemplate('entry_card', {
			id: escapeAttr(entry.id),
			selectedClass: selected.has(entry.id) ? ' selected' : '',
			brokenClass: entry.kind === 'link' && entry._broken ? ' broken' : '',
			thumbHtml,
			name: escapeHtml(entry.name),
			subtitle: escapeHtml(entry.description || entry.mime_type || ''),
			modified: escapeHtml(formatStamp(entry.modified)),
		})
		card.addEventListener('click', event => {
			if (entry.kind === 'folder' && !event.ctrlKey && !event.metaKey && !event.shiftKey)
				void onEntryOpen(entry)
			else onEntryClick(event, entry)
		})
		card.addEventListener('dblclick', () => {
			if (entry.kind !== 'folder') void onEntryOpen(entry)
		})
		card.addEventListener('contextmenu', event => showContextMenu(event, entry))
		card.addEventListener('keydown', event => {
			if (event.key === 'Enter') void onEntryOpen(entry)
			else if (event.key === ' ') {
				event.preventDefault()
				onEntryClick(event, entry)
			}
		})
		host.appendChild(card)
	}
}

/**
 * @param {object} entry 条目
 * @returns {string} 图标
 */
function iconFor(entry) {
	if (entry.kind === 'folder') return entry.encryption ? '🔒' : '📁'
	if (entry.kind === 'link') return '🔗'
	if (String(entry.mime_type || '').startsWith('image/')) return '🖼️'
	if (String(entry.mime_type || '').startsWith('video/')) return '🎬'
	if (String(entry.mime_type || '').startsWith('audio/')) return '🎵'
	return '📄'
}

/**
 * @param {MouseEvent} event 事件
 * @param {object} entry 条目
 * @returns {void}
 */
function onEntryClick(event, entry) {
	const ids = entries.map(row => row.id)
	const index = ids.indexOf(entry.id)
	if (event.shiftKey && rangeAnchor != null) {
		const from = ids.indexOf(rangeAnchor)
		const [a, b] = from < index ? [from, index] : [index, from]
		if (!event.ctrlKey && !event.metaKey) selected.clear()
		for (let i = a; i <= b; i++) selected.add(ids[i])
	}
	else if (event.ctrlKey || event.metaKey) {
		if (selected.has(entry.id)) selected.delete(entry.id)
		else selected.add(entry.id)
		rangeAnchor = entry.id
	}
	else {
		selected.clear()
		selected.add(entry.id)
		rangeAnchor = entry.id
	}
	void renderEntries()
	renderStatus()
}

/**
 * @param {object} entry 条目
 * @returns {Promise<void>}
 */
async function onEntryOpen(entry) {
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
async function downloadEntry(entry, cabinetId = currentCabinetId, ownerEntityHash) {
	if (!entry?.evfs_path) {
		showToastI18n('warning', 'cabinet.noDownload')
		return
	}
	if (String(entry.evfs_path).startsWith('chat/')) {
		showToastI18n('info', 'cabinet.groupDownloadHint')
		return
	}
	if (currentCabinet?.type === 'shared') {
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
async function uploadFiles(files) {
	if (!canWrite()) return
	/** @type {string[]} */
	const createdIds = []
	for (const file of files) {
		const previewBlob = await generateUploadPreview(file)
		let preview
		if (previewBlob) {
			const uploaded = await api('POST', `/cabinets/${encodeURIComponent(currentCabinetId)}/preview`, {
				plaintext_base64: await blobToBase64(previewBlob),
				name: `preview.${previewBlob.type.includes('avif') ? 'avif' : 'webp'}`,
				mime_type: previewBlob.type,
			})
			preview = { url: uploaded.url, delete_with_file: true }
		}
		const buffer = await file.arrayBuffer()
		const { entry } = await api('POST', `/cabinets/${encodeURIComponent(currentCabinetId)}/entries`, {
			plaintext_base64: arrayBufferToBase64(buffer),
			name: file.name,
			mime_type: file.type || 'application/octet-stream',
			parent_id: currentParentId,
			preview,
		}, unlockHeaders(currentUnlockToken()))
		if (entry?.id) createdIds.push(entry.id)
	}
	await refreshEntries()
	if (createdIds.length)
		await history.push(makeCreateHistory(createdIds, 'upload'))
}

/**
 * @param {string[]} createdIds 新建 id
 * @param {string} label 标签
 * @returns {import('./src/commandHistory.mjs').HistoryEntry} 历史条目
 */
function makeCreateHistory(createdIds, label) {
	const cabinetId = currentCabinetId
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
 * @param {ArrayBuffer} buffer 缓冲
 * @returns {string} base64
 */
function arrayBufferToBase64(buffer) {
	const bytes = new Uint8Array(buffer)
	let binary = ''
	for (const byte of bytes) binary += String.fromCharCode(byte)
	return btoa(binary)
}

/**
 * @returns {object[]} 选中条目
 */
function selectedEntries() {
	return entries.filter(entry => selected.has(entry.id))
}

/**
 * @returns {void}
 */
function renderStatus() {
	setElementI18n(document.getElementById('statusBar'), 'cabinet.statusCount', {
		count: entries.length,
		selected: selected.size,
	})
}

/**
 * @returns {Promise<void>}
 */
async function createFolder() {
	if (!canWrite()) return
	const name = await promptI18n('cabinet.newFolderPrompt')
	if (!name) return
	const { entry } = await api('POST', `/cabinets/${encodeURIComponent(currentCabinetId)}/entries`, {
		kind: 'folder',
		name,
		parent_id: currentParentId,
	}, unlockHeaders(currentUnlockToken()))
	await refreshEntries()
	if (entry?.id)
		await history.push(makeCreateHistory([entry.id], 'newFolder'))
}

/**
 * @param {'copy' | 'cut'} mode 模式
 * @returns {void}
 */
function copySelection(mode) {
	if (!selected.size) return
	if (mode === 'cut' && !canWrite()) return
	clipboard = {
		mode,
		cabinet_id: currentCabinetId,
		entry_ids: [...selected],
		source_parent_id: currentParentId,
		at: Date.now(),
	}
	writeClipboard(clipboard)
	showToastI18n('success', mode === 'copy' ? 'cabinet.copied' : 'cabinet.cutDone')
}

/**
 * @param {boolean} asLinks 是否粘贴为链接
 * @returns {Promise<void>}
 */
async function pasteClipboard(asLinks = false) {
	if (!canWrite()) return
	const clip = clipboard || readClipboard()
	if (!clip?.entry_ids?.length) return
	clipboard = clip

	const sameCabinet = clip.cabinet_id === currentCabinetId
	if (!asLinks && clip.mode === 'cut' && sameCabinet) {
		const targetParent = currentParentId
		const sourceParent = clip.source_parent_id ?? null
		const movedIds = [...clip.entry_ids]
		for (const id of movedIds)
			await api('PATCH', `/cabinets/${encodeURIComponent(currentCabinetId)}/entries/${encodeURIComponent(id)}`, {
				parent_id: targetParent,
			}, unlockHeaders(currentUnlockToken()))
		writeClipboard(null)
		clipboard = null
		await refreshEntries()
		const cabinetId = currentCabinetId
		await history.push({
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

	const sourceUnlock = clip.source_parent_id ? unlockTokens.get(clip.source_parent_id) : undefined
	const created = await api('POST', `/cabinets/${encodeURIComponent(clip.cabinet_id)}/entries/copy`, {
		entry_ids: clip.entry_ids,
		target_parent_id: currentParentId,
		target_cabinet_id: currentCabinetId,
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
		clipboard = null
	}
	await refreshEntries()
	/** @type {string | undefined} */
	let createdRecovery
	const targetCabinetId = currentCabinetId
	await history.push({
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
async function renameSelection() {
	if (!canWrite()) return
	const [entry] = selectedEntries()
	if (!entry) return
	const name = await promptI18n('cabinet.renamePrompt', entry.name)
	if (!name || name === entry.name) return
	const before = entry.name
	await api('PATCH', `/cabinets/${encodeURIComponent(currentCabinetId)}/entries/${encodeURIComponent(entry.id)}`, {
		name,
	}, unlockHeaders(currentUnlockToken()))
	await refreshEntries()
	const cabinetId = currentCabinetId
	const entryId = entry.id
	await history.push({
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
async function deleteSelection() {
	if (!canWrite()) return
	const rows = selectedEntries()
	if (!rows.length) return
	if (rows.some(row => row.attrs?.system) && !await confirmI18n('cabinet.confirmDeleteSystem')) return
	if (!rows.some(row => row.attrs?.system) && !await confirmI18n('cabinet.confirmDelete')) return
	const ids = rows.map(row => row.id)
	const cabinetId = currentCabinetId
	const result = await recoverableDelete(cabinetId, ids)
	selected.clear()
	await refreshEntries()
	let recoveryToken = result.recovery_token
	await history.push({
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
 * @returns {Promise<void>}
 */
async function goUp() {
	if (!currentParentId) return
	const parent = folderTrail.length >= 2
		? folderTrail[folderTrail.length - 2].id
		: null
	await openCabinet(currentCabinetId, folderTrail.length >= 2 ? parent : null)
}

/**
 * @returns {void}
 */
function openCurrentInNewWindow() {
	if (!currentCabinetId) return
	const hash = locationHashFor(currentCabinetId, currentParentId)
	window.open(`${location.pathname}#${hash}`, '_blank', 'noopener')
}

/**
 * @param {string | null} folderId 文件夹；null 表示当前目录
 * @param {string} name 下载名称
 * @returns {Promise<void>}
 */
async function downloadFolder(folderId, name) {
	const query = folderId ? `folder_id=${encodeURIComponent(folderId)}` : ''
	const token = folderId ? unlockTokens.get(folderId) : currentUnlockToken()
	const blob = await api('GET', `/cabinets/${encodeURIComponent(currentCabinetId)}/zip?${query}`, null, unlockHeaders(token))
	const url = URL.createObjectURL(blob)
	const a = document.createElement('a')
	a.href = url
	a.download = `${name || currentCabinet?.name || 'cabinet'}.zip`
	a.click()
	URL.revokeObjectURL(url)
}

/**
 * @returns {Promise<void>}
 */
async function downloadSelection() {
	for (const entry of selectedEntries())
		if (entry.kind === 'folder') await downloadFolder(entry.id, entry.name)
		else if (entry.kind === 'file') await downloadEntry(entry)
}

/**
 * @param {string} label i18n key
 * @param {string} [shortcut] 快捷键
 * @returns {string} 菜单文案
 */
function menuLabel(label, shortcut) {
	const text = geti18n(label) || label
	return shortcut ? `${text} (${shortcut})` : text
}

/**
 * @param {MouseEvent} event 事件
 * @param {object} [entry] 右击条目
 * @returns {void}
 */
function showContextMenu(event, entry) {
	event.preventDefault()
	event.stopPropagation()
	if (entry && !selected.has(entry.id)) {
		selected.clear()
		selected.add(entry.id)
		rangeAnchor = entry.id
		void renderEntries()
		renderStatus()
	}
	const rows = selectedEntries()
	const one = rows.length === 1
	const writable = canWrite()
	const hasClip = Boolean((clipboard || readClipboard())?.entry_ids?.length)
	/* eslint-disable jsdoc/require-jsdoc, jsdoc/require-returns -- context menu action callbacks */
	/** 不可用项直接省略，不用 disabled + 文案解释 */
	const actions = entry
		? [
			one ? { label: menuLabel('cabinet.open'), run: () => onEntryOpen(rows[0]) } : null,
			rows.some(row => row.kind === 'file' || row.kind === 'folder')
				? { label: menuLabel('cabinet.download'), run: downloadSelection }
				: null,
			false,
			writable && one ? { label: menuLabel('cabinet.rename', hotkeys.rename), run: renameSelection } : null,
			{ label: menuLabel('cabinet.copy', hotkeys.copy), run: () => copySelection('copy') },
			writable ? { label: menuLabel('cabinet.cut', hotkeys.cut), run: () => copySelection('cut') } : null,
			false,
			!remoteEntityHash && history.canUndo()
				? { label: menuLabel('cabinet.undo', hotkeys.undo), run: () => history.undo().then(() => refreshEntries()) }
				: null,
			!remoteEntityHash && history.canRedo()
				? { label: menuLabel('cabinet.redo', hotkeys.redo), run: () => history.redo().then(() => refreshEntries()) }
				: null,
			false,
			one ? { label: menuLabel('cabinet.properties'), run: openProps } : null,
			writable ? { label: menuLabel('cabinet.delete', hotkeys.delete), danger: true, run: deleteSelection } : null,
		]
		: [
			writable ? { label: menuLabel('cabinet.upload'), run: () => document.getElementById('fileInput').click() } : null,
			writable ? { label: menuLabel('cabinet.uploadFolder'), run: () => document.getElementById('folderInput').click() } : null,
			writable ? { label: menuLabel('cabinet.newFolder'), run: createFolder } : null,
			{ label: menuLabel('cabinet.newWindow', hotkeys.newWindow), run: openCurrentInNewWindow },
			false,
			writable && hasClip ? { label: menuLabel('cabinet.paste', hotkeys.paste), run: () => pasteClipboard() } : null,
			writable && hasClip ? { label: menuLabel('cabinet.pasteLink', hotkeys.pasteLink), run: () => pasteClipboard(true) } : null,
			false,
			!remoteEntityHash && history.canUndo()
				? { label: menuLabel('cabinet.undo', hotkeys.undo), run: () => history.undo().then(() => refreshEntries()) }
				: null,
			!remoteEntityHash && history.canRedo()
				? { label: menuLabel('cabinet.redo', hotkeys.redo), run: () => history.redo().then(() => refreshEntries()) }
				: null,
			false,
			entries.length ? { label: menuLabel('cabinet.selectAll', hotkeys.selectAll), run: selectAllEntries } : null,
			entries.length ? { label: menuLabel('cabinet.invert'), run: invertSelection } : null,
			currentParentId ? { label: menuLabel('cabinet.goUp', hotkeys.goUp), run: goUp } : null,
			!remoteEntityHash
				? { label: menuLabel('cabinet.downloadZip'), run: () => downloadFolder(currentParentId, currentCabinet?.name) }
				: null,
		]
	/* eslint-enable jsdoc/require-jsdoc, jsdoc/require-returns */
	const menu = document.querySelector('#contextMenu ul')
	menu.replaceChildren()
	const items = []
	for (const action of actions) {
		if (action === null) continue
		if (action === false) {
			if (items.length && items[items.length - 1] !== false) items.push(false)
			continue
		}
		items.push(action)
	}
	while (items[0] === false) items.shift()
	while (items.at(-1) === false) items.pop()
	for (const action of items) {
		if (action === false) {
			const separator = document.createElement('li')
			separator.className = 'menu-separator'
			menu.appendChild(separator)
			continue
		}
		const li = document.createElement('li')
		const button = document.createElement('button')
		button.type = 'button'
		button.textContent = action.label
		if (action.danger) button.classList.add('text-error')
		/**
		 *
		 */
		button.onclick = () => {
			hideContextMenu()
			void action.run()
		}
		li.appendChild(button)
		menu.appendChild(li)
	}
	const host = document.getElementById('contextMenu')
	host.classList.remove('hidden')
	const left = Math.min(event.clientX, window.innerWidth - host.offsetWidth - 8)
	const top = Math.min(event.clientY, window.innerHeight - host.offsetHeight - 8)
	host.style.left = `${Math.max(8, left)}px`
	host.style.top = `${Math.max(8, top)}px`
}

/**
 * @returns {void}
 */
function hideContextMenu() {
	document.getElementById('contextMenu').classList.add('hidden')
}

/**
 * @returns {void}
 */
function selectAllEntries() {
	for (const entry of entries) selected.add(entry.id)
	void renderEntries()
	renderStatus()
}

/**
 * @returns {void}
 */
function invertSelection() {
	for (const entry of entries)
		if (selected.has(entry.id)) selected.delete(entry.id)
		else selected.add(entry.id)
	void renderEntries()
	renderStatus()
}

/**
 * @param {string} command 命令
 * @returns {Promise<boolean>} 是否处理
 */
async function runCommand(command) {
	switch (command) {
		case 'copy':
			copySelection('copy')
			return true
		case 'cut':
			if (!canWrite() || !selected.size) return false
			copySelection('cut')
			return true
		case 'paste':
			if (!canWrite() || !(clipboard || readClipboard())?.entry_ids?.length) return false
			await pasteClipboard(false)
			return true
		case 'pasteLink':
			if (!canWrite() || !(clipboard || readClipboard())?.entry_ids?.length) return false
			await pasteClipboard(true)
			return true
		case 'selectAll':
			if (!entries.length) return false
			selectAllEntries()
			return true
		case 'delete':
			if (!canWrite() || !selected.size) return false
			await deleteSelection()
			return true
		case 'undo':
			if (!history.canUndo()) return false
			await history.undo()
			return true
		case 'redo':
			if (!history.canRedo()) return false
			await history.redo()
			return true
		case 'newWindow':
			openCurrentInNewWindow()
			return true
		case 'rename':
			if (!canWrite() || selected.size !== 1) return false
			await renameSelection()
			return true
		case 'goUp':
			if (!currentParentId) return false
			await goUp()
			return true
		case 'open': {
			const [entry] = selectedEntries()
			if (!entry) return false
			await onEntryOpen(entry)
			return true
		}
		case 'escape':
			hideContextMenu()
			return true
		default:
			return false
	}
}

/**
 * @returns {void}
 */
function wireToolbar() {
	/* eslint-disable jsdoc/require-jsdoc -- DOM onclick/onchange wiring */
	const createCabinet = async () => {
		const name = await promptI18n('cabinet.newCabinetPrompt')
		if (!name) return
		const visibility = await promptI18n('cabinet.visibilityPrompt', 'private') || 'private'
		await api('POST', '/cabinets', { name, visibility: { visibility }, type: 'personal' })
		await refreshCabinets()
	}
	document.getElementById('btnNewCabinet').onclick = createCabinet
	document.getElementById('btnNewCabinetDesktop').onclick = createCabinet
	document.getElementById('fileInput').onchange = async event => {
		if (event.target.files?.length) await uploadFiles(event.target.files)
		event.target.value = ''
	}
	document.getElementById('folderInput').onchange = async event => {
		if (event.target.files?.length) await uploadFiles(event.target.files)
		event.target.value = ''
	}
	document.getElementById('showHidden').onchange = () => void refreshEntries()
	document.getElementById('propSave').onclick = async () => {
		const [entry] = selectedEntries()
		if (!entry || !canWrite()) return
		const before = {
			name: entry.name,
			description: entry.description || '',
			attrs: { ...entry.attrs },
			preview: { ...entry.preview },
		}
		const patch = {
			name: document.getElementById('propName').value,
			description: document.getElementById('propDescription').value,
			attrs: {
				hidden: document.getElementById('propHidden').checked,
				system: document.getElementById('propSystem').checked,
			},
			preview: {
				url: document.getElementById('propPreviewUrl').value,
				delete_with_file: document.getElementById('propDeletePreview').checked,
			},
		}
		const password = document.getElementById('propFolderPassword').value
		if (entry.kind === 'folder' && password)
			patch.set_password = password
		await api('PATCH', `/cabinets/${encodeURIComponent(currentCabinetId)}/entries/${encodeURIComponent(entry.id)}`, patch, unlockHeaders(currentUnlockToken()))
		document.getElementById('propsDialog').close()
		await refreshEntries()
		if (!password) {
			const cabinetId = currentCabinetId
			const entryId = entry.id
			await history.push({
				label: 'props',
				async undo() {
					await api('PATCH', `/cabinets/${encodeURIComponent(cabinetId)}/entries/${encodeURIComponent(entryId)}`, before, unlockHeaders(currentUnlockToken()))
					await refreshEntries()
				},
				async redo() {
					await api('PATCH', `/cabinets/${encodeURIComponent(cabinetId)}/entries/${encodeURIComponent(entryId)}`, patch, unlockHeaders(currentUnlockToken()))
					await refreshEntries()
				},
			})
		}
	}
	document.getElementById('entryGrid').addEventListener('contextmenu', event => showContextMenu(event))
	document.addEventListener('click', hideContextMenu)
	document.addEventListener('keydown', event => {
		const command = matchCabinetShortcut(event)
		if (!command) return
		event.preventDefault()
		void runCommand(command)
	})
	window.addEventListener('blur', hideContextMenu)
	window.addEventListener('pagehide', () => {
		void history.dispose()
	})
	/* eslint-enable jsdoc/require-jsdoc */
}

/**
 * @returns {void}
 */
function openProps() {
	const [entry] = selectedEntries()
	if (!entry) return
	const writable = canWrite()
	document.getElementById('propName').value = entry.name || ''
	document.getElementById('propDescription').value = entry.description || ''
	document.getElementById('propHidden').checked = Boolean(entry.attrs?.hidden)
	document.getElementById('propSystem').checked = Boolean(entry.attrs?.system)
	document.getElementById('propPreviewUrl').value = entry.preview?.url || ''
	document.getElementById('propDeletePreview').checked = entry.preview?.delete_with_file !== false
	document.getElementById('propFolderPasswordWrap').classList.toggle(
		'hidden',
		!writable || entry.kind !== 'folder' || currentCabinet?.type === 'shared',
	)
	document.getElementById('propFolderPassword').value = ''
	for (const el of document.querySelectorAll('[data-prop-field]'))
		el.disabled = !writable
	setElementI18n(document.getElementById('propCreated'), 'cabinet.created', {
		stamp: formatStamp(entry.created),
	})
	setElementI18n(document.getElementById('propModified'), 'cabinet.modified', {
		stamp: formatStamp(entry.modified),
	})
	document.getElementById('propMime').textContent = entry.mime_type || ''
	for (const id of ['propCreated', 'propModified']) {
		const el = document.getElementById(id)
		const stamp = id === 'propCreated' ? entry.created : entry.modified
		const fresh = el.cloneNode(true)
		el.replaceWith(fresh)
		if (stamp?.entity_hash && /^[0-9a-f]{128}$/i.test(stamp.entity_hash)) {
			fresh.classList.add('link', 'link-hover', 'cursor-pointer')
			fresh.addEventListener('click', () => void openEntityProfileCard(stamp.entity_hash))
		}
		else fresh.classList.remove('link', 'link-hover', 'cursor-pointer')
	}
	document.getElementById('propsDialog').showModal()
}

/**
 * @param {{ at?: number, entity_hash?: string } | null} stamp 戳
 * @returns {string} 文本
 */
function formatStamp(stamp) {
	if (!stamp?.at) return ''
	const time = new Date(stamp.at).toLocaleString()
	const who = stamp.entity_hash ? formatEntityAtId(stamp.entity_hash) : ''
	return who ? `${time} · ${who}` : time
}

/**
 * 打开统一人物卡（Chat Hub 同源弹层）。
 * @param {string} entityHash 128 hex
 * @returns {Promise<void>}
 */
async function openEntityProfileCard(entityHash) {
	const hash = String(entityHash || '').trim().toLowerCase()
	if (!/^[0-9a-f]{128}$/i.test(hash)) return
	const { showEntityProfilePopup } = await import('/parts/shells:chat/shared/entityProfilePopup.mjs')
	await showEntityProfilePopup({
		entityHash: hash,
		displayName: formatHashShort(hash, { headLen: 8, tailLen: 4 }),
	})
}

/**
 * 渲染远端实体浏览条。
 * @returns {Promise<void>}
 */
async function renderRemoteEntityBar() {
	const bar = document.getElementById('cabinetRemoteEntityBar')
	if (!remoteEntityHash) {
		bar?.remove()
		return
	}
	const short = formatHashShort(remoteEntityHash, { headLen: 8, tailLen: 4 })
	const host = document.getElementById('breadcrumb')?.parentElement || document.body
	const next = await renderTemplate('remote_entity_bar', { short: escapeHtml(short) })
	next.querySelector('[data-remote-entity-open]')?.addEventListener('click', () => {
		void openEntityProfileCard(remoteEntityHash)
	})
	if (bar) bar.replaceWith(next)
	else host.prepend(next)
}

/**
 * @param {string} text 文本
 * @returns {string} 转义
 */
function escapeHtml(text) {
	return String(text).replace(/[&<>"']/g, ch => ({
		'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', '\'': '&#39;',
	})[ch])
}

/**
 * @param {string} text 文本
 * @returns {string} 属性转义
 */
function escapeAttr(text) {
	return escapeHtml(text)
}

/**
 * @returns {Promise<void>}
 */
async function bootFromHash() {
	const hash = decodeURIComponent(location.hash.replace(/^#/, ''))
	if (hash.startsWith('shared:')) {
		remoteEntityHash = null
		syncRemoteChrome()
		void renderRemoteEntityBar()
		const rest = hash.slice(7)
		const [cabinetId, folderId] = rest.split('/')
		await refreshCabinets()
		await openCabinet(cabinetId, folderId || null)
		return
	}
	if (hash.startsWith('cabinet:')) {
		remoteEntityHash = null
		syncRemoteChrome()
		void renderRemoteEntityBar()
		const rest = hash.slice(8)
		const [cabinetId, folderId] = rest.split('/')
		await openCabinet(cabinetId, folderId || null)
		return
	}
	if (hash.startsWith('user:')) {
		const parts = hash.slice(5).split('/')
		const entityHash = parts[0]
		remoteEntityHash = entityHash.toLowerCase()
		syncRemoteChrome()
		void renderRemoteEntityBar()
		const data = await api('GET', `/remote/${encodeURIComponent(entityHash)}/cabinets`)
		cabinets = data.cabinets || []
		renderCabinetList()
		const cabinetId = parts[1] || cabinets[0]?.cabinet_id
		const folderId = parts[2] || null
		if (cabinetId) await openCabinet(cabinetId, folderId)
		return
	}
	remoteEntityHash = null
	syncRemoteChrome()
	void renderRemoteEntityBar()
	await openCabinet('default')
}

wireToolbar()
try {
	await refreshCabinets()
	await bootFromHash()
	window.addEventListener('hashchange', () => void bootFromHash())
	cabinetGate.markReady()
}
catch (error) {
	console.error(error)
	cabinetGate.markFailed(error)
	showToastI18n('error', 'cabinet.bootstrapFailed', { error: error.message })
}
