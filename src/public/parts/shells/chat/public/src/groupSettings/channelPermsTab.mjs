import { mountTemplate } from '../../../../../../scripts/features/template.mjs'
import { showToastI18n } from '../../../../../../scripts/features/toast.mjs'

import { ALL_PERMISSIONS } from './constants.mjs'

/**
 * @param {Record<string, boolean>} allow 允许位图
 * @param {Record<string, boolean>} deny 拒绝位图
 * @param {string} perm 权限键
 * @returns {'neutral' | 'allow' | 'deny'} 三态结果
 */
function channelPermTriState(allow, deny, perm) {
	if (deny?.[perm]) return 'deny'
	if (allow?.[perm]) return 'allow'
	return 'neutral'
}

/**
 * @param {import('./state.mjs').GroupSettingsContext} ctx 群设置上下文
 * @param {string} channelId 频道 ID
 * @returns {Promise<Record<string, { allow?: Record<string, boolean>, deny?: Record<string, boolean> }>>} 各角色频道权限
 */
async function fetchChannelPermissions(ctx, channelId) {
	const resp = await fetch(
		`/api/parts/shells:chat/groups/${encodeURIComponent(ctx.groupId)}/channels/${encodeURIComponent(channelId)}/permissions`,
		{ credentials: 'include' },
	)
	const data = await resp.json()
	if (!resp.ok) throw new Error(data.error || resp.statusText)
	return data.permissions || {}
}

/**
 * @param {import('./state.mjs').GroupSettingsContext} ctx 群设置上下文
 * @param {string} channelId 频道 ID
 * @param {string} roleId 角色 ID
 * @param {Record<string, boolean>} allow 允许位图
 * @param {Record<string, boolean>} deny 拒绝位图
 * @returns {Promise<void>}
 */
async function putChannelPermissions(ctx, channelId, roleId, allow, deny) {
	const resp = await fetch(
		`/api/parts/shells:chat/groups/${encodeURIComponent(ctx.groupId)}/channels/${encodeURIComponent(channelId)}/permissions`,
		{
			method: 'PUT',
			credentials: 'include',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ roleId, allow, deny }),
		},
	)
	const data = await resp.json()
	if (!resp.ok) throw new Error(data.error || resp.statusText)
}

