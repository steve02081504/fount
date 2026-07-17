import { initTranslations, geti18n, console, confirmI18n, promptI18n } from '/scripts/i18n/index.mjs'
import { showToastI18n } from '/scripts/features/toast.mjs'

import { api, unlockHeaders } from './src/api.mjs'
import { blobToBase64, generateUploadPreview } from './src/uploadPreview.mjs'

await initTranslations()

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
/** @type {Set<string>} */
const selected = new Set()
/** @type {string | null} */
let rangeAnchor = null
/** @type {{ mode: 'copy' | 'cut', cabinet_id: string, entry_ids: string[] } | null} */
let clipboard = null
/** @type {Map<string, string>} folderId -> unlock token */
const unlockTokens = new Map()
/** @type {Array<{ cabinet_id: string, parent_id: string | null }>} */
const navStack = []

/**
 * @returns {string | undefined} 当前解锁 token
 */
function currentUnlockToken() {
	return currentParentId ? unlockTokens.get(currentParentId) : undefined
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
		a.href = `#cabinet:${cabinet.cabinet_id}`
		a.className = cabinet.cabinet_id === currentCabinetId ? 'active' : ''
		const badge = cabinet.type === 'shared' ? '🔗 ' : cabinet.cabinet_id === 'default' ? '★ ' : ''
		a.textContent = `${badge}${cabinet.name}`
		a.addEventListener('click', event => {
			event.preventDefault()
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
	if (cabinet.type === 'shared') {
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
	location.hash = parentId
		? `cabinet:${cabinetId}/${parentId}`
		: cabinetId.startsWith('group:')
			? `group:${cabinetId.slice(6)}`
			: `cabinet:${cabinetId}`
	await refreshEntries()
	renderCabinetList()
}

/**
 * @returns {Promise<void>}
 */
async function refreshEntries() {
	if (!currentCabinetId) return
	const query = new URLSearchParams()
	if (currentParentId) query.set('parent_id', currentParentId)
	if (document.getElementById('showHidden').checked) query.set('show_hidden', '1')
	const data = await api(
		'GET',
		`/cabinets/${encodeURIComponent(currentCabinetId)}/index?${query}`,
		null,
		unlockHeaders(currentUnlockToken()),
	)
	currentCabinet = data.cabinet
	folderTrail = data.folder_trail || []
	renderBreadcrumb()
	if (data.locked) {
		await promptUnlock(currentParentId)
		return
	}
	entries = data.entries || []
	renderEntries()
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
 * @returns {void}
 */
function renderBreadcrumb() {
	const host = document.getElementById('breadcrumb')
	host.replaceChildren()
	const ul = document.createElement('ul')
	if (navStack.length) {
		const back = document.createElement('li')
		back.className = 'breadcrumb-back'
		const button = document.createElement('button')
		button.type = 'button'
		button.title = geti18n('cabinet.back') || 'Back'
		button.setAttribute('aria-label', button.title)
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
 * @returns {void}
 */
function renderEntries() {
	const host = document.getElementById('entryGrid')
	host.replaceChildren()
	for (const entry of entries) {
		const card = document.createElement('div')
		card.className = `entry-card${selected.has(entry.id) ? ' selected' : ''}${entry.kind === 'link' && entry._broken ? ' broken' : ''}`
		card.dataset.id = entry.id
		card.tabIndex = 0
		card.setAttribute('role', 'button')
		const thumb = entry.preview?.url
			? `<img class="entry-thumb" src="${escapeAttr(entry.preview.url)}" alt="" />`
			: `<div class="entry-thumb flex items-center justify-center text-2xl">${iconFor(entry)}</div>`
		card.innerHTML = `${thumb}<div class="font-medium text-sm truncate mt-1">${escapeHtml(entry.name)}</div>
			<div class="text-xs opacity-60 truncate">${escapeHtml(entry.description || entry.mime_type || '')}</div>
			<div class="text-[10px] opacity-50 truncate">${formatStamp(entry.modified)}</div>`
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
	renderEntries()
	renderStatus()
}

/**
 * @param {object} entry 条目
 * @returns {Promise<void>}
 */
async function onEntryOpen(entry) {
	if (entry.kind === 'folder') {
		if (entry.encryption && !unlockTokens.has(entry.id)) 
			await promptUnlock(entry.id)
		
		await openCabinet(currentCabinetId, entry.id)
		return
	}
	if (entry.kind === 'link') {
		const resolved = await api('GET', `/cabinets/${encodeURIComponent(currentCabinetId)}/entries/${encodeURIComponent(entry.id)}/resolve`)
		if (!resolved.ok) {
			showToastI18n('warning', 'cabinet.brokenLink', { reason: resolved.reason })
			entry._broken = true
			renderEntries()
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
	await downloadEntry(entry)
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
		await api('POST', `/cabinets/${encodeURIComponent(currentCabinetId)}/entries`, {
			plaintext_base64: arrayBufferToBase64(buffer),
			name: file.name,
			mime_type: file.type || 'application/octet-stream',
			parent_id: currentParentId,
			preview,
		}, unlockHeaders(currentUnlockToken()))
	}
	await refreshEntries()
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
 * @returns {boolean} 当前目录是否可写
 */
function canWrite() {
	return currentCabinet?.type !== 'group' || Boolean(currentCabinet?.permissions?.can_write)
}

/**
 * @returns {void}
 */
function renderStatus() {
	document.getElementById('statusBar').textContent = geti18n('cabinet.statusCount', {
		count: entries.length,
		selected: selected.size,
	}) || `${entries.length} items`
}

/**
 * @returns {Promise<void>}
 */
async function createFolder() {
	const name = await promptI18n('cabinet.newFolderPrompt')
	if (!name) return
	await api('POST', `/cabinets/${encodeURIComponent(currentCabinetId)}/entries`, {
		kind: 'folder',
		name,
		parent_id: currentParentId,
	}, unlockHeaders(currentUnlockToken()))
	await refreshEntries()
}

/**
 * @param {'copy' | 'cut'} mode 模式
 * @returns {void}
 */
function copySelection(mode) {
	if (!selected.size) return
	clipboard = { mode, cabinet_id: currentCabinetId, entry_ids: [...selected] }
	showToastI18n('success', mode === 'copy' ? 'cabinet.copied' : 'cabinet.cutDone')
}

/**
 * @param {boolean} asLinks 是否粘贴为链接
 * @returns {Promise<void>}
 */
async function pasteClipboard(asLinks = false) {
	if (!clipboard?.entry_ids?.length) return
	await api('POST', `/cabinets/${encodeURIComponent(currentCabinetId)}/entries/copy`, {
		entry_ids: clipboard.entry_ids,
		target_parent_id: currentParentId,
		...asLinks ? { as_links: true } : {},
	})
	if (!asLinks && clipboard.mode === 'cut' && clipboard.cabinet_id === currentCabinetId) {
		await api('DELETE', `/cabinets/${encodeURIComponent(currentCabinetId)}/entries`, {
			entry_ids: clipboard.entry_ids,
		})
		clipboard = null
	}
	await refreshEntries()
}

/**
 * @returns {Promise<void>}
 */
async function renameSelection() {
	const [entry] = selectedEntries()
	if (!entry) return
	const name = await promptI18n('cabinet.renamePrompt', entry.name)
	if (!name) return
	await api('PATCH', `/cabinets/${encodeURIComponent(currentCabinetId)}/entries/${encodeURIComponent(entry.id)}`, { name })
	await refreshEntries()
}

/**
 * @returns {Promise<void>}
 */
async function deleteSelection() {
	const rows = selectedEntries()
	if (!rows.length) return
	if (rows.some(row => row.attrs?.system) && !await confirmI18n('cabinet.confirmDeleteSystem')) return
	if (!rows.some(row => row.attrs?.system) && !await confirmI18n('cabinet.confirmDelete')) return
	await api('DELETE', `/cabinets/${encodeURIComponent(currentCabinetId)}/entries`, {
		entry_ids: rows.map(row => row.id),
	})
	selected.clear()
	await refreshEntries()
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
		renderEntries()
		renderStatus()
	}
	const rows = selectedEntries()
	const one = rows.length === 1
	const writable = canWrite()
	/* eslint-disable jsdoc/require-jsdoc, jsdoc/require-returns -- context menu action callbacks */
	const actions = entry
		? [
			one ? { label: 'cabinet.open', run: () => onEntryOpen(rows[0]) } : null,
			{ label: 'cabinet.download', disabled: !rows.some(row => row.kind === 'file' || row.kind === 'folder'), run: downloadSelection },
			false,
			{ label: 'cabinet.rename', disabled: !writable || !one, run: renameSelection },
			{ label: 'cabinet.copy', run: () => copySelection('copy') },
			{ label: 'cabinet.cut', disabled: !writable, run: () => copySelection('cut') },
			false,
			{ label: 'cabinet.properties', disabled: !one, run: openProps },
			{ label: 'cabinet.delete', disabled: !writable, danger: true, run: deleteSelection },
		]
		: [
			{ label: 'cabinet.upload', disabled: !writable, run: () => document.getElementById('fileInput').click() },
			{ label: 'cabinet.uploadFolder', disabled: !writable, run: () => document.getElementById('folderInput').click() },
			{ label: 'cabinet.newFolder', disabled: !writable, run: createFolder },
			false,
			{ label: 'cabinet.paste', disabled: !writable || !clipboard?.entry_ids?.length, run: () => pasteClipboard() },
			{ label: 'cabinet.pasteLink', disabled: !writable || !clipboard?.entry_ids?.length, run: () => pasteClipboard(true) },
			false,
			{ label: 'cabinet.selectAll', disabled: !entries.length, run: selectAllEntries },
			{ label: 'cabinet.invert', disabled: !entries.length, run: invertSelection },
			{ label: 'cabinet.downloadZip', run: () => downloadFolder(currentParentId, currentCabinet?.name) },
		]
	/* eslint-enable jsdoc/require-jsdoc, jsdoc/require-returns */
	const menu = document.querySelector('#contextMenu ul')
	menu.replaceChildren()
	for (const action of actions) {
		if (action === null) continue
		if (action === false) {
			const separator = document.createElement('li')
			separator.className = 'menu-separator'
			menu.appendChild(separator)
			continue
		}
		const li = document.createElement('li')
		const button = document.createElement('button')
		button.type = 'button'
		button.textContent = geti18n(action.label) || action.label
		button.disabled = action.disabled
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
	renderEntries()
	renderStatus()
}

/**
 * @returns {void}
 */
function invertSelection() {
	for (const entry of entries)
		if (selected.has(entry.id)) selected.delete(entry.id)
		else selected.add(entry.id)
	renderEntries()
	renderStatus()
}

/**
 * @returns {void}
 */
function wireToolbar() {
	/* eslint-disable jsdoc/require-jsdoc -- DOM onclick/onchange wiring */
	document.getElementById('btnNewCabinet').onclick = async () => {
		const name = await promptI18n('cabinet.newCabinetPrompt')
		if (!name) return
		const visibility = await promptI18n('cabinet.visibilityPrompt', 'private') || 'private'
		await api('POST', '/cabinets', { name, visibility: { visibility }, type: 'personal' })
		await refreshCabinets()
	}
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
		if (!entry) return
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
		await api('PATCH', `/cabinets/${encodeURIComponent(currentCabinetId)}/entries/${encodeURIComponent(entry.id)}`, patch)
		document.getElementById('propsDialog').close()
		await refreshEntries()
	}
	document.getElementById('entryGrid').addEventListener('contextmenu', event => showContextMenu(event))
	document.addEventListener('click', hideContextMenu)
	document.addEventListener('keydown', event => {
		if (event.key === 'Escape') hideContextMenu()
	})
	window.addEventListener('blur', hideContextMenu)
	/* eslint-enable jsdoc/require-jsdoc */
}

/**
 * @returns {void}
 */
function openProps() {
	const [entry] = selectedEntries()
	if (!entry) return
	document.getElementById('propName').value = entry.name || ''
	document.getElementById('propDescription').value = entry.description || ''
	document.getElementById('propHidden').checked = Boolean(entry.attrs?.hidden)
	document.getElementById('propSystem').checked = Boolean(entry.attrs?.system)
	document.getElementById('propPreviewUrl').value = entry.preview?.url || ''
	document.getElementById('propDeletePreview').checked = entry.preview?.delete_with_file !== false
	document.getElementById('propFolderPasswordWrap').classList.toggle('hidden', entry.kind !== 'folder' || currentCabinet?.type === 'shared')
	document.getElementById('propFolderPassword').value = ''
	document.getElementById('propCreated').textContent = `${geti18n('cabinet.created') || 'Created'}: ${formatStamp(entry.created)}`
	document.getElementById('propModified').textContent = `${geti18n('cabinet.modified') || 'Modified'}: ${formatStamp(entry.modified)}`
	document.getElementById('propMime').textContent = `MIME: ${entry.mime_type || ''}`
	document.getElementById('propsDialog').showModal()
}

/**
 * @param {{ at?: number, entity_hash?: string } | null} stamp 戳
 * @returns {string} 文本
 */
function formatStamp(stamp) {
	if (!stamp?.at) return ''
	const time = new Date(stamp.at).toLocaleString()
	const who = stamp.entity_hash ? stamp.entity_hash.slice(0, 8) : ''
	return who ? `${time} · ${who}` : time
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
		const cabinetId = hash.slice(7).split('/')[0]
		await refreshCabinets()
		await openCabinet(cabinetId)
		return
	}
	if (hash.startsWith('cabinet:')) {
		const rest = hash.slice(8)
		const [cabinetId, folderId] = rest.split('/')
		await openCabinet(cabinetId, folderId || null)
		return
	}
	if (hash.startsWith('user:')) {
		const entityHash = hash.slice(5)
		const data = await api('GET', `/remote/${encodeURIComponent(entityHash)}/cabinets`)
		cabinets = data.cabinets || []
		renderCabinetList()
		if (cabinets[0]) await openCabinet(cabinets[0].cabinet_id)
		return
	}
	await openCabinet('default')
}

wireToolbar()
try {
	await refreshCabinets()
	await bootFromHash()
	window.addEventListener('hashchange', () => void bootFromHash())
}
catch (error) {
	console.error(error)
	showToastI18n('error', 'cabinet.bootstrapFailed', { error: error.message })
}
