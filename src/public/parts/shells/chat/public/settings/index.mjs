/**
 * 【文件】public/settings/index.mjs
 * 【职责】群设置页入口：主题、侧栏分区导航与表情/频道权限/审计懒加载。
 * 【关联】groupSettings.mjs、nav.mjs。
 */
import { applyTheme } from '../../../../scripts/theme/index.mjs'
import {
	ensureAuditLogPanel,
	ensureChannelPermissionsPanel,
	ensureGroupEmojisPanel,
	initGroupSettings,
} from '/parts/shells:chat/src/groupSettings.mjs'

import { registerSettingsLazyHandlers, wireSettingsNav } from './nav.mjs'

applyTheme()

registerSettingsLazyHandlers({
	emojis: ensureGroupEmojisPanel,
	'channel-perms': ensureChannelPermissionsPanel,
	audit: ensureAuditLogPanel,
})

wireSettingsNav(document.querySelector('.settings-nav'))

await initGroupSettings()
document.body.dataset.settingsLoaded = '1'
