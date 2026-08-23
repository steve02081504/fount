/**
 * 【文件】public/hub/categoryPermsDialog.mjs
 * 【职责】频道分类权限编辑对话框（分类作为独立对象，权限按角色 allow/deny 覆写）。
 */
import { showToastI18n } from '../../../../scripts/features/toast.mjs'
import { i18nElement } from '/scripts/i18n/index.mjs'
import { handleError } from '/scripts/features/errorHandlers.mjs'
import { getCategoryPermissions, putCategoryPermissions } from '../src/endpoints/groupCategory.mjs'
import { grantableChannelOverridePermissions } from '../src/groupSettings/constants.mjs'
import { fetchViewerChannelPermissions } from '../src/groupViewerPermissions.mjs'
import { mountTemplate, openDialogFromTemplate, renderTemplateAsHtmlString } from '../src/templates.mjs'

import { store } from './core/state.mjs'

const ROLE_COLOR_RE = /^#[\da-f]{3}([\da-f]{3})?$/i

/**
 * @param {string|undefined} color CSS 颜色
 * @returns {string} 白名单内 hex 或默认灰
 */
function safeRoleColor(color) {
	const value = (color || '').trim()
	return ROLE_COLOR_RE.test(value) ? value : '#888888'
}

/**
 * @param {Record<string, boolean>|undefined} allow 允许位图
 * @param {Record<string, boolean>|undefined} deny 拒绝位图
 * @param {string} perm 权限键
 * @returns {'neutral'|'allow'|'deny'} 三态结果
 */
function permTriState(allow, deny, perm) {
	if (deny?.[perm]) return 'deny'
	if (allow?.[perm]) return 'allow'
	return 'neutral'
}

/**
 * @param {Record<string, object>} roles 角色表
 * @returns {string[]} 排序后的角色 id
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
 * @param {Record<string, boolean>|undefined} allow 允许位图
 * @param {Record<string, boolean>|undefined} deny 拒绝位图
 * @param {string[]} grantablePerms 可配置位
 * @returns {Promise<string>} 权限行 HTML
 */
async function permRowsHtml(roleId, allow, deny, grantablePerms) {
	return (await Promise.all(grantablePerms.map(perm =>
		renderTemplateAsHtmlString('group/settings/channel_perm_row', {
			perm,
			roleId,
			state: permTriState(allow, deny, perm),
		})
	))).join('')
}

/**
 * @param {HTMLElement} permsEl 权限行容器
 * @param {string} roleId 角色 id
 * @param {Record<string, { allow?: object, deny?: object }>} permissions 分类覆写表
 * @param {string[]} grantablePerms 可配置位
 * @returns {Promise<void>}
 */
async function fillRolePermsIfEmpty(permsEl, roleId, permissions, grantablePerms) {
	if (permsEl.childElementCount) return
	const override = permissions[roleId]
	permsEl.innerHTML = await permRowsHtml(roleId, override?.allow, override?.deny, grantablePerms)
	i18nElement(permsEl, { skip_report: true })
}

/**
 * 弹出分类权限编辑对话框。
 * @param {string} groupId 群 ID
 * @param {string} categoryId 分类 ID
 * @param {string} categoryName 分类名
 * @returns {Promise<void>}
 */
export async function showCategoryPermsDialog(groupId, categoryId, categoryName) {
	let permissions = {}
	try {
		permissions = await getCategoryPermissions(groupId, categoryId)
	}
	catch (error) {
		handleError('chat.hub.category.perm.loadFailed')(error)
	}

	const state = store.context.currentState
	const grantorPerms = await fetchViewerChannelPermissions(state, groupId)
	const grantablePerms = grantableChannelOverridePermissions(grantorPerms)

	await openDialogFromTemplate('channel_category_perm_dialog', { categoryName }, {
		activateScripts: false,
		/**
		 * @param {HTMLDialogElement} dialog 对话框
		 * @returns {void}
		 */
		onReady: async dialog => {
			dialog.querySelector('#category-perm-close')?.addEventListener('click', () => dialog.close())

			const body = dialog.querySelector('#category-perm-body')
			if (!body) return
			const rolePanels = sortedRoleIds(state?.roles).map(roleId => {
				const role = state.roles[roleId] || { name: roleId, color: '#888' }
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
			await mountTemplate(body, 'hub/category_perm_roles', { rolePanels })

			for (const details of body.querySelectorAll('details.settings-role[open]')) {
				const permsEl = details.querySelector('.settings-role-perms')
				if (permsEl instanceof HTMLElement)
					await fillRolePermsIfEmpty(permsEl, details.dataset.rolePanel, permissions, grantablePerms)
			}

			body.addEventListener('toggle', event => {
				const details = event.target
				if (!(details instanceof HTMLDetailsElement) || !details.open) return
				const permsEl = details.querySelector('.settings-role-perms')
				if (!(permsEl instanceof HTMLElement)) return
				void fillRolePermsIfEmpty(permsEl, details.dataset.rolePanel, permissions, grantablePerms)
			})

			body.addEventListener('click', async event => {
				const clearBtn = event.target.closest('[data-action="clear-role-override"]')
				if (clearBtn?.dataset.roleId) {
					try {
						await putCategoryPermissions(groupId, categoryId, clearBtn.dataset.roleId, {}, {})
						showToastI18n('success', 'chat.hub.category.perm.updated')
						await showCategoryPermsDialog(groupId, categoryId, categoryName)
						dialog.close()
					}
					catch (error) {
						handleError('chat.hub.category.perm.updateFailed')(error)
					}
					return
				}
				const stateBtn = event.target.closest('[data-action="channel-perm-state"]')
				if (!stateBtn) return
				const group = stateBtn.closest('[data-role-id][data-perm]')
				if (!group) return
				const roleId = group.getAttribute('data-role-id')
				const perm = group.getAttribute('data-perm')
				const nextState = stateBtn.getAttribute('data-state')
				if (!roleId || !perm || !nextState || !grantablePerms.includes(perm)) return
				try {
					const current = await getCategoryPermissions(groupId, categoryId)
					const allow = { ...current[roleId]?.allow }
					const deny = { ...current[roleId]?.deny }
					delete allow[perm]
					delete deny[perm]
					if (nextState === 'allow') allow[perm] = true
					else if (nextState === 'deny') deny[perm] = true
					await putCategoryPermissions(groupId, categoryId, roleId, allow, deny)
					showToastI18n('success', 'chat.hub.category.perm.updated')
					permissions[roleId] = { allow, deny }
					const permsEl = group.closest('.settings-role-perms')
					if (permsEl) permsEl.innerHTML = await permRowsHtml(roleId, allow, deny, grantablePerms)
				}
				catch (error) {
					handleError('chat.hub.category.perm.updateFailed')(error)
				}
			})
		},
	})
}
