/**
 * 【文件】public/hub/categoryPermsDialog.mjs
 * 【职责】频道分类权限编辑对话框（分类作为独立对象，权限按角色 allow/deny 覆写）。
 */
import { showToastI18n } from '../../../../scripts/features/toast.mjs'
import { handleError } from '/scripts/features/errorHandlers.mjs'
import { getChannelPermBlock, putChannelPermBlock } from '../src/endpoints/groupChannel.mjs'
import { fillRolePermsIfEmpty, safeRoleColor, sortedRoleIds } from '../src/groupSettings/channelPermsUi.mjs'
import { grantableChannelOverridePermissions } from '../src/groupSettings/constants.mjs'
import { fetchViewerChannelPermissions } from '../src/groupViewerPermissions.mjs'
import { mountTemplate, openDialogFromTemplate } from '../src/templates.mjs'

import { store } from './core/state.mjs'

/**
 * 弹出分类权限编辑对话框。
 * @param {string} groupId 群 ID
 * @param {string} categoryId 分类 ID
 * @param {string} categoryName 分类名
 * @returns {Promise<void>}
 */
export async function showCategoryPermsDialog(groupId, categoryId, categoryName) {
	let permissions = {}
	let permBlockId = null
	try {
		const data = await getChannelPermBlock(groupId, categoryId)
		permissions = data.permissions || {}
		permBlockId = data.permBlockId || null
	}
	catch (error) {
		handleError('chat.hub.category.perm.loadFailed')(error)
		return
	}

	const state = store.context.currentState
	const grantorPerms = await fetchViewerChannelPermissions(state, groupId)
	const grantablePerms = grantableChannelOverridePermissions(grantorPerms)

	/**
	 * 重拉权限并重绘对话框主体（角色面板 + 已打开角色的权限行）。
	 * @param {HTMLElement} body `#category-perm-body` 主体容器
	 * @returns {Promise<void>}
	 */
	const renderRolePanels = async body => {
		const data = await getChannelPermBlock(groupId, categoryId)
		permissions = data.permissions || {}
		permBlockId = data.permBlockId || null
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
	}

	await openDialogFromTemplate('channel_category_perm_dialog', { categoryName, permBlockId }, {
		activateScripts: false,
		/**
		 * @param {HTMLDialogElement} dialog 对话框
		 * @returns {Promise<void>}
		 */
		onReady: async dialog => {
			const body = dialog.querySelector('#category-perm-body')
			if (!body) return
			dialog.querySelector('#category-perm-close')?.addEventListener('click', () => dialog.close())
			dialog.querySelector('#category-perm-sync')?.addEventListener('click', async () => {
				try {
					const { syncChannelPermBlock } = await import('../src/endpoints/groupChannel.mjs')
					permBlockId = await syncChannelPermBlock(groupId, categoryId)
					showToastI18n('success', 'chat.hub.category.perm.synced')
					await renderRolePanels(body)
				}
				catch (error) {
					handleError('chat.hub.category.perm.updateFailed')(error)
				}
			})

			await renderRolePanels(body)

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
						await putChannelPermBlock(groupId, categoryId, clearBtn.dataset.roleId, {}, {})
						showToastI18n('success', 'chat.hub.category.perm.updated')
						await renderRolePanels(body)
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
					const allow = { ...permissions[roleId]?.allow }
					const deny = { ...permissions[roleId]?.deny }
					delete allow[perm]
					delete deny[perm]
					if (nextState === 'allow') allow[perm] = true
					else if (nextState === 'deny') deny[perm] = true
					await putChannelPermBlock(groupId, categoryId, roleId, allow, deny)
					showToastI18n('success', 'chat.hub.category.perm.updated')
					await renderRolePanels(body)
				}
				catch (error) {
					handleError('chat.hub.category.perm.updateFailed')(error)
				}
			})
		},
	})
}
