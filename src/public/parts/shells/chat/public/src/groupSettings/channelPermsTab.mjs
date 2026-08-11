import { handleError } from '/scripts/features/errorHandlers.mjs'
import { i18nElement } from '/scripts/i18n/index.mjs'
import { mountTemplate, renderTemplateAsHtmlString } from '../../../../../../scripts/features/template.mjs'
import { showToastI18n } from '../../../../../../scripts/features/toast.mjs'
import { getChannelPermissions, putChannelPermissions } from '../endpoints/channelPerms.mjs'
import { fetchViewerChannelPermissions } from '../groupViewerPermissions.mjs'

import { grantableChannelOverridePermissions } from './constants.mjs'

const ROLE_COLOR_RE = /^#[0-9a-f]{3}([0-9a-f]{3})?$/i

/**
 * @param {string | undefined} color CSS 颜色
 * @returns {string} 白名单内 hex 或默认灰
 */
function safeRoleColor(color) {
	const value = (color || '').trim()
	return ROLE_COLOR_RE.test(value) ? value : '#888888'
}

/**
 * @param {Record<string, boolean>} allow 允许位图
 * @param {Record<string, boolean>} deny 拒绝位图
 * @param {string} perm 权限键
 * @returns {'neutral' | 'allow' | 'deny'} 三态结果
 */
function channelPermTriState(allow, deny, perm) {
	if (deny?.[perm]) return 'deny'
	if (allow?.[perm]) return 'allow'
	return 'neutral'
}

/**
 * @param {Record<string, object>} roles 角色表
 * @returns {string[]} 排序后的角色 id（@everyone / isDefault 优先，再按 position）
 */
function sortedRoleIds(roles) {
	return Object.entries(roles || {})
		.sort(([idA, roleA], [idB, roleB]) => {
			const defaultA = idA === '@everyone' || roleA?.isDefault ? 0 : 1
			const defaultB = idB === '@everyone' || roleB?.isDefault ? 0 : 1
			if (defaultA !== defaultB) return defaultA - defaultB
			return (roleB?.position || 0) - (roleA?.position || 0) || idA.localeCompare(idB)
		})
		.map(([roleId]) => roleId)
}

/**
 * @param {string} roleId 角色 id
 * @param {Record<string, boolean> | undefined} allow 允许位图
 * @param {Record<string, boolean> | undefined} deny 拒绝位图
 * @param {string[]} grantablePerms 授予者可配置位
 * @returns {Promise<string>} 权限行 HTML
 */
async function permRowsHtml(roleId, allow, deny, grantablePerms) {
	return (await Promise.all(grantablePerms.map(perm =>
		renderTemplateAsHtmlString('group/settings/channel_perm_row', {
			perm,
			roleId,
			state: channelPermTriState(allow, deny, perm),
		})
	))).join('')
}

/**
 * 懒填已打开（或刚打开）的角色权限行。
 * @param {HTMLElement} permsEl `.settings-role-perms`
 * @param {string} roleId 角色 id
 * @param {Record<string, { allow?: object, deny?: object }>} permissions 频道覆写表
 * @param {string[]} grantablePerms 授予者可配置位
 * @returns {Promise<void>}
 */
async function fillRolePermsIfEmpty(permsEl, roleId, permissions, grantablePerms) {
	if (permsEl.childElementCount) return
	const override = permissions[roleId]
	permsEl.innerHTML = await permRowsHtml(roleId, override?.allow, override?.deny, grantablePerms)
	i18nElement(permsEl, { skip_report: true })
}

