import { promptText } from '../../../../../../scripts/features/promptDialog.mjs'
import { mountTemplate } from '../../../../../../scripts/features/template.mjs'
import { showToastI18n } from '../../../../../../scripts/features/toast.mjs'
import { confirmI18n, geti18n } from '../../../../../../scripts/i18n/index.mjs'
import { escapeHtml } from '/scripts/lib/escapeHtml.mjs'
import { packEmojiContentUrl, resolveActivePackId } from '../../providers/emoji.mjs'
import { viewerCanManageMessages } from '../groupViewerPermissions.mjs'

/**
 * @param {object[]} packs 群 pack 列表
 * @param {string | null} selected 当前选中 packId
 * @param {string} groupId 群 ID
 * @returns {string} select options HTML
 */
function buildPackOptionsHtml(packs, selected, groupId) {
	const current = String(selected || '').trim() || groupId
	const ids = packs.map(p => String(p.packId || '').trim()).filter(Boolean)
	if (!ids.includes(groupId)) ids.unshift(groupId)
	const unique = [...new Set(ids)]
	return unique.map(packId => {
		const pack = packs.find(p => p.packId === packId)
		const label = packId === groupId
			? geti18n('chat.group.settings.page.emojis.packGroupOption', { packId }) || packId
			: packId
		const count = pack?.itemCount ?? pack?.items?.length
		const countSuffix = Number.isFinite(count) ? ` · ${count}` : ''
		return `<option value="${escapeHtml(packId)}"${packId === current ? ' selected' : ''}>${escapeHtml(label + countSuffix)}</option>`
	}).join('')
}

/**
 * @param {import('./state.mjs').GroupSettingsContext} context 群设置上下文
 * @returns {Promise<void>}
 */
