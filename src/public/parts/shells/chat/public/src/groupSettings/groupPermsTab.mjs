import { handleError } from '/scripts/features/errorHandlers.mjs'
import { showToastI18n } from '../../../../../../scripts/features/toast.mjs'
import { getGroupPermissions, putGroupPermissions } from '../endpoints/channelPerms.mjs'
import { fetchViewerChannelPermissions } from '../groupViewerPermissions.mjs'
import { mountTemplate } from '../templates.mjs'

import { fillRolePermsIfEmpty, safeRoleColor, sortedRoleIds } from './channelPermsUi.mjs'
import { grantableGroupOverridePermissions } from './constants.mjs'

/** 群权限写队列：串行化整个面板的覆写写入，避免并发读写覆盖彼此。 */
let groupPermsWriteQueue = Promise.resolve()

/**
 * 渲染群级治理权限面板：按角色列出可配置权限覆写（denied 无权限时显示拒绝模板）。
 * @param {import('./state.mjs').GroupSettingsContext} context 群设置上下文
 * @returns {Promise<void>}
 */
export async function renderGroupPermissionsPanel(context) {
	const container = document.getElementById('group-perms-container')
	if (!container || !context.groupId || !context.state) return
	if (!context.settingsCaps?.canManageRoles) {
		await mountTemplate(container, 'group/settings/settings_panel_denied', {
			messageKey: 'chat.group.settings.page.groupPerms.denied',
		})
		return
	}

	context.groupPermsController?.abort()
	context.groupPermsController = new AbortController()
	const { signal } = context.groupPermsController

	let permissions
	try {
		permissions = await getGroupPermissions(context.groupId)
	}
	catch (error) {
		handleError('chat.group.settings.page.groupPerms.updateFailed')(error)
		return
	}

	const grantorPerms = await fetchViewerChannelPermissions(context.state, context.groupId)
	const grantablePerms = grantableGroupOverridePermissions(grantorPerms)

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

	await mountTemplate(container, 'group/settings/group_permissions_panel', { rolePanels })

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
	}, { signal, capture: true })

	container.addEventListener('click', event => {
		const clearButton = event.target.closest('[data-action="clear-group-override"]')
		if (clearButton?.dataset.roleId) {
			const roleId = clearButton.dataset.roleId
			groupPermsWriteQueue = groupPermsWriteQueue
				.then(async () => {
					await putGroupPermissions(context.groupId, roleId, {}, {})
					showToastI18n('success', 'chat.group.settings.page.groupPerms.updated')
					await renderGroupPermissionsPanel(context)
				})
				.catch(error => {
					handleError('chat.group.settings.page.groupPerms.updateFailed')(error)
				})
			return
		}
		const stateButton = event.target.closest('[data-action="channel-perm-state"]')
		if (!stateButton) return
		const group = stateButton.closest('[data-role-id][data-perm]')
		if (!group) return
		const roleId = group.getAttribute('data-role-id')
		const perm = group.getAttribute('data-perm')
		const nextState = stateButton.getAttribute('data-state')
		if (!roleId || !perm || !nextState) return
		if (!grantablePerms.includes(perm)) return
		groupPermsWriteQueue = groupPermsWriteQueue
			.then(async () => {
				const current = await getGroupPermissions(context.groupId)
				const allow = { ...current[roleId]?.allow }
				const deny = { ...current[roleId]?.deny }
				delete allow[perm]
				delete deny[perm]
				if (nextState === 'allow') allow[perm] = true
				else if (nextState === 'deny') deny[perm] = true
				await putGroupPermissions(context.groupId, roleId, allow, deny)
				showToastI18n('success', 'chat.group.settings.page.groupPerms.updated')
				await renderGroupPermissionsPanel(context)
			})
			.catch(error => {
				handleError('chat.group.settings.page.groupPerms.updateFailed')(error)
			})
	}, { signal })
}

/**
 * 确保群级权限面板已渲染（幂等，已就绪则跳过）。
 * @param {import('./state.mjs').GroupSettingsContext} context 群设置上下文
 * @returns {Promise<void>}
 */
export async function ensureGroupPermissionsPanel(context) {
	if (!context.groupId || context.groupPermsReady) return
	context.groupPermsReady = true
	await renderGroupPermissionsPanel(context)
}
