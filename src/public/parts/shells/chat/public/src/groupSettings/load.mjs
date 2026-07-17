import { activateSection } from '../../settings/nav.mjs'
import { getGroupState } from '../api/groupCore.mjs'
import { initAuditLogPanel } from '../auditLogPanel.mjs'
import { resolveViewerSettingsCapabilities } from '../groupViewerPermissions.mjs'

import { renderArchiveStoragePanel } from './archiveTab.mjs'
import { ensureChannelPermissionsPanel } from './channelPermsTab.mjs'
import { ensureGroupEmojisPanel } from './emojisTab.mjs'
import { renderGroupSettings } from './generalTab.mjs'
import { renderMembers } from './membersTab.mjs'
import { renderPermissionSettings } from './permissionsTab.mjs'
import { resetPanelFlags } from './state.mjs'

/**
 * @param {import('./state.mjs').GroupSettingsContext} context 群设置上下文
 * @param {string} groupId 群 ID
 * @returns {Promise<void>}
 */
export async function loadGroupSettings(context, groupId) {
	context.groupId = groupId
	resetPanelFlags(context)
	const state = await getGroupState(groupId)
	context.state = state
	context.stateJson = state
	context.settingsCaps = await resolveViewerSettingsCapabilities(context.state, groupId)
	await updateSettingsTabsVisibility(context)
	await renderGroupSettings(context)
	await renderArchiveStoragePanel(context)
	await renderPermissionSettings(context)
	await renderMembers(context)
}

/**
 * @param {import('./state.mjs').GroupSettingsContext} context 群设置上下文
 * @returns {Promise<void>}
 */
export async function updateSettingsTabsVisibility(context) {
	if (!context.settingsCaps) return

	const sectionVisibility = {
		general: true,
		members: context.settingsCaps.isMember,
		emojis: context.settingsCaps.isMember,
		permissions: context.settingsCaps.canManageRoles,
		'channel-perms': context.settingsCaps.canManageChannelPerms,
		storage: context.settingsCaps.canManageArchive || context.settingsCaps.canImportChannel,
		audit: context.settingsCaps.canViewAudit,
	}

	for (const [sectionId, visible] of Object.entries(sectionVisibility)) {
		const item = document.querySelector(`.settings-nav-item[data-section="${sectionId}"]`)
		item?.classList.toggle('hidden', !visible)
	}

	const advancedVisible = ['permissions', 'channel-perms', 'storage', 'audit']
		.some(id => sectionVisibility[id])
	document.querySelector('[data-nav-group="advanced"]')?.classList.toggle('hidden', !advancedVisible)

	const active = document.querySelector('.settings-nav-item.settings-nav-item-active')
	if (!active || active.classList.contains('hidden'))
		activateSection('general')
}

/** @param {import('./state.mjs').GroupSettingsContext} context @returns {Promise<void>} */
export async function ensureAuditLogPanel(context) {
	if (!context.groupId || context.auditPanelReady) return
	context.auditPanelReady = true
	await initAuditLogPanel(context.groupId)
}

/**
 *
 */
export { ensureChannelPermissionsPanel, ensureGroupEmojisPanel }
