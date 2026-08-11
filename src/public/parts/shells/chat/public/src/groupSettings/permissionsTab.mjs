import { handleError } from '/scripts/features/errorHandlers.mjs'
import { mountTemplate, renderTemplateAsHtmlString } from '../../../../../../scripts/features/template.mjs'
import { showToastI18n } from '../../../../../../scripts/features/toast.mjs'
import { confirmI18n, promptI18n } from '../../../../../../scripts/i18n/index.mjs'
import { createRole, deleteRole as deleteRoleRequest, updateRolePermission as updateRolePermissionRequest } from '../endpoints/roles.mjs'
import { fetchViewerChannelPermissions } from '../groupViewerPermissions.mjs'

import { grantableRolePermissions } from './constants.mjs'

/** @param {import('./state.mjs').GroupSettingsContext} context @returns {Promise<void>} */
export async function renderPermissionSettings(context) {
	const container = document.getElementById('permission-settings-container')
	if (!container) return
	if (!context.settingsCaps?.canManageRoles) {
		await mountTemplate(container, 'group/settings/settings_panel_denied', {
			messageKey: 'chat.group.settings.page.rolesDenied',
		})
		return
	}

	context.permissionsController?.abort()
	context.permissionsController = new AbortController()
	const { signal } = context.permissionsController

	const grantorPerms = await fetchViewerChannelPermissions(context.state, context.groupId)
	const grantable = new Set(grantableRolePermissions(grantorPerms))

	const rolesHtml = (await Promise.all(Object.entries(context.state.roles || {}).map(async ([roleId, role]) => {
		const permissions = role.permissions || {}
		const permissionsHtml = (await Promise.all([...grantable].map(perm =>
			renderTemplateAsHtmlString('group/settings/permission_row', {
				checked: permissions[perm] ? 'checked' : '',
				disabled: '',
				perm,
				roleId,
			})
		))).join('')
		const isDefault = roleId === '@everyone' || role.isDefault === true
		const deleteRoleHtml = isDefault
			? ''
			: await renderTemplateAsHtmlString('group/settings/permission_role_action', { roleId })
		return renderTemplateAsHtmlString('group/settings/permission_role', {
			deleteRoleHtml,
			permissionsHtml,
			role: { ...role, isDefault },
		})
	}))).join('')

	await mountTemplate(container, 'group/settings/permissions_panel', {
		rolesHtml,
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
	try {
		await updateRolePermissionRequest(context.groupId, roleId, permission, enabled)
		showToastI18n('success', 'chat.group.settings.page.permissionUpdated')
	}
	catch (error) {
		handleError('chat.group.settings.page.permissionUpdateFailed')(error)
		await context.reload(context.groupId)
	}
}

/**
 * @param {import('./state.mjs').GroupSettingsContext} context 群设置上下文
 * @param {string} roleId 角色 ID
 * @returns {Promise<void>}
 */
async function deleteRole(context, roleId) {
	if (!confirmI18n('chat.group.settings.page.delete.roleConfirm')) return
	try {
		await deleteRoleRequest(context.groupId, roleId)
		showToastI18n('success', 'chat.group.settings.page.delete.roleSuccess')
		await context.reload(context.groupId)
	}
	catch (error) {
		handleError('chat.group.settings.page.delete.roleFailed')(error)
	}
}

/** @param {import('./state.mjs').GroupSettingsContext} context @returns {Promise<void>} */
async function showCreateRoleModal(context) {
	const name = promptI18n('chat.group.settings.page.create.rolePrompt')
	if (!name?.trim()) return

	try {
		await createRole(context.groupId, name.trim())
		showToastI18n('success', 'chat.group.settings.page.create.roleSuccess')
		await context.reload(context.groupId)
	}
	catch (error) {
		handleError('chat.group.settings.page.create.roleFailed')(error)
	}
}
