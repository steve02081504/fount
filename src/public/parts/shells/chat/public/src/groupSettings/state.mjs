import { disposeAuditLogPanel } from '../auditLogPanel.mjs'

/**
 * 群设置页可变上下文（入口模块持有单例）。
 * @typedef {object} GroupSettingsContext
 * @property {string | null} groupId 当前群 ID
 * @property {object | null} state 群 state 对象
 * @property {object | null} stateJson 原始 state JSON
 * @property {import('../groupViewerPermissions.mjs').ViewerSettingsCapabilities | null} settingsCaps 设置能力
 * @property {AbortController | null} permissionsController 权限面板请求控制器
 * @property {AbortController | null} membersController 成员面板请求控制器
 * @property {string} lastInviteClipboardText 上次复制的邀请文案
 * @property {boolean} auditPanelReady 审计日志面板是否已挂载
 * @property {boolean} channelPermsReady 频道权限面板是否已挂载
 * @property {boolean} emojisPanelReady 表情面板是否已挂载
 * @property {AbortController | null} channelPermsController 频道权限请求控制器
 * @property {string | null} selectedChannelPermsId 当前编辑的频道 ID
 * @property {(groupId: string) => Promise<void>} reload 重载群 state 回调
 */

/**
 * 创建群设置页可变上下文单例结构。
 * @returns {GroupSettingsContext} 群设置页可变上下文（由入口模块持有单例）。
 */
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
