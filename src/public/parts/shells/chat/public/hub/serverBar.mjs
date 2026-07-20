/**
 * 【文件】public/hub/serverBar.mjs
 * 【职责】左侧服务器栏：渲染用户群组列表、文件夹分组，并从 API 加载/缓存 `store.sidebar.groups`。
 * 【原理】`renderServerBar` 填充 `#server-list`；支持拖拽排序与群组入口点击（委托给 `sidebar.selectGroup`）。
 * 【数据结构】store 及模块内 Map/Set 字段；见 core/state 与各函数 JSDoc。
 * 【关联】../../../../scripts/template、../src/api/groupBookmarks、groupCore、core/domUtils、core/state、friendBindings、groupContextMenu、sidebar
 */
import { renderTemplate } from '../../../../scripts/features/template.mjs'
import { aliasForGroup } from '../shared/aliases.mjs'
import { isGroupMutedInSidebar, loadNotificationPreferences } from '../shared/notificationPreferences.mjs'
import { getChatBookmarks, saveChatBookmarks } from '../src/api/groupBookmarks.mjs'
import { getGroupList } from '../src/api/groupCore.mjs'
import { escapeHtml } from '/scripts/lib/escapeHtml.mjs'

import { avatarColor, avatarInitial, groupDisplayName } from './core/domUtils.mjs'
import { store } from './core/state.mjs'
import { showFolderContextMenu } from './folderContextMenu.mjs'
import { getSidebarGroups } from './friendBindings.mjs'
import { showGroupContextMenu } from './groupContextMenu.mjs'
import {
	clearGroupSelection,
	handleGroupItemModifierClick,
	isGroupSelected,
	primeContextMenuSelection,
	syncGroupSelectionStyles,
} from './groupSelection.mjs'
import { attachServerBarDnd } from './serverBarDnd.mjs'
import { selectGroup } from './sidebar/index.mjs'
import { formatUnreadBadgeHtml } from './unread.mjs'

/**
 * 持久化当前文件夹布局到后端。
 * @returns {Promise<void>} 无
 */
export async function persistGroupFolders() {
	await fetch('/api/parts/shells:chat/group-folders', {
		method: 'PUT',
		credentials: 'include',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ folders: store.sidebar.groupFoldersState.folders }),
	}).catch(() => {})
}

/**
 * 计算侧栏群图标顺序（与 `renderServerBar` DOM 顺序一致，不含好友绑定群）。
 * @returns {string[]} 群 ID 列表
 */
export function computeOrderedSidebarGroupIds() {
	const sidebarGroups = getSidebarGroups()
	if (!sidebarGroups.length) return []

	const byId = new Map(sidebarGroups.map(g => [g.groupId, g]))
	const used = new Set()
	/** @type {string[]} */
	const order = []
	const folders = store.sidebar.groupFoldersState.folders || []

	if (folders.length) {
		for (const folder of folders) {
			if (folder.collapsed) continue
			for (const groupId of folder.groupIds || []) {
				if (!byId.has(groupId) || used.has(groupId)) continue
				used.add(groupId)
				order.push(groupId)
			}
		}
		for (const group of sidebarGroups) 
			if (!used.has(group.groupId))
				order.push(group.groupId)
		
	}
	else
		for (const group of sidebarGroups)
			order.push(group.groupId)

	return order
}

/**
 * 生成文件夹瓦片内的 2×2 迷你群图标。
 * @param {{ groupIds?: string[] }} folder 文件夹
 * @param {Map<string, { name: string }>} byId 群 ID → 群摘要
 * @returns {{ html: string, modifier: string }} 迷你图标 HTML 与单图标修饰类
 */
function folderMiniIconsHtml(folder, byId) {
	const groups = (folder.groupIds || [])
		.map(id => byId.get(id))
		.filter(Boolean)
		.slice(0, 4)
	if (!groups.length)
		return { html: '<span class="folder-mini-icon folder-mini-empty"></span>', modifier: ' folder-mini--single' }
	const html = groups.map(group =>
		`<span class="folder-mini-icon" style="background:${avatarColor(group.groupId)};">${escapeHtml(avatarInitial(aliasForGroup(group.groupId) || group.name))}</span>`,
	).join('')
	return { html, modifier: groups.length === 1 ? ' folder-mini--single' : '' }
}

/**
 * 渲染并挂载单个群组服务器图标。
 * @param {HTMLElement} parent 服务器列表或文件夹容器
 * @param {{ groupId: string, name: string, isLeaving?: boolean }} group 群组摘要
 * @param {object} [notifyPrefs] 通知偏好
 * @returns {Promise<void>} 无
 */
async function appendHubServerItem(parent, group, notifyPrefs = {}) {
	const active = group.groupId === store.context.currentGroupId
	const mutedClass = isGroupMutedInSidebar(notifyPrefs, group.groupId, group) ? ' is-muted' : ''
	const displayName = await groupDisplayName(group.groupId, group.name)
	const el = await renderTemplate('hub/server/item', {
		activeClass: active ? 'active' : '',
		selectedClass: isGroupSelected(group.groupId) ? ' is-multi-selected' : '',
		leavingClass: group.isLeaving ? ' is-leaving' : '',
		mutedClass,
		groupId: escapeHtml(group.groupId),
		activeStyle: active ? '' : avatarColor(group.groupId),
		avatarLabel: escapeHtml(avatarInitial(displayName)),
		groupName: escapeHtml(displayName),
		unreadBadgeHtml: formatUnreadBadgeHtml(group.unreadCount),
	})
	parent.appendChild(el)
}

