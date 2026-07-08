import { mountTemplate } from '../../../../../../scripts/features/template.mjs'
import { showToastI18n } from '../../../../../../scripts/features/toast.mjs'
import { confirmI18n, promptI18n } from '../../../../../../scripts/i18n/index.mjs'

import { ALL_PERMISSIONS } from './constants.mjs'

/** @param {import('./state.mjs').GroupSettingsContext} context @returns {Promise<void>} */
export async function renderPermissionSettings(context) {
	const container = document.getElementById('permission-settings-container')
	if (!container) return
	if (!context.settingsCaps?.canManageRoles) {
		await mountTemplate(container, 'group/settings/settings_panel_denied', {
			messageKey: 'chat.group.settingsPage.rolesDenied',
		})
		return
	}

	context.permissionsController?.abort()
	context.permissionsController = new AbortController()
	const { signal } = context.permissionsController

	await mountTemplate(container, 'group/settings/permissions_panel', {
		currentState: context.state,
		allPermissions: ALL_PERMISSIONS,
	})

	document.getElementById('group-settings-create-role-button').addEventListener('click', () => {
		showCreateRoleModal(context)
	}, { signal })
	container.addEventListener('change', async event => {
		const checkbox = event.target.closest('[data-action="update-permission"]')
		if (checkbox) await updateRolePermission(context, checkbox.dataset.roleId, checkbox.dataset.perm, checkbox.checked)
	}, { signal })
	container.addEventListener('click', async (clickEvent) => {
		const deleteRoleButton = clickEvent.target.closest('[data-action="delete-role"]')
		if (deleteRoleButton) await deleteRole(context, deleteRoleButton.dataset.roleId)
	}, { signal })
}

/**
 * @param {import('./state.mjs').GroupSettingsContext} context 群设置上下文
 * @param {string} roleId 角色 ID
 * @param {string} permission 权限键
 * @param {boolean} enabled 是否启用
 * @returns {Promise<void>}
 */
async function updateRolePermission(context, roleId, permission, enabled) {
	const resp = await fetch(`/api/parts/shells:chat/groups/${encodeURIComponent(context.groupId)}/roles/${encodeURIComponent(roleId)}/permissions`, {
		method: 'PUT',
		headers: { 'Content-Type': 'application/json' },
		credentials: 'include',
		body: JSON.stringify({ permission, enabled })
	})
	if (!resp.ok) {
		showToastI18n('error', 'chat.group.settingsPage.permissionUpdateFailed', { error: resp.statusText })
		await context.reload(context.groupId)
		return
	}
	showToastI18n('success', 'chat.group.settingsPage.permissionUpdated')
}

/**
 * @param {import('./state.mjs').GroupSettingsContext} context 群设置上下文
 * @param {string} roleId 角色 ID
 * @returns {Promise<void>}
 */
async function deleteRole(context, roleId) {
	if (!confirmI18n('chat.group.settingsPage.deleteRoleConfirm')) return
	const resp = await fetch(`/api/parts/shells:chat/groups/${encodeURIComponent(context.groupId)}/roles/${encodeURIComponent(roleId)}`, {
		method: 'DELETE',
		credentials: 'include'
	})
	if (!resp.ok) throw new Error(resp.statusText)
	showToastI18n('success', 'chat.group.settingsPage.deleteRoleSuccess')
	await context.reload(context.groupId)
}

/** @param {import('./state.mjs').GroupSettingsContext} context @returns {void} */
function showCreateRoleModal(context) {
	const name = promptI18n('chat.group.settingsPage.createRolePrompt')
	if (!name?.trim()) return

	fetch(`/api/parts/shells:chat/groups/${encodeURIComponent(context.groupId)}/roles`, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		credentials: 'include',
		body: JSON.stringify({ name: name.trim() })
	}).then(r => r.json().then(async data => {
		if (r.ok) {
			showToastI18n('success', 'chat.group.settingsPage.createRoleSuccess')
			await context.reload(context.groupId)
		} else
			showToastI18n('error', 'chat.group.settingsPage.createRoleFailed', { error: data.error || '' })
	})).catch(error => showToastI18n('error', 'chat.group.settingsPage.createRoleFailed', { error: error.message }))
}