/** @param {import('./state.mjs').GroupSettingsContext} ctx @returns {Promise<void>} */
export async function renderChannelPermissionsPanel(ctx) {
	const container = document.getElementById('channel-perms-container')
	if (!container || !ctx.groupId || !ctx.state) return
	if (!ctx.settingsCaps?.canManageChannelPerms) {
		await mountTemplate(container, 'group/settings/settings_panel_denied', {
			messageKey: 'chat.group.settingsPage.channelPermsDenied',
		})
		return
	}

	ctx.channelPermsController?.abort()
	ctx.channelPermsController = new AbortController()
	const { signal } = ctx.channelPermsController

	const channels = Object.entries(ctx.state.channels || {})
		.filter(([, ch]) => ch?.type === 'text' || ch?.type === 'list')
		.map(([id, ch]) => ({ id, name: ch?.name || id }))
	if (!channels.length) {
		await mountTemplate(container, 'group/settings/channel_permissions_panel', { channels: [] })
		return
	}
	if (!ctx.selectedChannelPermsId || !channels.some(ch => ch.id === ctx.selectedChannelPermsId))
		ctx.selectedChannelPermsId = channels[0].id

	let permissions = {}
	try {
		permissions = await fetchChannelPermissions(ctx, ctx.selectedChannelPermsId)
	}
	catch (error) {
		showToastI18n('error', 'chat.group.settingsPage.channelPermsUpdateFailed', { error: error.message })
	}

	const overrideRoleIds = Object.keys(permissions)
	const rolePanels = overrideRoleIds.map(roleId => {
		const role = ctx.state.roles[roleId] || { name: roleId, color: '#888' }
		const allow = permissions[roleId]?.allow || {}
		const deny = permissions[roleId]?.deny || {}
		return {
			roleId,
			name: role.name || roleId,
			color: role.color || '#888',
			permRows: ALL_PERMISSIONS.map(perm => ({
				perm,
				state: channelPermTriState(allow, deny, perm),
			})),
		}
	})
	const addableRoles = Object.entries(ctx.state.roles || {})
		.filter(([roleId]) => !overrideRoleIds.includes(roleId))
		.map(([id, role]) => ({ id, name: role?.name || id }))

	await mountTemplate(container, 'group/settings/channel_permissions_panel', {
		channels,
		selectedChannelId: ctx.selectedChannelPermsId,
		rolePanels,
		addableRoles,
	})

	container.addEventListener('click', async event => {
		const selectCh = event.target.closest('[data-action="select-channel"]')
		if (selectCh) {
			ctx.selectedChannelPermsId = selectCh.dataset.channelId || null
			await renderChannelPermissionsPanel(ctx)
			return
		}
		const addRoleOverrideButton = event.target.closest('[data-action="add-role-override"]')
		if (addRoleOverrideButton) {
			const sel = document.getElementById('channel-perms-add-role')
			const roleId = sel instanceof HTMLSelectElement ? sel.value : ''
			if (!roleId || !ctx.selectedChannelPermsId) return
			try {
				await putChannelPermissions(ctx, ctx.selectedChannelPermsId, roleId, {}, {})
				showToastI18n('success', 'chat.group.settingsPage.channelPermsUpdated')
				await renderChannelPermissionsPanel(ctx)
			}
			catch (error) {
				showToastI18n('error', 'chat.group.settingsPage.channelPermsUpdateFailed', { error: error.message })
			}
			return
		}
		const removeRoleOverrideButton = event.target.closest('[data-action="remove-role-override"]')
		if (removeRoleOverrideButton?.dataset.roleId && ctx.selectedChannelPermsId) {
			try {
				await putChannelPermissions(ctx, ctx.selectedChannelPermsId, removeRoleOverrideButton.dataset.roleId, {}, {})
				showToastI18n('success', 'chat.group.settingsPage.channelPermsUpdated')
				await renderChannelPermissionsPanel(ctx)
			}
			catch (error) {
				showToastI18n('error', 'chat.group.settingsPage.channelPermsUpdateFailed', { error: error.message })
			}
			return
		}
		const channelPermStateButton = event.target.closest('[data-action="channel-perm-state"]')
		if (!channelPermStateButton || !ctx.selectedChannelPermsId) return
		const group = channelPermStateButton.closest('[data-role-id][data-perm]')
		if (!group) return
		const roleId = group.getAttribute('data-role-id')
		const perm = group.getAttribute('data-perm')
		const nextState = channelPermStateButton.getAttribute('data-state')
		if (!roleId || !perm || !nextState) return
		const current = await fetchChannelPermissions(ctx, ctx.selectedChannelPermsId)
		const allow = { ...current[roleId]?.allow || {} }
		const deny = { ...current[roleId]?.deny || {} }
		delete allow[perm]
		delete deny[perm]
		if (nextState === 'allow') allow[perm] = true
		else if (nextState === 'deny') deny[perm] = true
		try {
			await putChannelPermissions(ctx, ctx.selectedChannelPermsId, roleId, allow, deny)
			showToastI18n('success', 'chat.group.settingsPage.channelPermsUpdated')
			await renderChannelPermissionsPanel(ctx)
		}
		catch (error) {
			showToastI18n('error', 'chat.group.settingsPage.channelPermsUpdateFailed', { error: error.message })
		}
	}, { signal })
}

/** @param {import('./state.mjs').GroupSettingsContext} ctx @returns {Promise<void>} */
export async function ensureChannelPermissionsPanel(ctx) {
	if (!ctx.groupId || ctx.channelPermsReady) return
	ctx.channelPermsReady = true
	await renderChannelPermissionsPanel(ctx)
}
