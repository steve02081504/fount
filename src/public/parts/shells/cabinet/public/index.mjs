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
		const badge = cabinet.type === 'group' ? '👥 ' : cabinet.cabinet_id === 'default' ? '★ ' : ''
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
	if (cabinet.type === 'group') {
		window.open(`/parts/shells:chat/hub/#group:${cabinet.group_id}`, '_blank')
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
	if (data.locked) {
		await promptUnlock(currentParentId)
		return
	}
	entries = data.entries || []
	renderEntries()
	renderBreadcrumb()
	document.getElementById('statusBar').textContent = geti18n('cabinet.statusCount', {
		count: entries.length,
		selected: selected.size,
	}) || `${entries.length} items`
	const canWrite = currentCabinet?.type !== 'group' || currentCabinet?.permissions?.can_write
	document.getElementById('btnUpload').disabled = !canWrite
	document.getElementById('btnUploadFolder').disabled = !canWrite
	document.getElementById('btnNewFolder').disabled = !canWrite
	document.getElementById('btnDelete').disabled = !canWrite
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
	const root = document.createElement('a')
	root.textContent = currentCabinet?.name || currentCabinetId
	root.href = '#'
	root.addEventListener('click', event => {
		event.preventDefault()
		void openCabinet(currentCabinetId, null)
	})
	const ul = document.createElement('ul')
	const li = document.createElement('li')
	li.appendChild(root)
	ul.appendChild(li)
	if (navStack.length) {
		const back = document.createElement('li')
		const a = document.createElement('a')
		a.href = '#'
		a.textContent = '↩'
		a.addEventListener('click', event => {
			event.preventDefault()
			const prev = navStack.pop()
			if (prev) void openCabinet(prev.cabinet_id, prev.parent_id)
		})
		back.appendChild(a)
		ul.appendChild(back)
	}
	if (currentParentId) {
		const li2 = document.createElement('li')
		li2.textContent = currentParentId.slice(0, 8)
		ul.appendChild(li2)
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
		const thumb = entry.preview?.url
			? `<img class="entry-thumb" src="${escapeAttr(entry.preview.url)}" alt="" />`
			: `<div class="entry-thumb flex items-center justify-center text-2xl">${iconFor(entry)}</div>`
		card.innerHTML = `${thumb}<div class="font-medium text-sm truncate mt-1">${escapeHtml(entry.name)}</div>
			<div class="text-xs opacity-60 truncate">${escapeHtml(entry.description || entry.mime_type || '')}</div>
			<div class="text-[10px] opacity-50 truncate">${formatStamp(entry.modified)}</div>`
		card.addEventListener('click', event => onEntryClick(event, entry))
		card.addEventListener('dblclick', () => void onEntryOpen(entry))
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
	document.getElementById('btnUpload').onclick = () => document.getElementById('fileInput').click()
	document.getElementById('btnUploadFolder').onclick = () => document.getElementById('folderInput').click()
	document.getElementById('fileInput').onchange = async event => {
		if (event.target.files?.length) await uploadFiles(event.target.files)
		event.target.value = ''
	}
	document.getElementById('folderInput').onchange = async event => {
		if (event.target.files?.length) await uploadFiles(event.target.files)
		event.target.value = ''
	}
	document.getElementById('btnNewFolder').onclick = async () => {
		const name = await promptI18n('cabinet.newFolderPrompt')
		if (!name) return
		await api('POST', `/cabinets/${encodeURIComponent(currentCabinetId)}/entries`, {
			kind: 'folder',
			name,
			parent_id: currentParentId,
		}, unlockHeaders(currentUnlockToken()))
		await refreshEntries()
	}
	document.getElementById('showHidden').onchange = () => void refreshEntries()
	document.getElementById('btnSelectAll').onclick = () => {
		for (const entry of entries) selected.add(entry.id)
		renderEntries()
	}
	document.getElementById('btnInvert').onclick = () => {
		for (const entry of entries) 
			if (selected.has(entry.id)) selected.delete(entry.id)
			else selected.add(entry.id)
		
		renderEntries()
	}
	document.getElementById('btnCopy').onclick = () => {
		clipboard = { mode: 'copy', cabinet_id: currentCabinetId, entry_ids: [...selected] }
		showToastI18n('success', 'cabinet.copied')
	}
	document.getElementById('btnCut').onclick = () => {
		clipboard = { mode: 'cut', cabinet_id: currentCabinetId, entry_ids: [...selected] }
		showToastI18n('success', 'cabinet.cutDone')
	}
	document.getElementById('btnPaste').onclick = async () => {
		if (!clipboard?.entry_ids?.length) return
		await api('POST', `/cabinets/${encodeURIComponent(currentCabinetId)}/entries/copy`, {
			entry_ids: clipboard.entry_ids,
			target_parent_id: currentParentId,
		})
		if (clipboard.mode === 'cut' && clipboard.cabinet_id === currentCabinetId) {
			await api('DELETE', `/cabinets/${encodeURIComponent(currentCabinetId)}/entries`, {
				entry_ids: clipboard.entry_ids,
			})
			clipboard = null
		}
		await refreshEntries()
	}
	document.getElementById('btnPasteLink').onclick = async () => {
		if (!clipboard?.entry_ids?.length) return
		await api('POST', `/cabinets/${encodeURIComponent(currentCabinetId)}/entries/copy`, {
			entry_ids: clipboard.entry_ids,
			target_parent_id: currentParentId,
			as_links: true,
		})
		await refreshEntries()
	}
	document.getElementById('btnRename').onclick = async () => {
		const [entry] = selectedEntries()
		if (!entry) return
		const name = await promptI18n('cabinet.renamePrompt', entry.name)
		if (!name) return
		await api('PATCH', `/cabinets/${encodeURIComponent(currentCabinetId)}/entries/${encodeURIComponent(entry.id)}`, { name })
		await refreshEntries()
	}
	document.getElementById('btnDelete').onclick = async () => {
		const rows = selectedEntries()
		if (!rows.length) return
		if (rows.some(row => row.attrs?.system) && !await confirmI18n('cabinet.confirmDeleteSystem')) return
		else if (!await confirmI18n('cabinet.confirmDelete')) return
		await api('DELETE', `/cabinets/${encodeURIComponent(currentCabinetId)}/entries`, {
			entry_ids: rows.map(row => row.id),
		})
		selected.clear()
		await refreshEntries()
	}
	document.getElementById('btnDownload').onclick = async () => {
		for (const entry of selectedEntries())
			if (entry.kind === 'file') await downloadEntry(entry)
	}
	document.getElementById('btnDownloadZip').onclick = async () => {
		const blob = await api('GET', `/cabinets/${encodeURIComponent(currentCabinetId)}/zip?${currentParentId ? `folder_id=${encodeURIComponent(currentParentId)}` : ''}`, null, unlockHeaders(currentUnlockToken()))
		const url = URL.createObjectURL(blob)
		const a = document.createElement('a')
		a.href = url
		a.download = `${currentCabinet?.name || 'cabinet'}.zip`
		a.click()
		URL.revokeObjectURL(url)
	}
	document.getElementById('btnProps').onclick = () => void openProps()
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
	document.getElementById('propFolderPasswordWrap').classList.toggle('hidden', entry.kind !== 'folder' || currentCabinet?.type === 'group')
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
	if (hash.startsWith('group:')) {
		const groupId = hash.slice(6)
		const cabinetId = `group:${groupId}`
		if (!cabinets.some(row => row.cabinet_id === cabinetId)) {
			await api('POST', '/cabinets', { type: 'group', group_id: groupId, name: groupId.slice(0, 8) }).catch(() => { })
			await refreshCabinets()
		}
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
