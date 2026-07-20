/**
 * 【文件】public/src/groupSettings.mjs
 * 【职责】群设置面板入口：初始化、Tab 懒加载与重导出。
 */
import { usingTemplates } from '../../../../scripts/features/template.mjs'
import { initTranslations } from '../../../../scripts/i18n/index.mjs'

import {
	ensureAuditLogPanel as ensureAuditLogPanelImpl,
	ensureChannelPermissionsPanel as ensureChannelPermissionsPanelImpl,
	ensureGroupEmojisPanel as ensureGroupEmojisPanelImpl,
	loadGroupSettings as loadGroupSettingsImpl,
	updateSettingsTabsVisibility as updateSettingsTabsVisibilityImpl,
} from './groupSettings/load.mjs'
import { parseSettingsGroupIdFromHash } from './groupSettings/shared.mjs'
import { createGroupSettingsContext } from './groupSettings/state.mjs'

const settingsContext = createGroupSettingsContext()
/**
 * @param {string} groupId 群 ID
 * @returns {Promise<void>}
 */
settingsContext.reload = groupId => loadGroupSettingsImpl(settingsContext, groupId)

/**
 * 初始化群设置页，从 hash 读取群 ID 并加载数据。
 * @returns {Promise<void>}
 */
export async function initGroupSettings() {
	await initTranslations('chat')
	usingTemplates('/parts/shells:chat/src/templates')
	const groupId = parseSettingsGroupIdFromHash()
	if (groupId) await loadGroupSettingsImpl(settingsContext, groupId)
}

/**
 * @param {string} groupId 群 ID
 * @returns {Promise<void>}
 */
export async function loadGroupSettings(groupId) {
	return loadGroupSettingsImpl(settingsContext, groupId)
}

/** @returns {Promise<void>} */
export async function updateSettingsTabsVisibility() {
	return updateSettingsTabsVisibilityImpl(settingsContext)
}

/** @returns {Promise<void>} */
export async function ensureAuditLogPanel() {
	return ensureAuditLogPanelImpl(settingsContext)
}

/** @returns {Promise<void>} */
export async function ensureChannelPermissionsPanel() {
	return ensureChannelPermissionsPanelImpl(settingsContext)
}

/** @returns {Promise<void>} */
export async function ensureGroupEmojisPanel() {
	return ensureGroupEmojisPanelImpl(settingsContext)
}
