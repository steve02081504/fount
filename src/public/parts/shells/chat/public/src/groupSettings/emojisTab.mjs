import { mountTemplate } from '../../../../../../scripts/features/template.mjs'
import { showToastI18n } from '../../../../../../scripts/features/toast.mjs'
import { confirmI18n } from '../../../../../../scripts/i18n/index.mjs'
import { escapeHtml } from '/scripts/lib/escapeHtml.mjs'
import { groupEmojiDataApiPath } from '../groupEmojiApi.mjs'
import { viewerCanManageMessages } from '../groupViewerPermissions.mjs'

/** @param {import('./state.mjs').GroupSettingsContext} context @returns {Promise<void>} */
async function renderGroupEmojis(context) {
	const container = document.getElementById('group-emojis-container')
	if (!container || !context.groupId) return
	const channelId = context.state?.groupSettings?.defaultChannelId || 'default'
	const [canManage, entries] = await Promise.all([
		viewerCanManageMessages(context.state, context.groupId, channelId).catch(() => false),
		fetch(`/api/parts/shells:chat/groups/${encodeURIComponent(context.groupId)}/emojis`, { credentials: 'include' })
			.then(r => r.ok ? r.json() : {})
			.then(d => Array.isArray(d.entries) ? d.entries : [])
			.catch(() => []),
	])
	const entriesHtml = entries.map(entry => {
		const src = groupEmojiDataApiPath(context.groupId, entry.emojiId)
		const del = canManage
			? `<button type="button" class="btn btn-ghost btn-xs text-error" data-delete-emoji="${escapeHtml(entry.emojiId)}">×</button>`
			: ''
		return `<div class="flex flex-col items-center gap-1 p-2 rounded-lg bg-base-300">
<img src="${src}" alt="${escapeHtml(entry.name || entry.emojiId)}" class="w-12 h-12 object-contain" loading="lazy" />
<span class="text-xs truncate max-w-full">${escapeHtml(entry.name || entry.emojiId)}</span>
${del}
</div>`
	}).join('')
	await mountTemplate(container, 'group/settings/emojis_panel', {
		canManage,
		entriesHtml,
		entriesEmpty: !entries.length,
	})
	const upload = document.getElementById('group-emoji-upload')
	if (upload)
		upload.addEventListener('change', async () => {
			const file = upload.files?.[0]
			if (!file) return
			const form = new FormData()
			form.append('emoji', file)
			form.append('name', file.name.replace(/\.[^.]+$/, ''))
			const up = await fetch(`/api/parts/shells:chat/groups/${encodeURIComponent(context.groupId)}/emojis`, {
				method: 'POST',
				credentials: 'include',
				body: form,
			})
			const upData = await up.json()
			if (!up.ok) {
				showToastI18n('error', 'chat.group.settingsPage.emojisUploadFailed', { error: upData.error || up.statusText })
				return
			}
			showToastI18n('success', 'chat.group.settingsPage.emojisUploadOk')
			context.emojisPanelReady = false
			await ensureGroupEmojisPanel(context)
		})

	container.querySelectorAll('[data-delete-emoji]').forEach(deleteEmojiButton => {
		deleteEmojiButton.addEventListener('click', async () => {
			const emojiId = deleteEmojiButton.getAttribute('data-delete-emoji')
			if (!emojiId || !confirmI18n('chat.group.settingsPage.emojisDeleteConfirm')) return
			const del = await fetch(
				`/api/parts/shells:chat/groups/${encodeURIComponent(context.groupId)}/emojis/${encodeURIComponent(emojiId)}`,
				{ method: 'DELETE', credentials: 'include' },
			)
			const delData = await del.json()
			if (!del.ok) {
				showToastI18n('error', 'chat.group.settingsPage.emojisDeleteFailed', { error: delData.error || '' })
				return
			}
			showToastI18n('success', 'chat.group.settingsPage.emojisDeleteOk')
			context.emojisPanelReady = false
			await ensureGroupEmojisPanel(context)
		})
	})
}

/** @param {import('./state.mjs').GroupSettingsContext} context @returns {Promise<void>} */
export async function ensureGroupEmojisPanel(context) {
	if (!context.groupId || context.emojisPanelReady) return
	context.emojisPanelReady = true
	await renderGroupEmojis(context)
}
