import { handleError } from '/scripts/features/errorHandlers.mjs'
import { showToastI18n } from '../../../../../../scripts/features/toast.mjs'
import { getChannelPermissions, putChannelPermissions } from '../endpoints/channelPerms.mjs'
import { syncChannelPermBlock } from '../endpoints/groupChannel.mjs'
import { fetchViewerChannelPermissions } from '../groupViewerPermissions.mjs'
import { mountTemplate } from '../templates.mjs'

import { fillRolePermsIfEmpty, safeRoleColor, sortedRoleIds } from './channelPermsUi.mjs'
import { grantableChannelOverridePermissions } from './constants.mjs'

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

	const grantorPerms = await fetchViewerChannelPermissions(context.state, context.groupId)
	const grantablePerms = grantableChannelOverridePermissions(grantorPerms)

	const rolePanels = sortedRoleIds(context.state.roles).map(roleId => {
		const role = context.state.roles[roleId] || { name: roleId, color: '#888' }
		const override = permissions[roleId]
		const hasOverride = !!(Object.keys(override?.allow || {}).length || Object.keys(override?.deny || {}).length)
		return {
			roleId,
			name: role.name || roleId,
			color: safeRoleColor(role.color),
			hasOverride,
			open: roleId === '@everyone' || role.isDefault || hasOverride,
		}
	})

	await mountTemplate(container, 'group/settings/channel_permissions_panel', {
		channels,
		selectedChannelId: context.selectedChannelPermsId,
		rolePanels,
		permBlockId: context.state.channels?.[context.selectedChannelPermsId]?.permBlockId || null,
	})

	for (const details of container.querySelectorAll('details.settings-role[open]')) {
		const permsEl = details.querySelector('.settings-role-perms')
		if (permsEl instanceof HTMLElement)
			await fillRolePermsIfEmpty(permsEl, details.dataset.rolePanel, permissions, grantablePerms)
	}

	container.addEventListener('toggle', event => {
		const details = event.target
		if (!(details instanceof HTMLDetailsElement) || !details.open) return
		const permsEl = details.querySelector('.settings-role-perms')
		if (!(permsEl instanceof HTMLElement)) return
		void fillRolePermsIfEmpty(permsEl, details.dataset.rolePanel, permissions, grantablePerms)
	}, { signal })

	container.addEventListener('click', async event => {
		const selectCh = event.target.closest('[data-action="select-channel"]')
		if (selectCh) {
			context.selectedChannelPermsId = selectCh.dataset.channelId || null
			await renderChannelPermissionsPanel(context)
			return
		}
		const syncBtn = event.target.closest('[data-action="sync-to-default"]')
		if (syncBtn && context.selectedChannelPermsId) {
			try {
				await syncChannelPermBlock(context.groupId, context.selectedChannelPermsId)
				showToastI18n('success', 'chat.group.settings.page.channelPerms.synced')
				await renderChannelPermissionsPanel(context)
			}
			catch (error) {
				handleError('chat.group.settings.page.channelPerms.updateFailed')(error)
			}
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
		if (!grantablePerms.includes(perm)) return
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
