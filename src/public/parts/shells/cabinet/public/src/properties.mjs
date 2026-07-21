/**
 * 属性面板。
 */
import { setElementI18n } from '/scripts/i18n/index.mjs'

import { cabinetApi } from './api.mjs'
import { formatStamp, selectedEntries } from './entryGrid.mjs'
import { refreshEntries } from './navigation.mjs'
import { makePatchHistory } from './recoveryHistory.mjs'
import { openEntityProfileCard } from './remoteBrowse.mjs'
import { canWrite, cabinetStore } from './state.mjs'

/**
 * @returns {void}
 */
export function openProps() {
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
		!writable || entry.kind !== 'folder' || cabinetStore.currentCabinet?.type === 'shared',
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
	for (const [id, stamp] of [['propCreated', entry.created], ['propModified', entry.modified]]) {
		const el = document.getElementById(id)
		const fresh = el.cloneNode(true)
		el.replaceWith(fresh)
		const clickable = stamp?.entity_hash && /^[0-9a-f]{128}$/i.test(stamp.entity_hash)
		fresh.classList.toggle('link', clickable)
		fresh.classList.toggle('link-hover', clickable)
		fresh.classList.toggle('cursor-pointer', clickable)
		if (clickable) fresh.addEventListener('click', () => void openEntityProfileCard(stamp.entity_hash))
	}
	document.getElementById('propsDialog').showModal()
}

/**
 * 保存属性面板。
 * @returns {Promise<void>}
 */
export async function saveProps() {
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
	await cabinetApi('PATCH', `/entries/${encodeURIComponent(entry.id)}`, patch)
	document.getElementById('propsDialog').close()
	await refreshEntries()
	if (!password)
		await cabinetStore.history.push(makePatchHistory({
			entryId: entry.id,
			before,
			after: patch,
			label: 'props',
			cabinetId: cabinetStore.currentCabinetId,
		}))
}
