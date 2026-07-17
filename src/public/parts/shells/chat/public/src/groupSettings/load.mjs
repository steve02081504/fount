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
	const topLevelMap = {
		members: context.settingsCaps.isMember,
		emojis: context.settingsCaps.isMember,
	}
	for (const [tabId, visible] of Object.entries(topLevelMap)) {
		const tab = document.querySelector(`.settings-tabs > .tab[data-tab="${tabId}"]`)
		if (tab) tab.classList.toggle('hidden', !visible)
	}

	const advancedSections = {
		permissions: context.settingsCaps.canManageRoles,
		'channel-perms': context.settingsCaps.canManageChannelPerms,
		storage: context.settingsCaps.canManageArchive || context.settingsCaps.canImportChannel,
		audit: context.settingsCaps.canViewAudit,
	}
	for (const [sectionId, visible] of Object.entries(advancedSections))
		document.querySelector(`[data-advanced-section="${sectionId}"]`)?.classList.toggle('hidden', !visible)

	const firstAdvancedSection = document.querySelector('[data-advanced-section]:not(.hidden)')
	const advancedTab = document.querySelector('.settings-tabs > .tab[data-tab="advanced"]')
	advancedTab?.classList.toggle('hidden', !firstAdvancedSection)
	const currentAdvancedSection = document.querySelector('[data-advanced-section].btn-active:not(.hidden)')
	if (!currentAdvancedSection && firstAdvancedSection instanceof HTMLElement)
		firstAdvancedSection.click()

	const active = document.querySelector('.settings-tabs > .tab.tab-active')
	if (active?.classList.contains('hidden')) {
		const general = document.querySelector('.settings-tabs > .tab[data-tab="general"]')
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
