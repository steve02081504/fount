import { handleError } from '/scripts/features/errorHandlers.mjs'
import { mountTemplate } from '../../../../../../scripts/features/template.mjs'
import { showToastI18n } from '../../../../../../scripts/features/toast.mjs'
import { getChannelPermissions, putChannelPermissions } from '../endpoints/channelPerms.mjs'

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
 * @param {{ allow?: Record<string, boolean>, deny?: Record<string, boolean> } | undefined} override 覆盖项
 * @returns {boolean} 是否存在任一显式 allow/deny
 */
function roleHasOverride(override) {
	const allow = override?.allow || {}
	const deny = override?.deny || {}
	return Object.keys(allow).length > 0 || Object.keys(deny).length > 0
}

/**
 * @param {Record<string, object>} roles 角色表
 * @returns {string[]} 排序后的角色 id（@everyone / isDefault 优先，再按 position）
 */
function sortedRoleIds(roles) {
	return Object.entries(roles || {})
		.sort(([idA, roleA], [idB, roleB]) => {
			const defaultA = idA === '@everyone' || roleA?.isDefault ? 0 : 1
			const defaultB = idB === '@everyone' || roleB?.isDefault ? 0 : 1
			if (defaultA !== defaultB) return defaultA - defaultB
			return (roleB?.position || 0) - (roleA?.position || 0) || idA.localeCompare(idB)
		})
		.map(([roleId]) => roleId)
}

/** @param {import('./state.mjs').GroupSettingsContext} context @returns {Promise<void>} */
export async function renderChannelPermissionsPanel(context) {
	const container = document.getElementById('channel-perms-container')
	if (!container || !context.groupId || !context.state) return
	if (!context.settingsCaps?.canManageChannelPerms) {
		await mountTemplate(container, 'group/settings/settings_panel_denied', {
			messageKey: 'chat.group.settings.page.channelPerms.denied',
		})
		return
	}

	context.channelPermsController?.abort()
	context.channelPermsController = new AbortController()
	const { signal } = context.channelPermsController

	const channels = Object.entries(context.state.channels || {})
		.filter(([, ch]) => ch?.type === 'text' || ch?.type === 'list')
		.map(([id, ch]) => ({ id, name: ch?.name || id }))
	if (!channels.length) {
		await mountTemplate(container, 'group/settings/channel_permissions_panel', { channels: [], rolePanels: [] })
		return
	}
	if (!context.selectedChannelPermsId || !channels.some(ch => ch.id === context.selectedChannelPermsId))
		context.selectedChannelPermsId = channels[0].id

	let permissions = {}
	try {
		permissions = await getChannelPermissions(context.groupId, context.selectedChannelPermsId)
	}
	catch (error) {
		handleError('chat.group.settings.page.channelPerms.updateFailed')(error)
	}

	const rolePanels = sortedRoleIds(context.state.roles).map(roleId => {
		const role = context.state.roles[roleId] || { name: roleId, color: '#888' }
		const override = permissions[roleId]
		const allow = override?.allow || {}
		const deny = override?.deny || {}
		const hasOverride = roleHasOverride(override)
		return {
			roleId,
			name: role.name || roleId,
			color: role.color || '#888',
			hasOverride,
			open: roleId === '@everyone' || role.isDefault || hasOverride,
			permRows: ALL_PERMISSIONS.map(perm => ({
				perm,
				state: channelPermTriState(allow, deny, perm),
			})),
		}
	})

	await mountTemplate(container, 'group/settings/channel_permissions_panel', {
		channels,
		selectedChannelId: context.selectedChannelPermsId,
		rolePanels,
	})

	container.addEventListener('click', async event => {
		const selectCh = event.target.closest('[data-action="select-channel"]')
		if (selectCh) {
			context.selectedChannelPermsId = selectCh.dataset.channelId || null
			await renderChannelPermissionsPanel(context)
			return
		}
		const clearRoleOverrideButton = event.target.closest('[data-action="clear-role-override"]')
		if (clearRoleOverrideButton?.dataset.roleId && context.selectedChannelPermsId) {
			try {
				await putChannelPermissions(context.groupId, context.selectedChannelPermsId, clearRoleOverrideButton.dataset.roleId, {}, {})
				showToastI18n('success', 'chat.group.settings.page.channelPerms.updated')
				await renderChannelPermissionsPanel(context)
			}
			catch (error) {
				handleError('chat.group.settings.page.channelPerms.updateFailed')(error)
			}
			return
		}
		const channelPermStateButton = event.target.closest('[data-action="channel-perm-state"]')
		if (!channelPermStateButton || !context.selectedChannelPermsId) return
		const group = channelPermStateButton.closest('[data-role-id][data-perm]')
		if (!group) return
		const roleId = group.getAttribute('data-role-id')
		const perm = group.getAttribute('data-perm')
		const nextState = channelPermStateButton.getAttribute('data-state')
		if (!roleId || !perm || !nextState) return
		try {
			const current = await getChannelPermissions(context.groupId, context.selectedChannelPermsId)
			const allow = { ...current[roleId]?.allow }
			const deny = { ...current[roleId]?.deny }
			delete allow[perm]
			delete deny[perm]
			if (nextState === 'allow') allow[perm] = true
			else if (nextState === 'deny') deny[perm] = true
			await putChannelPermissions(context.groupId, context.selectedChannelPermsId, roleId, allow, deny)
			showToastI18n('success', 'chat.group.settings.page.channelPerms.updated')
			await renderChannelPermissionsPanel(context)
		}
		catch (error) {
			handleError('chat.group.settings.page.channelPerms.updateFailed')(error)
		}
	}, { signal })
}

/** @param {import('./state.mjs').GroupSettingsContext} context @returns {Promise<void>} */
export async function ensureChannelPermissionsPanel(context) {
	if (!context.groupId || context.channelPermsReady) return
	context.channelPermsReady = true
	await renderChannelPermissionsPanel(context)
}
