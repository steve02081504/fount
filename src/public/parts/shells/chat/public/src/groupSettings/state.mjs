import { disposeAuditLogPanel } from '../auditLogPanel.mjs'

/**
 * @typedef {object} GroupSettingsContext
 * @property {string | null} groupId
 * @property {object | null} state
 * @property {object | null} stateJson
 * @property {import('../groupViewerPermissions.mjs').ViewerSettingsCapabilities | null} settingsCaps
 * @property {AbortController | null} permissionsController
 * @property {AbortController | null} membersController
 * @property {string} lastInviteClipboardText
 * @property {boolean} auditPanelReady
 * @property {boolean} channelPermsReady
 * @property {boolean} emojisPanelReady
 * @property {AbortController | null} channelPermsController
 * @property {string | null} selectedChannelPermsId
 * @property {(groupId: string) => Promise<void>} reload
 */

/** @returns {GroupSettingsContext} 群设置页可变上下文（由入口模块持有单例）。 */
export function createGroupSettingsContext() {
	return {
		groupId: null,
		state: null,
		stateJson: null,
		settingsCaps: null,
		permissionsController: null,
		membersController: null,
		lastInviteClipboardText: '',
		auditPanelReady: false,
		channelPermsReady: false,
		emojisPanelReady: false,
		channelPermsController: null,
		selectedChannelPermsId: null,
		/** @type {(groupId: string) => Promise<void>} */
		reload: async () => { },
	}
}

/**
 * 切换群或重载前重置懒加载面板标记。
 * @param {GroupSettingsContext} context 群设置上下文
 * @returns {void}
 */
export function resetPanelFlags(context) {
	context.auditPanelReady = false
	context.channelPermsReady = false
	context.emojisPanelReady = false
	disposeAuditLogPanel()
}