/** 渲染左侧服务器/群组列表。 @returns {Promise<void>} */
export async function renderServerBar() {
	store.sidebar.sidebarGroupOrder = computeOrderedSidebarGroupIds()

	const list = document.getElementById('server-list')
	list.replaceChildren()
	const sidebarGroups = getSidebarGroups()
	if (!sidebarGroups.length) {
		list.appendChild(await renderTemplate('hub/server/bar_empty', {}))
		return
	}

	list.appendChild(await renderTemplate('hub/server/bar_header', {}))

	const byId = new Map(sidebarGroups.map(g => [g.groupId, g]))
	const used = new Set()
	const folders = store.sidebar.groupFoldersState.folders || []
	const notifyPrefs = await loadNotificationPreferences().catch(() => ({}))

	if (folders.length) {
		for (const [folderIndex, folder] of folders.entries()) {
			const collapsed = !!folder.collapsed
			const mini = folderMiniIconsHtml(folder, byId)
			const folderElement = await renderTemplate('hub/server/folder', {
				folderIndex,
				openClass: collapsed ? '' : ' is-open',
				ariaExpanded: collapsed ? 'false' : 'true',
				miniIconsHtml: mini.html,
				miniModifier: mini.modifier,
				folderName: escapeHtml(folder.name),
				folderNameI18nAttr: folder.nameIsDefault ? ' data-i18n="chat.hub.folderDefault"' : '',
			})
			list.appendChild(folderElement)
			if (!collapsed) {
				const itemsHost = list.querySelector(`.folder-wrap[data-folder-idx="${folderIndex}"] .folder-items`)
				for (const groupId of folder.groupIds) {
					const group = byId.get(groupId)
					if (!group) continue
					used.add(groupId)
					await appendHubServerItem(itemsHost, group, notifyPrefs)
				}
			}
			else
				for (const groupId of folder.groupIds)
					if (byId.has(groupId)) used.add(groupId)
		}
		const ungrouped = sidebarGroups.filter(g => !used.has(g.groupId))
		for (const group of ungrouped)
			await appendHubServerItem(list, group, notifyPrefs)
	}
	else
		for (const group of sidebarGroups)
			await appendHubServerItem(list, group, notifyPrefs)


	list.querySelectorAll('.server-item[data-group-id]').forEach(el => {
		el.addEventListener('click', (event) => {
			const groupId = String(el.dataset.groupId || '').trim()
			if (!groupId) return
			if (event.shiftKey || event.ctrlKey || event.metaKey) {
				event.preventDefault()
				handleGroupItemModifierClick(groupId, {
					shift: event.shiftKey,
					ctrl: event.ctrlKey || event.metaKey,
				})
				return
			}
			clearGroupSelection()
			void selectGroup(groupId)
		})
		el.addEventListener('contextmenu', (event) => {
			const groupId = String(el.dataset.groupId || '').trim()
			if (!groupId) return
			primeContextMenuSelection(groupId)
			void showGroupContextMenu(event, groupId)
		})
	})
	syncGroupSelectionStyles()
	list.querySelectorAll('.folder-tile[data-folder-idx]').forEach(head => {
		head.addEventListener('click', (event) => {
			event.stopPropagation()
			const folderIndex = Number(head.getAttribute('data-folder-idx'))
			if (!Number.isFinite(folderIndex) || folderIndex < 0 || folderIndex >= store.sidebar.groupFoldersState.folders.length) return
			store.sidebar.groupFoldersState.folders[folderIndex].collapsed = !store.sidebar.groupFoldersState.folders[folderIndex].collapsed
			void persistGroupFolders()
			void renderServerBar()
		})
		head.addEventListener('contextmenu', (event) => {
			const folderIndex = Number(head.getAttribute('data-folder-idx'))
			if (!Number.isFinite(folderIndex) || folderIndex < 0 || folderIndex >= store.sidebar.groupFoldersState.folders.length) return
			showFolderContextMenu(event, folderIndex)
		})
	})
	attachServerBarDnd(list)
}

/** 拉取群组列表与文件夹布局并刷新服务器栏。 @returns {Promise<void>} */
export async function loadGroups() {
	const groupListPromise = getGroupList()
	const foldersResponse = await fetch('/api/parts/shells:chat/group-folders', { credentials: 'include' })
	const groupList = await groupListPromise
	store.sidebar.groups = groupList.sort(
		(left, right) => new Date(right.lastMessageTime || 0) - new Date(left.lastMessageTime || 0),
	)
	const knownGroupIds = new Set(groupList.map(g => String(g.groupId || '').trim().toLowerCase()).filter(Boolean))
	if (knownGroupIds.size) {
		const bookmarks = await getChatBookmarks().catch(() => [])
		const liveBookmarks = bookmarks.filter(
			b => b?.href || (b?.groupId && knownGroupIds.has(String(b.groupId).trim().toLowerCase())),
		)
		if (liveBookmarks.length !== bookmarks.length) await saveChatBookmarks(liveBookmarks)
	}
	if (foldersResponse.ok) {
		const payload = await foldersResponse.json()
		const rawFolders = Array.isArray(payload.folders) ? payload.folders : []
		store.sidebar.groupFoldersState = {
			folders: rawFolders.map((folder, folderIndex) => ({
				id: String(folder.id || '').trim() || `folder-${folderIndex}`,
				name: String(folder.name || '').trim(),
				nameIsDefault: !String(folder.name || '').trim(),
				groupIds: Array.isArray(folder.groupIds) ? folder.groupIds.map(id => String(id).trim()).filter(Boolean) : [],
				collapsed: !!folder.collapsed,
			})),
		}
	}
	else store.sidebar.groupFoldersState = { folders: [] }
	await renderServerBar()
}
