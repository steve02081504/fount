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
	const map = {
		permissions: context.settingsCaps.canManageRoles,
		'channel-perms': context.settingsCaps.canManageChannelPerms,
		members: context.settingsCaps.isMember,
		emojis: context.settingsCaps.isMember,
		audit: context.settingsCaps.canViewAudit,
	}
	for (const [tabId, visible] of Object.entries(map)) {
		const tab = document.querySelector(`.tabs .tab[data-tab="${tabId}"]`)
		if (tab) tab.classList.toggle('hidden', !visible)
	}
	const active = document.querySelector('.tabs .tab.tab-active')
	if (active?.classList.contains('hidden')) {
		const general = document.querySelector('.tabs .tab[data-tab="general"]')
		general?.click()
	}
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
