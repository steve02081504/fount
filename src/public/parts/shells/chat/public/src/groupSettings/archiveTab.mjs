import { showToastI18n } from '../../../../../../scripts/features/toast.mjs'
import { confirmI18n } from '../../../../../../scripts/i18n/index.mjs'
import { escapeHtml } from '/scripts/lib/escapeHtml.mjs'
import { deleteArchiveBefore, getArchiveSummary, importChannelArchiveFile } from '../endpoints/channelArchive.mjs'
import { appendTemplate, mountTemplate } from '../templates.mjs'
import { handleError } from '/scripts/features/errorHandlers.mjs'

import { formatArchiveBytes } from './shared.mjs'

/** @param {import('./state.mjs').GroupSettingsContext} context @returns {Promise<void>} */
export async function renderArchiveStoragePanel(context) {
	const container = document.getElementById('group-archive-container')
	if (!container || !context.groupId) return
	const canManageArchive = context.settingsCaps?.canManageArchive === true
	let archiveRowsHtml = ''
	if (canManageArchive)
		try {
			const data = await getArchiveSummary(context.groupId)
			const files = Array.isArray(data.files) ? data.files : []
			if (files.length)
				archiveRowsHtml = `<div class="overflow-x-auto"><table class="table table-sm">
<thead><tr><th data-i18n="chat.group.settings.archive.colChannel"></th><th data-i18n="chat.group.settings.archive.colMonth"></th><th data-i18n="chat.group.settings.archive.colSize"></th></tr></thead>
<tbody>${files.map(row => `<tr><td>${escapeHtml(row.channelId)}</td><td>${escapeHtml(row.month)}</td><td>${escapeHtml(formatArchiveBytes(row.bytes))}</td></tr>`).join('')}
</tbody></table></div>`
		}
		catch { /* summary miss */ }

	container.replaceChildren()
	if (canManageArchive)
		await mountTemplate(container, 'group/settings/archive_storage_panel', {
			currentState: context.state,
			canManageArchive,
			archiveRowsHtml,
		})
	if (context.settingsCaps?.canImportChannel) {
		await appendTemplate(container, 'group/settings/channel_archive_panel', {})
		const importButton = document.getElementById('group-settings-import-channel-archive')
		const fileInput = document.getElementById('group-settings-import-channel-file')
		importButton?.addEventListener('click', () => fileInput?.click())
		fileInput?.addEventListener('change', async () => {
			const file = fileInput.files?.[0]
			fileInput.value = ''
			if (!file || !context.groupId) return
			try {
				const result = await importChannelArchiveFile(context.groupId, file)
				showToastI18n('success', 'chat.group.settings.page.channelArchive.importOk', {
					count: String(result.messageCount ?? 0),
				})
				window.location.href = `/parts/shells:chat/hub/#group:${encodeURIComponent(context.groupId)}:${encodeURIComponent(result.channelId)}`
			}
			catch (error) {
				handleError('chat.group.settings.page.channelArchive.importFailed')(error)
			}
		})
	}
	document.getElementById('archive-delete-button')?.addEventListener('click', async () => {
		const raw = document.getElementById('archive-delete-before-month')?.value?.trim()
		if (!raw || !/^\d{4}-\d{2}$/.test(raw)) {
			showToastI18n('error', 'chat.group.settings.archive.delete.invalidMonth')
			return
		}
		if (!confirmI18n('chat.group.settings.archive.delete.confirm', { month: raw })) return
		const deleteArchiveButton = document.getElementById('archive-delete-button')
		if (deleteArchiveButton instanceof HTMLButtonElement) deleteArchiveButton.disabled = true
		try {
			const data = await deleteArchiveBefore(context.groupId, raw)
			showToastI18n('success', 'chat.group.settings.archive.delete.ok', {
				files: String(data.deletedFiles ?? 0),
			})
			await renderArchiveStoragePanel(context)
		}
		catch (error) {
			showToastI18n('error', 'chat.group.settings.archive.delete.failed', { error: error.message })
		}
		finally {
			if (deleteArchiveButton instanceof HTMLButtonElement) deleteArchiveButton.disabled = false
		}
	})
}
