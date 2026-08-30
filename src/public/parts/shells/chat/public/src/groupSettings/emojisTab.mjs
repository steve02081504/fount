import { handleError } from '/scripts/features/errorHandlers.mjs'
import { promptText } from '../../../../../../scripts/features/promptDialog.mjs'
import { showToastI18n } from '../../../../../../scripts/features/toast.mjs'
import { confirmI18n, geti18n } from '../../../../../../scripts/i18n/index.mjs'
import { escapeHtml } from '/scripts/lib/escapeHtml.mjs'
import { packEmojiContentUrl, resolveActivePackId } from '../../providers/emoji.mjs'
import {
	createGroupEmojiPack,
	deleteGroupEmoji,
	getGroupEmojiPack,
	listGroupEmojiPacks,
	uploadGroupEmoji,
} from '../endpoints/emojiPacks.mjs'
import { putGroupSettings } from '../endpoints/groupCore.mjs'
import { fetchViewerChannelPermissions } from '../groupViewerPermissions.mjs'
import { mountTemplate } from '../templates.mjs'

/**
 * 取 pack 的可读显示名（localized 优先，缺省回落 packId）。
 * @param {object} pack pack 摘要
 * @param {string} fallback 缺省名
 * @returns {string} 显示名
 */
function packDisplayName(pack, fallback) {
	const loc = pack?.localized
	if (loc && typeof loc === 'object')
		for (const slice of Object.values(loc)) {
			const name = String(slice?.name || '').trim()
			if (name) return name
		}
	return fallback
}

/**
 * @param {object[]} packs 群 pack 列表
 * @param {string | null} selected 当前选中 packId
 * @param {string} groupId 群 ID
 * @returns {string} select options HTML
 */