/** @param {import('./state.mjs').GroupSettingsContext} context @returns {Promise<void>} */
export async function renderChannelPermissionsPanel(context) {
	const container = document.getElementById('channel-perms-container')
	if (!container || !context.groupId || !context.state) return
	if (!context.settingsCaps?.canManageChannelPerms) {
		await mountTemplate(container, 'group/settings/settings_panel_denied', {
			messageKey: 'chat.group.settings.page.channelPerms.denied',
		})
		return
	}

	context.channelPermsController?.abort()
	context.channelPermsController = new AbortController()
	const { signal } = context.channelPermsController

	const channels = Object.entries(context.state.channels || {})
		.filter(([, ch]) => ch?.type === 'text' || ch?.type === 'list')
		.map(([id, ch]) => ({ id, name: ch?.name || id }))
	if (!channels.length) {
		await mountTemplate(container, 'group/settings/channel_permissions_panel', { channels: [], rolePanels: [] })
		return
	}
	if (!context.selectedChannelPermsId || !channels.some(ch => ch.id === context.selectedChannelPermsId))
		context.selectedChannelPermsId = channels[0].id

	let permissions = {}
	try {
		permissions = await getChannelPermissions(context.groupId, context.selectedChannelPermsId)
	}
	catch (error) {
		handleError('chat.group.settings.page.channelPerms.updateFailed')(error)
	}

	const grantorPerms = await fetchViewerChannelPermissions(context.state, context.groupId)
	const grantablePerms = grantableChannelOverridePermissions(grantorPerms)

	const rolePanels = sortedRoleIds(context.state.roles).map(roleId => {
		const role = context.state.roles[roleId] || { name: roleId, color: '#888' }
		const override = permissions[roleId]
		const hasOverride = !!(Object.keys(override?.allow || {}).length || Object.keys(override?.deny || {}).length)
		return {
			roleId,
			name: role.name || roleId,
			color: safeRoleColor(role.color),
			hasOverride,
			open: roleId === '@everyone' || role.isDefault || hasOverride,
		}
	})

	await mountTemplate(container, 'group/settings/channel_permissions_panel', {
		channels,
		selectedChannelId: context.selectedChannelPermsId,
		rolePanels,
	})

	for (const details of container.querySelectorAll('details.settings-role[open]')) {
		const permsEl = details.querySelector('.settings-role-perms')
		if (permsEl instanceof HTMLElement)
			await fillRolePermsIfEmpty(permsEl, details.dataset.rolePanel, permissions, grantablePerms)
	}

	container.addEventListener('toggle', event => {
		const details = event.target
		if (!(details instanceof HTMLDetailsElement) || !details.open) return
		const permsEl = details.querySelector('.settings-role-perms')
		if (!(permsEl instanceof HTMLElement)) return
		void fillRolePermsIfEmpty(permsEl, details.dataset.rolePanel, permissions, grantablePerms)
	}, { signal })

	container.addEventListener('click', async event => {
		const selectCh = event.target.closest('[data-action="select-channel"]')
		if (selectCh) {
			context.selectedChannelPermsId = selectCh.dataset.channelId || null
			await renderChannelPermissionsPanel(context)
			return
		}
		const clearRoleOverrideButton = event.target.closest('[data-action="clear-role-override"]')
		if (clearRoleOverrideButton?.dataset.roleId && context.selectedChannelPermsId) {
			try {
				await putChannelPermissions(context.groupId, context.selectedChannelPermsId, clearRoleOverrideButton.dataset.roleId, {}, {})
				showToastI18n('success', 'chat.group.settings.page.channelPerms.updated')
				await renderChannelPermissionsPanel(context)
			}
			catch (error) {
				handleError('chat.group.settings.page.channelPerms.updateFailed')(error)
			}
			return
		}
		const channelPermStateButton = event.target.closest('[data-action="channel-perm-state"]')
		if (!channelPermStateButton || !context.selectedChannelPermsId) return
		const group = channelPermStateButton.closest('[data-role-id][data-perm]')
		if (!group) return
		const roleId = group.getAttribute('data-role-id')
		const perm = group.getAttribute('data-perm')
		const nextState = channelPermStateButton.getAttribute('data-state')
		if (!roleId || !perm || !nextState) return
		if (!grantablePerms.includes(perm)) return
		try {
			const current = await getChannelPermissions(context.groupId, context.selectedChannelPermsId)
			const allow = { ...current[roleId]?.allow }
			const deny = { ...current[roleId]?.deny }
			delete allow[perm]
			delete deny[perm]
			if (nextState === 'allow') allow[perm] = true
			else if (nextState === 'deny') deny[perm] = true
			await putChannelPermissions(context.groupId, context.selectedChannelPermsId, roleId, allow, deny)
			showToastI18n('success', 'chat.group.settings.page.channelPerms.updated')
			await renderChannelPermissionsPanel(context)
		}
		catch (error) {
			handleError('chat.group.settings.page.channelPerms.updateFailed')(error)
		}
	}, { signal })
}

/** @param {import('./state.mjs').GroupSettingsContext} context @returns {Promise<void>} */
export async function ensureChannelPermissionsPanel(context) {
	if (!context.groupId || context.channelPermsReady) return
	context.channelPermsReady = true
	await renderChannelPermissionsPanel(context)
}
