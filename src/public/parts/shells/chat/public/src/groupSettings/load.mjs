import { initAuditLogPanel } from '../auditLogPanel.mjs'
import { getGroupState } from '../api/groupCore.mjs'
import { resolveViewerSettingsCapabilities } from '../groupViewerPermissions.mjs'

import { renderArchiveStoragePanel } from './archiveTab.mjs'
import { ensureChannelPermissionsPanel } from './channelPermsTab.mjs'
import { ensureGroupEmojisPanel } from './emojisTab.mjs'
import { renderGroupSettings } from './generalTab.mjs'
import { renderMembers } from './membersTab.mjs'
import { renderPermissionSettings } from './permissionsTab.mjs'
import { resetPanelFlags } from './state.mjs'

/**
 * @param {import('./state.mjs').GroupSettingsContext} ctx 群设置上下文
 * @param {string} groupId 群 ID
 * @returns {Promise<void>}
 */
export async function loadGroupSettings(ctx, groupId) {
	ctx.groupId = groupId
	resetPanelFlags(ctx)
	const state = await getGroupState(groupId)
	ctx.state = state
	ctx.stateJson = state
	ctx.settingsCaps = await resolveViewerSettingsCapabilities(ctx.state, groupId)
	await updateSettingsTabsVisibility(ctx)
	await renderGroupSettings(ctx)
	await renderArchiveStoragePanel(ctx)
	await renderPermissionSettings(ctx)
	await renderMembers(ctx)
}

/**
 * @param {import('./state.mjs').GroupSettingsContext} ctx 群设置上下文
 * @returns {Promise<void>}
 */
export async function updateSettingsTabsVisibility(ctx) {
	if (!ctx.settingsCaps) return
	const map = {
		permissions: ctx.settingsCaps.canManageRoles,
		'channel-perms': ctx.settingsCaps.canManageChannelPerms,
		members: ctx.settingsCaps.isMember,
		emojis: ctx.settingsCaps.isMember,
		audit: ctx.settingsCaps.canViewAudit,
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

/** @param {import('./state.mjs').GroupSettingsContext} ctx @returns {Promise<void>} */
export async function ensureAuditLogPanel(ctx) {
	if (!ctx.groupId || ctx.auditPanelReady) return
	ctx.auditPanelReady = true
	await initAuditLogPanel(ctx.groupId)
}

/**
 *
 */
export { ensureChannelPermissionsPanel, ensureGroupEmojisPanel }