async function renderGroupEmojis(context) {
	const container = document.getElementById('group-emojis-container')
	if (!container || !context.groupId) return
	const channelId = context.state?.groupSettings?.defaultChannelId || 'default'
	const packsPayload = await fetch(`/api/parts/shells:chat/groups/${encodeURIComponent(context.groupId)}/emoji-packs`, { credentials: 'include' })
		.then(r => r.ok ? r.json() : {})
		.then(d => Array.isArray(d.packs) ? d.packs : [])
		.catch(() => [])

	const packIds = packsPayload.map(p => p.packId).filter(Boolean)
	if (!packIds.includes(context.groupId)) packIds.unshift(context.groupId)
	const activePackId = resolveActivePackId(context, packIds, context.groupId)
	context.activeEmojiPackId = activePackId

	const [canManage, packDetail] = await Promise.all([
		viewerCanManageMessages(context.state, context.groupId, channelId).catch(() => false),
		fetch(`/api/parts/shells:chat/groups/${encodeURIComponent(context.groupId)}/emoji-packs/${encodeURIComponent(activePackId)}`, { credentials: 'include' })
			.then(r => r.ok ? r.json() : {})
			.then(d => d.pack || null)
			.catch(() => null),
	])

	const entries = Array.isArray(packDetail?.items) ? packDetail.items : []
	const currentDefault = context.state?.groupSettings?.defaultEmojiPackId || null
	const entriesHtml = entries.map(entry => {
		const src = packEmojiContentUrl(activePackId, entry.emojiId)
		const del = canManage
			? `<button type="button" class="btn btn-ghost btn-xs text-error" data-delete-emoji="${escapeHtml(entry.emojiId)}" data-i18n-aria-label="chat.group.settings.page.emojis.delete">×</button>`
			: ''
		const label = entry.name || entry.emojiId
		return `<div class="flex flex-col items-center gap-1 p-2 rounded-lg bg-base-300">
<img src="${src}" alt="${escapeHtml(label)}" class="w-12 h-12 object-contain" loading="lazy" svg-inliner-ignore />
<span class="text-xs truncate max-w-full">${escapeHtml(label)}</span>
${del}
</div>`
	}).join('')

	const packOptions = buildPackOptionsHtml(packsPayload, activePackId, context.groupId)
	await mountTemplate(container, 'group/settings/emojis_panel', {
		canManage,
		entriesHtml,
		entriesEmpty: !entries.length,
		activePackOptionsHtml: packOptions,
		defaultPackOptionsHtml: buildPackOptionsHtml(packsPayload, currentDefault, context.groupId),
	})

	const activeSelect = document.getElementById('group-active-emoji-pack')
	if (activeSelect) {
		activeSelect.setAttribute('user-content', '')
		activeSelect.addEventListener('change', async () => {
			context.activeEmojiPackId = String(activeSelect.value || '').trim() || context.groupId
			context.emojisPanelReady = false
			await ensureGroupEmojisPanel(context)
		})
	}

	const defaultSelect = document.getElementById('group-default-emoji-pack')
	if (defaultSelect) {
		defaultSelect.setAttribute('user-content', '')
		if (canManage)
			defaultSelect.addEventListener('change', async () => {
				const previousValue = String(context.state?.groupSettings?.defaultEmojiPackId || '').trim() || context.groupId
				const packId = String(defaultSelect.value || '').trim()
				try {
					const resp = await fetch(`/api/parts/shells:chat/groups/${encodeURIComponent(context.groupId)}/settings`, {
						method: 'PUT',
						credentials: 'include',
						headers: { 'Content-Type': 'application/json' },
						body: JSON.stringify({ defaultEmojiPackId: packId || null }),
					})
					if (!resp.ok) {
						showToastI18n('error', 'chat.group.settings.page.defaultEmojiPack.failed')
						defaultSelect.value = previousValue
						return
					}
					showToastI18n('success', 'chat.group.settings.page.defaultEmojiPack.ok')
					if (context.state?.groupSettings)
						context.state.groupSettings.defaultEmojiPackId = packId || null
				}
				catch {
					showToastI18n('error', 'chat.group.settings.page.defaultEmojiPack.failed')
					defaultSelect.value = previousValue
				}
			})
	}

	const createBtn = document.getElementById('group-emoji-pack-create')
	if (createBtn && canManage)
		createBtn.addEventListener('click', async () => {
			const suggested = `pack_${Date.now().toString(36)}`
			const packId = await promptText(
				'chat.group.settings.page.emojis.create.packPrompt',
				suggested,
			)
			if (packId == null) return
			const id = String(packId || '').trim() || suggested
			const resp = await fetch(`/api/parts/shells:chat/groups/${encodeURIComponent(context.groupId)}/emoji-packs`, {
				method: 'POST',
				credentials: 'include',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ packId: id }),
			})
			const data = await resp.json().catch(() => ({}))
			if (!resp.ok) {
				showToastI18n('error', 'chat.group.settings.page.emojis.create.packFailed', { error: data.error || resp.statusText })
				return
			}
			showToastI18n('success', 'chat.group.settings.page.emojis.create.packOk')
			context.activeEmojiPackId = data.pack?.packId || id
			context.emojisPanelReady = false
			await ensureGroupEmojisPanel(context)
		})

	const upload = document.getElementById('group-emoji-upload')
	if (upload)
		upload.addEventListener('change', async () => {
			const file = upload.files?.[0]
			if (!file) return
			const form = new FormData()
			form.append('emoji', file)
			form.append('name', file.name.replace(/\.[^.]+$/, ''))
			const packId = context.activeEmojiPackId || context.groupId
			const up = await fetch(
				`/api/parts/shells:chat/groups/${encodeURIComponent(context.groupId)}/emoji-packs/${encodeURIComponent(packId)}/emojis`,
				{ method: 'POST', credentials: 'include', body: form },
			)
			const upData = await up.json()
			if (!up.ok) {
				showToastI18n('error', 'chat.group.settings.page.emojis.uploadFailed', { error: upData.error || up.statusText })
				return
			}
			showToastI18n('success', 'chat.group.settings.page.emojis.uploadOk')
			context.emojisPanelReady = false
			await ensureGroupEmojisPanel(context)
		})

	container.querySelectorAll('[data-delete-emoji]').forEach(deleteEmojiButton => {
		deleteEmojiButton.addEventListener('click', async () => {
			const emojiId = deleteEmojiButton.getAttribute('data-delete-emoji')
			if (!emojiId || !confirmI18n('chat.group.settings.page.emojis.deleteConfirm')) return
			const packId = context.activeEmojiPackId || context.groupId
			const del = await fetch(
				`/api/parts/shells:chat/groups/${encodeURIComponent(context.groupId)}/emoji-packs/${encodeURIComponent(packId)}/emojis/${encodeURIComponent(emojiId)}`,
				{ method: 'DELETE', credentials: 'include' },
			)
			const delData = await del.json()
			if (!del.ok) {
				showToastI18n('error', 'chat.group.settings.page.emojis.deleteFailed', { error: delData.error || '' })
				return
			}
			showToastI18n('success', 'chat.group.settings.page.emojis.deleteOk')
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
