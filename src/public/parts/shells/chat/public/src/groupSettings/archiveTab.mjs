import { mountTemplate } from '../../../../../../scripts/features/template.mjs'
import { showToastI18n } from '../../../../../../scripts/features/toast.mjs'
import { confirmI18n } from '../../../../../../scripts/i18n/index.mjs'
import { escapeHtml } from '/scripts/lib/escapeHtml.mjs'

import { formatArchiveBytes } from './shared.mjs'

/** @param {import('./state.mjs').GroupSettingsContext} context @returns {Promise<void>} */
export async function renderArchiveStoragePanel(context) {
	const container = document.getElementById('group-archive-container')
	if (!container || !context.groupId) return
	const canManageArchive = context.settingsCaps?.canManageArchive === true
	let archiveRowsHtml = ''
	if (canManageArchive)
		try {
			const resp = await fetch(
				`/api/parts/shells:chat/groups/${encodeURIComponent(context.groupId)}/archive/summary`,
				{ credentials: 'include' },
			)
			const data = await resp.json()
			const files = Array.isArray(data.files) ? data.files : []
			if (files.length)
				archiveRowsHtml = `<div class="overflow-x-auto"><table class="table table-sm">
<thead><tr><th data-i18n="chat.group.settingsArchiveColChannel"></th><th data-i18n="chat.group.settingsArchiveColMonth"></th><th data-i18n="chat.group.settingsArchiveColSize"></th></tr></thead>
<tbody>${files.map(row => `<tr><td>${escapeHtml(row.channelId)}</td><td>${escapeHtml(row.month)}</td><td>${escapeHtml(formatArchiveBytes(row.bytes))}</td></tr>`).join('')}
</tbody></table></div>`
		}
		catch { /* summary miss */ }

	await mountTemplate(container, 'group/settings/archive_storage_panel', {
		currentState: context.state,
		canManageArchive,
		archiveRowsHtml,
	})
	document.getElementById('archive-delete-button')?.addEventListener('click', async () => {
		const raw = document.getElementById('archive-delete-before-month')?.value?.trim()
		if (!raw || !/^\d{4}-\d{2}$/.test(raw)) {
			showToastI18n('error', 'chat.group.settingsArchiveDeleteInvalidMonth')
			return
		}
		if (!confirmI18n('chat.group.settingsArchiveDeleteConfirm', { month: raw })) return
		const deleteArchiveButton = document.getElementById('archive-delete-button')
		if (deleteArchiveButton instanceof HTMLButtonElement) deleteArchiveButton.disabled = true
		try {
			const resp = await fetch(
				`/api/parts/shells:chat/groups/${encodeURIComponent(context.groupId)}/archive?before=${encodeURIComponent(raw)}`,
				{ method: 'DELETE', credentials: 'include' },
			)
			const data = await resp.json()
			if (!resp.ok) throw new Error(data.error || resp.statusText)
			showToastI18n('success', 'chat.group.settingsArchiveDeleteOk', {
				files: String(data.deletedFiles ?? 0),
			})
			await renderArchiveStoragePanel(context)
		}
		catch (error) {
			showToastI18n('error', 'chat.group.settingsArchiveDeleteFailed', { error: error.message })
		}
		finally {
			if (deleteArchiveButton instanceof HTMLButtonElement) deleteArchiveButton.disabled = false
		}
	})
}
