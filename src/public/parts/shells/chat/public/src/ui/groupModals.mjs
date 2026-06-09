/**
 * 【文件】public/src/ui/groupModals.mjs
 * 【职责】群列表模态、建群对话框与 openGroup 导航到 Hub hash。
 * 【原理】renderGroupList 调 getGroupList；showCreateGroupModal → createGroup；openGroup 设 location。
 * 【数据结构】群摘要 { id, name }、模板 DOM。
 * 【关联】api/groupApi.mjs；Hub 入口与侧栏。
 */
import { openDialogFromTemplate } from '../../../../scripts/dialog.mjs'
import {
	mountTemplate,
	usingTemplates,
} from '../../../../scripts/template.mjs'
import { showToastI18n } from '../../../../scripts/toast.mjs'
import { escapeHtml } from '../../hub/core/domUtils.mjs'
import { createGroup, getGroupList } from '../api/groupApi.mjs'
import { PENDING_INVITE_STORAGE_KEY } from '../deepLinkConsume.mjs'

/** 按需注入群组 UI 样式表（幂等）。 */
function ensureGroupUiCssLink() {
	if (document.getElementById('fount-group-ui-css')) return
	const link = document.createElement('link')
	link.id = 'fount-group-ui-css'
	link.rel = 'stylesheet'
	link.href = '/parts/shells:chat/group-ui.css'
	document.head.appendChild(link)
}

/**
 * 渲染群组列表卡片（空态含建群/入群入口）。
 * @param {HTMLElement} container 挂载目标容器
 * @returns {Promise<void>}
 */
export async function renderGroupList(container) {
	usingTemplates('/parts/shells:chat/src/templates')
	await mountTemplate(container, 'group/list_view', { view: 'loading' })

	try {
		const groups = await getGroupList()
		await mountTemplate(container, 'group/list_view', groups.length
			? { view: 'list', groups, escapeHtml }
			: { view: 'empty' })

		container.addEventListener('click', event => {
			const target = event.target.closest('[data-action]')
			if (!target) return
			switch (target.dataset.action) {
				case 'join': window.joinGroupById(); break
				case 'create': window.showCreateGroupModal(); break
				case 'open': window.openGroup(target.dataset.groupId); break
			}
		})
	}
	catch (error) {
		await mountTemplate(container, 'group/list_view', {
			view: 'error',
			errorMessage: error.message,
			escapeHtml,
		})
	}
}

/**
 * 弹出建群对话框，成功后跳转 Hub 默认频道。
 * @returns {Promise<void>}
 */
export async function showCreateGroupModal() {
	ensureGroupUiCssLink()
	usingTemplates('/parts/shells:chat/src/templates')
	await openDialogFromTemplate('hub/modals/group_create', {}, {
		activateScripts: false,
		/**
		 * @param {HTMLDialogElement} dialog 对话框
		 * @returns {Promise<void>}
		 */
		onReady: async dialog => {
			dialog.querySelector('[data-action="cancel"]')?.addEventListener('click', () => dialog.close())
			dialog.querySelector('#create-group-form')?.addEventListener('submit', async event => {
				event.preventDefault()
				const formData = new FormData(event.target)
				try {
					const { groupId, defaultChannelId } = await createGroup(formData.get('name'), formData.get('description'))
					const settingsResp = await fetch(`/api/parts/shells:chat/groups/${encodeURIComponent(groupId)}/settings`, {
						method: 'PUT',
						headers: { 'Content-Type': 'application/json' },
						credentials: 'include',
						body: JSON.stringify({ joinPolicy: formData.get('joinPolicy') || 'invite-only' }),
					})
					if (!settingsResp.ok) {
						const err = await settingsResp.json().catch(() => ({}))
						throw new Error(err.error || `settings HTTP ${settingsResp.status}`)
					}
					dialog.close()
					const hubUrl = `/parts/shells:chat/hub/#group:${encodeURIComponent(groupId)}:${encodeURIComponent(defaultChannelId || 'default')}`
					window.location.assign(hubUrl)
				}
				catch (error) {
					showToastI18n('error', 'chat.hub.createModal.failed', { error: error.message })
				}
			})
		},
	})
}

/**
 * 浏览器跳转到指定群的 Hub 默认频道。
 * @param {string} groupId 群 ID
 * @returns {void}
 */
export function openGroup(groupId) {
	window.location.href = `/parts/shells:chat/hub/#group:${groupId}:default`
}

/**
 * 弹出入群对话框（群 ID + 邀请码），成功后写入 session 并跳转 Hub。
 * @returns {Promise<void>}
 */
export async function joinGroupById() {
	ensureGroupUiCssLink()
	usingTemplates('/parts/shells:chat/src/templates')
	await openDialogFromTemplate('hub/modals/group_join', {}, {
		activateScripts: false,
		/**
		 * @param {HTMLDialogElement} dialog 对话框
		 * @returns {void}
		 */
		onReady: dialog => {
			dialog.querySelector('[data-action="cancel"]')?.addEventListener('click', () => dialog.close())
			dialog.querySelector('#join-group-form')?.addEventListener('submit', event => {
				event.preventDefault()
				const groupId = dialog.querySelector('#group-join-id-input')?.value.trim()
				const inviteCode = dialog.querySelector('#group-join-invite-input')?.value.trim()
				if (!groupId) return
				if (inviteCode)
					sessionStorage.setItem(PENDING_INVITE_STORAGE_KEY, JSON.stringify({ groupId, inviteCode }))

				dialog.close()
				const hash = groupId.startsWith('group:') ? groupId : `group:${groupId}:default`
				const query = inviteCode ? `?invite=${encodeURIComponent(inviteCode)}` : ''
				window.location.href = `/parts/shells:chat/hub/${query}#${hash}`
			})
		},
	})
}

window.showCreateGroupModal = showCreateGroupModal
window.openGroup = openGroup
window.joinGroupById = joinGroupById
