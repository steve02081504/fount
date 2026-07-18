/**
 * 柜导航：hash、开柜、列表、面包屑、boot。
 */
import { confirmI18n, promptI18n } from '/scripts/i18n/index.mjs'

import { api, unlockHeaders } from './api.mjs'
import { promptUnlock } from './entryActions.mjs'
import { renderEntries, renderStatus } from './entryGrid.mjs'
import { renderRemoteEntityBar } from './remoteBrowse.mjs'
import { cabinetStore, currentUnlockToken, syncRemoteChrome } from './state.mjs'

/**
 * @param {string | null} remoteEntityHash 远端实体；null=本地
 * @returns {void}
 */
function setBrowseMode(remoteEntityHash) {
	cabinetStore.remoteEntityHash = remoteEntityHash
	syncRemoteChrome()
	void renderRemoteEntityBar()
}

/**
 * @param {string} cabinetId 柜
 * @param {string | null} [parentId] 父目录
 * @returns {string} hash
 */
export function locationHashFor(cabinetId, parentId = null) {
	const { remoteEntityHash, cabinets, currentCabinet } = cabinetStore
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
 * @returns {Promise<void>}
 */
export async function refreshCabinets() {
	const data = await api('GET', '/cabinets')
	cabinetStore.cabinets = data.cabinets || []
	cabinetStore.cabinets.sort((a, b) => {
		if (a.type !== b.type) return a.type === 'personal' ? -1 : 1
		return String(a.name).localeCompare(String(b.name))
	})
	renderCabinetList()
}

/**
 * @returns {void}
 */
export function renderCabinetList() {
	const host = document.getElementById('cabinetList')
	host.replaceChildren()
	for (const cabinet of cabinetStore.cabinets) {
		const li = document.createElement('li')
		const a = document.createElement('a')
		a.href = `#${locationHashFor(cabinet.cabinet_id)}`
		a.className = cabinet.cabinet_id === cabinetStore.currentCabinetId ? 'active' : ''
		const badge = cabinet.type === 'shared' ? '🔗 ' : ''
		a.textContent = `${badge}${cabinet.name}`
		a.addEventListener('click', event => {
			event.preventDefault()
			cabinetStore.navStack.length = 0
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
	if (cabinetStore.remoteEntityHash || cabinet.type === 'shared') {
		cabinetStore.navStack.length = 0
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
	else if (action === 'delete') {
		if (!await confirmI18n('cabinet.confirmDeleteCabinet')) return
		const wasCurrent = cabinetStore.currentCabinetId === cabinet.cabinet_id
		await api('DELETE', `/cabinets/${encodeURIComponent(cabinet.cabinet_id)}`)
		await refreshCabinets()
		if (wasCurrent) {
			const next = cabinetStore.cabinets[0]?.cabinet_id
			if (next) await openCabinet(next)
			else await clearCabinetView()
		}
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
export async function openCabinet(cabinetId, parentId = null) {
	cabinetStore.currentCabinetId = cabinetId
	cabinetStore.currentParentId = parentId
	cabinetStore.selected.clear()
	cabinetStore.rangeAnchor = null
	location.hash = locationHashFor(cabinetId, parentId)
	await refreshEntries()
	renderCabinetList()
}

/**
 * @returns {Promise<void>}
 */
export async function refreshEntries() {
	const { currentCabinetId, currentParentId, remoteEntityHash } = cabinetStore
	if (!currentCabinetId) return
	const showHidden = document.getElementById('showHidden').checked
	const query = new URLSearchParams()
	if (currentParentId) query.set('parent_id', currentParentId)
	if (showHidden) query.set('show_hidden', '1')
	const data = remoteEntityHash
		? await api(
			'GET',
			`/remote/${encodeURIComponent(remoteEntityHash)}/cabinets/${encodeURIComponent(currentCabinetId)}/index?${query}`,
		)
		: await api(
			'GET',
			`/cabinets/${encodeURIComponent(currentCabinetId)}/index?${query}`,
			null,
			unlockHeaders(currentUnlockToken()),
		)
	cabinetStore.currentCabinet = data.cabinet
	cabinetStore.folderTrail = data.folder_trail || []
	await renderBreadcrumb()
	if (data.locked) {
		await promptUnlock(currentParentId)
		return
	}
	cabinetStore.entries = data.entries || []
	await renderEntries()
	renderStatus()
}

/**
 * @returns {Promise<void>}
 */
async function renderBreadcrumb() {
	const host = document.getElementById('breadcrumb')
	host.replaceChildren()
	const ul = document.createElement('ul')
	const { navStack, folderTrail, currentCabinet, currentCabinetId } = cabinetStore
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
export async function goUp() {
	const { currentParentId, folderTrail, currentCabinetId } = cabinetStore
	if (!currentParentId) return
	await openCabinet(currentCabinetId, folderTrail.length >= 2 ? folderTrail[folderTrail.length - 2].id : null)
}

/**
 * @returns {void}
 */
export function openCurrentInNewWindow() {
	const { currentCabinetId, currentParentId } = cabinetStore
	if (!currentCabinetId) return
	window.open(`${location.pathname}#${locationHashFor(currentCabinetId, currentParentId)}`, '_blank', 'noopener')
}

/**
 * @param {{ clearHash?: boolean }} [options] 选项
 * @returns {Promise<void>}
 */
async function clearCabinetView({ clearHash = true } = {}) {
	cabinetStore.currentCabinetId = null
	cabinetStore.currentCabinet = null
	cabinetStore.currentParentId = null
	cabinetStore.folderTrail = []
	cabinetStore.entries = []
	cabinetStore.selected.clear()
	cabinetStore.rangeAnchor = null
	if (clearHash) location.hash = ''
	await renderBreadcrumb()
	await renderEntries()
	renderStatus()
	renderCabinetList()
}

/**
 * @returns {Promise<void>}
 */
export async function bootFromHash() {
	const hash = decodeURIComponent(location.hash.replace(/^#/, ''))
	if (hash.startsWith('shared:')) {
		setBrowseMode(null)
		const [cabinetId, folderId] = hash.slice(7).split('/')
		await refreshCabinets()
		await openCabinet(cabinetId, folderId || null)
		return
	}
	if (hash.startsWith('cabinet:')) {
		setBrowseMode(null)
		const [cabinetId, folderId] = hash.slice(8).split('/')
		await openCabinet(cabinetId, folderId || null)
		return
	}
	if (hash.startsWith('user:')) {
		const parts = hash.slice(5).split('/')
		setBrowseMode(parts[0].toLowerCase())
		const data = await api('GET', `/remote/${encodeURIComponent(parts[0])}/cabinets`)
		cabinetStore.cabinets = data.cabinets || []
		renderCabinetList()
		const cabinetId = parts[1] || cabinetStore.cabinets[0]?.cabinet_id
		if (cabinetId) await openCabinet(cabinetId, parts[2] || null)
		else await clearCabinetView({ clearHash: false })
		return
	}
	setBrowseMode(null)
	const first = cabinetStore.cabinets[0]?.cabinet_id
	if (first) await openCabinet(first)
	else await clearCabinetView()
}
