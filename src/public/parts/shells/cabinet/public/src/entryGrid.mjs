/**
 * 条目网格渲染与选择。
 */
import { setElementI18n } from '/scripts/i18n/index.mjs'
import { renderTemplate } from '/scripts/features/template.mjs'
import { formatEntityAtId } from '/parts/shells:chat/shared/entityHash.mjs'

import { showContextMenu } from './contextMenu.mjs'
import { onEntryOpen } from './entryActions.mjs'
import { escapeAttr, escapeHtml } from './escape.mjs'
import { cabinetStore } from './state.mjs'

/**
 * @param {{ at?: number, entity_hash?: string } | null} stamp 戳
 * @returns {string} 文本
 */
export function formatStamp(stamp) {
	if (!stamp?.at) return ''
	const time = new Date(stamp.at).toLocaleString()
	const who = stamp.entity_hash ? formatEntityAtId(stamp.entity_hash) : ''
	return who ? `${time} · ${who}` : time
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
 * @returns {object[]} 选中条目
 */
export function selectedEntries() {
	return cabinetStore.entries.filter(entry => cabinetStore.selected.has(entry.id))
}

/**
 * @returns {void}
 */
export function renderStatus() {
	setElementI18n(document.getElementById('statusBar'), 'cabinet.statusCount', {
		count: cabinetStore.entries.length,
		selected: cabinetStore.selected.size,
	})
}

/**
 * @returns {Promise<void>}
 */
export async function renderEntries() {
	const { entries, selected } = cabinetStore
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
 * @param {MouseEvent} event 事件
 * @param {object} entry 条目
 * @returns {void}
 */
export function onEntryClick(event, entry) {
	const { entries, selected } = cabinetStore
	const ids = entries.map(row => row.id)
	const index = ids.indexOf(entry.id)
	if (event.shiftKey && cabinetStore.rangeAnchor != null) {
		const from = ids.indexOf(cabinetStore.rangeAnchor)
		const [a, b] = from < index ? [from, index] : [index, from]
		if (!event.ctrlKey && !event.metaKey) selected.clear()
		for (let i = a; i <= b; i++) selected.add(ids[i])
	}
	else if (event.ctrlKey || event.metaKey) {
		if (selected.has(entry.id)) selected.delete(entry.id)
		else selected.add(entry.id)
		cabinetStore.rangeAnchor = entry.id
	}
	else {
		selected.clear()
		selected.add(entry.id)
		cabinetStore.rangeAnchor = entry.id
	}
	void renderEntries()
	renderStatus()
}

/**
 * @returns {void}
 */
export function selectAllEntries() {
	for (const entry of cabinetStore.entries) cabinetStore.selected.add(entry.id)
	void renderEntries()
	renderStatus()
}

/**
 * @returns {void}
 */
export function invertSelection() {
	const { entries, selected } = cabinetStore
	for (const entry of entries)
		if (selected.has(entry.id)) selected.delete(entry.id)
		else selected.add(entry.id)
	void renderEntries()
	renderStatus()
}
