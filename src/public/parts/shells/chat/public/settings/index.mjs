/**
 * 【文件】public/settings/index.mjs
 * 【职责】群设置页前端入口：主题、多 Tab 切换与审计/频道权限/自定义表情子面板懒加载。
 * 【原理】initGroupSettings 拉群配置；tab 点击切换 `.settings-tab-panel`；按 data-tab 触发 ensureAuditLogPanel 等异步挂载。
 * 【数据结构】无模块级状态；DOM 通过 data-tab 与 `#tab-*` 面板 id 关联。
 * 【关联】groupSettings.mjs、auditLogPanel、channelPermissions、groupEmojis；Hub 设置路由。
 */
import { applyTheme } from '../../../../scripts/theme.mjs'
import {
	ensureAuditLogPanel,
	ensureChannelPermissionsPanel,
	ensureGroupEmojisPanel,
	initGroupSettings,
} from '/parts/shells:chat/src/groupSettings.mjs'

applyTheme()

document.querySelectorAll('.tabs .tab').forEach(tab => {
	tab.addEventListener('click', event => {
		const target = event.target.closest('.tab')
		if (!target?.dataset.tab) return
		document.querySelectorAll('.tabs .tab').forEach(t => t.classList.remove('tab-active'))
		target.classList.add('tab-active')
		document.querySelectorAll('.settings-tab-panel').forEach(content => content.classList.add('hidden'))
		document.getElementById(`tab-${target.dataset.tab}`)?.classList.remove('hidden')
		if (target.dataset.tab === 'audit') void ensureAuditLogPanel()
		if (target.dataset.tab === 'channel-perms') void ensureChannelPermissionsPanel()
		if (target.dataset.tab === 'emojis') void ensureGroupEmojisPanel()
	})
})

await initGroupSettings()
document.body.dataset.settingsLoaded = '1'