function buildPackOptionsHtml(packs, selected, groupId) {
	const current = (selected || '').trim() || groupId
	const ids = packs.map(p => p.packId || '').filter(Boolean)
	if (!ids.includes(groupId)) ids.unshift(groupId)
	const unique = [...new Set(ids)]
	const baseNames = new Map(unique.map(packId => {
		const pack = packs.find(p => p.packId === packId)
		const name = packId === groupId
			? geti18n('chat.group.settings.page.emojis.packGroupOption')
			: packDisplayName(pack, packId)
		return [packId, name || packId]
	}))
	const nameCounts = new Map()
	for (const name of baseNames.values()) nameCounts.set(name, (nameCounts.get(name) || 0) + 1)
	return unique.map(packId => {
		const baseName = baseNames.get(packId)
		const label = nameCounts.get(baseName) > 1 && baseName !== packId
			? `${baseName} (${packId})`
			: baseName
		const pack = packs.find(p => p.packId === packId)
		const count = pack?.itemCount ?? pack?.items?.length
		const text = Number.isFinite(count)
			? geti18n('chat.group.settings.page.emojis.packCount', { name: label, count })
			: label
		return `<option value="${escapeHtml(packId)}"${packId === current ? ' selected' : ''}>${escapeHtml(text)}</option>`
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
	const packsPayload = await listGroupEmojiPacks(context.groupId).catch(error => {
		handleError('chat.hub.group.emojisLoadFailed')(error)
		return []
	})

	const packIds = packsPayload.map(p => p.packId).filter(Boolean)
	if (!packIds.includes(context.groupId)) packIds.unshift(context.groupId)
	const activePackId = resolveActivePackId(context, packIds, context.groupId)
	context.activeEmojiPackId = activePackId

	const [permissions, packDetail] = await Promise.all([
		fetchViewerChannelPermissions(context.state, context.groupId, channelId),
		getGroupEmojiPack(context.groupId, activePackId).catch(error => {
			handleError('chat.hub.group.emojisLoadFailed')(error)
			return null
		}),
	])
	const canManage = permissions.MANAGE_MESSAGES === true

	const entries = Array.isArray(packDetail?.items) ? packDetail.items : []
	const currentDefault = context.state?.groupSettings?.defaultEmojiPackId || null
	const entriesHtml = entries.map(entry => {
		const src = packEmojiContentUrl(activePackId, entry.emojiId)
		const del = canManage
			? `<button type="button" class="btn btn-ghost btn-xs text-error" data-delete-emoji="${escapeHtml(entry.emojiId)}" data-i18n-aria-label="chat.group.settings.page.emojis.delete">×</button>`
			: ''
		const label = entry.name || entry.emojiId
		return `<div class="flex flex-col items-center gap-1 p-2 rounded-box bg-base-300">
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

	const activePackIdEl = document.getElementById('group-active-pack-id')
	if (activePackIdEl) {
		activePackIdEl.setAttribute('user-content', '')
		activePackIdEl.textContent = activePackId
	}
	const copyBtn = document.getElementById('group-active-pack-copy')
	if (copyBtn)
		copyBtn.addEventListener('click', async () => {
			try {
				await navigator.clipboard.writeText(activePackId)
				showToastI18n('success', 'chat.group.settings.page.emojis.idCopied')
			}
			catch {
				showToastI18n('error', 'chat.group.settings.page.invite.copyFailed')
			}
		})

	const activeSelect = document.getElementById('group-active-emoji-pack')
	if (activeSelect) {
		activeSelect.setAttribute('user-content', '')
		activeSelect.addEventListener('change', async () => {
			context.activeEmojiPackId = (activeSelect.value || '') || context.groupId
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
				const packId = defaultSelect.value || ''
				try {
					await putGroupSettings(context.groupId, { defaultEmojiPackId: packId || null })
					showToastI18n('success', 'chat.group.settings.page.defaultEmojiPack.ok')
					if (context.state?.groupSettings)
						context.state.groupSettings.defaultEmojiPackId = packId || null
				}
				catch (error) {
					handleError('chat.group.settings.page.defaultEmojiPack.failed')(error)
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
			const id = packId.trim() || suggested
			try {
				const data = await createGroupEmojiPack(context.groupId, id)
				showToastI18n('success', 'chat.group.settings.page.emojis.create.packOk')
				context.activeEmojiPackId = data.pack?.packId || id
				context.emojisPanelReady = false
				await ensureGroupEmojisPanel(context)
			}
			catch (error) {
				handleError('chat.group.settings.page.emojis.create.packFailed')(error)
			}
		})

	const upload = document.getElementById('group-emoji-upload')
	if (upload)
		upload.addEventListener('change', async () => {
			const file = upload.files?.[0]
			if (!file) return
			const packId = context.activeEmojiPackId || context.groupId
			try {
				await uploadGroupEmoji(context.groupId, packId, file, file.name.replace(/\.[^.]+$/, ''))
				showToastI18n('success', 'chat.group.settings.page.emojis.uploadOk')
				context.emojisPanelReady = false
				await ensureGroupEmojisPanel(context)
			}
			catch (error) {
				handleError('chat.group.settings.page.emojis.uploadFailed')(error)
			}
		})

	container.querySelectorAll('[data-delete-emoji]').forEach(deleteEmojiButton => {
		deleteEmojiButton.addEventListener('click', async () => {
			const emojiId = deleteEmojiButton.getAttribute('data-delete-emoji')
			if (!emojiId || !confirmI18n('chat.group.settings.page.emojis.deleteConfirm')) return
			const packId = context.activeEmojiPackId || context.groupId
			try {
				await deleteGroupEmoji(context.groupId, packId, emojiId)
				showToastI18n('success', 'chat.group.settings.page.emojis.deleteOk')
				context.emojisPanelReady = false
				await ensureGroupEmojisPanel(context)
			}
			catch (error) {
				handleError('chat.group.settings.page.emojis.deleteFailed')(error)
			}
		})
	})
}

/** @param {import('./state.mjs').GroupSettingsContext} context @returns {Promise<void>} */
export async function ensureGroupEmojisPanel(context) {
	if (!context.groupId || context.emojisPanelReady) return
	context.emojisPanelReady = true
	await renderGroupEmojis(context)
}
