/**
 * 【文件】public/hub/sidebar/channels.mjs
 * 【职责】侧栏频道树渲染（分类折叠、未读徽章、创建按钮）。
 */
import { mountTemplate, renderTemplate } from '../../src/templates.mjs'
import { escapeHtml } from '/scripts/lib/escapeHtml.mjs'
import { showCategoryContextMenu, showChannelListCreateMenu } from '../categoryContextMenu.mjs'
import { showChannelContextMenu } from '../channelContextMenu.mjs'
import { buildChannelTree, channelTypeIconHtml } from '../channels.mjs'
import { store } from '../core/state.mjs'
import { isThreadChannel } from '../threadDrawer.mjs'
import { formatUnreadBadgeHtml, getChannelUnreadCount } from '../unread.mjs'

import { showCreateChannelModal } from './createChannel.mjs'
import { getChannelListContainer, isPrivateChatActive } from './privateShell.mjs'
import { selectChannel } from './selectChannel.mjs'

/** @type {WeakSet<HTMLElement>} 已挂容器空白区右键的容器 */
const listMenuBoundContainers = new WeakSet()

/**
 * 渲染频道树列表（沿 links；`type:category` 频道渲染为可折叠分类头，无分类频道显示在根目录）。
 * @param {object} state 群组状态
 * @returns {Promise<void>}
 */
export async function renderChannelList(state) {
	const container = getChannelListContainer()
	if (!container || !state) return
	const channels = state.channels || {}
	const channelIds = Object.keys(channels)
	if (!channelIds.length) {
		await mountTemplate(container, 'hub/nav/side_muted', { i18nKey: 'chat.hub.no.channels' })
		return
	}
	const { ordered } = buildChannelTree(channels)
	const visible = ordered.filter(({ channel }) => !isThreadChannel(channel))
	container.replaceChildren()
	if (!isPrivateChatActive() && !listMenuBoundContainers.has(container)) {
		listMenuBoundContainers.add(container)
		container.addEventListener('contextmenu', (event) => {
			showChannelListCreateMenu(event)
		})
	}

	/** @type {Map<string, string[]>} 父频道 id → 有序子频道 id */
	const byParent = new Map()
	for (const { channel } of visible)
		if (Array.isArray(channel.links))
			byParent.set(channel.id, channel.links.filter(childId => channels[childId]))
	const childIds = new Set([...byParent.values()].flat())
	/** 根节点：未被任何频道链接指向的频道 */
	const roots = visible.filter(({ id }) => !childIds.has(id))

	/**
	 * 递归渲染某频道及其链接子树。
	 * @param {HTMLElement} parent 追加到的父元素
	 * @param {string} channelId 频道 id
	 * @param {number} depth 缩进深度
	 * @returns {Promise<void>}
	 */
	const renderNode = async (parent, channelId, depth) => {
		const channel = channels[channelId]
		if (!channel || isThreadChannel(channel)) return
		const children = (byParent.get(channelId) || []).filter(childId => !isThreadChannel(channels[childId]))
		if (channel.type === 'category') {
			const catKey = channelId
			const isCollapsed = store.sidebar.collapsedCategories.has(catKey)
			const header = await renderTemplate('hub/nav/channel_category', {
				collapsedClass: isCollapsed ? 'collapsed' : '',
				category: escapeHtml(catKey),
				categoryName: escapeHtml(channel.name || channelId),
				categoryI18nAttr: '',
			})
			parent.appendChild(header)
			if (!isCollapsed) {
				const listHost = header.querySelector('.category-channels')
				if (listHost) for (const childId of children) await renderNode(listHost, childId, depth + 1)
			}
			return
		}
		const active = channelId === store.context.currentChannelId ? 'active' : ''
		const nested = depth > 0 ? ' channel-nested' : ''
		const groupId = store.context.currentGroupId
		const item = await renderTemplate('hub/nav/channel_item', {
			activeClass: active ? 'active' : '',
			nestedClass: nested,
			channelId,
			paddingLeft: String(12 + depth * 14),
			iconHtml: await channelTypeIconHtml(channel.type || 'text'),
			channelName: escapeHtml(channel.name || channelId),
			unreadBadgeHtml: groupId
				? formatUnreadBadgeHtml(getChannelUnreadCount(groupId, channelId))
				: '',
		})
		parent.appendChild(item)
		if (children.length) {
			const listHost = document.createElement('ul')
			listHost.className = 'menu menu-sm w-full px-1 gap-0.5 category-channels'
			parent.appendChild(listHost)
			for (const childId of children) await renderNode(listHost, childId, depth + 1)
		}
	}

	const categoryRoots = roots.filter(({ channel }) => channel.type === 'category')
	const channelRoots = roots.filter(({ channel }) => channel.type !== 'category')
	for (const root of categoryRoots)
		await renderNode(container, root.id, 0)
	const rootList = document.createElement('ul')
	rootList.className = 'menu menu-sm w-full px-1 gap-0.5 category-channels'
	container.appendChild(rootList)
	for (const root of channelRoots)
		await renderNode(rootList, root.id, 0)

	container.querySelectorAll('.category').forEach(el => {
		el.addEventListener('click', () => {
			const category = el.dataset.cat
			if (store.sidebar.collapsedCategories.has(category)) store.sidebar.collapsedCategories.delete(category)
			else store.sidebar.collapsedCategories.add(category)
			void import('./index.mjs').then(({ renderHubChannelSidebar }) =>
				renderHubChannelSidebar(store.context.currentState),
			)
		})
		el.addEventListener('contextmenu', (event) => {
			const categoryId = el.dataset.cat
			if (categoryId) {
				const name = channels[categoryId]?.name || categoryId
				showCategoryContextMenu(event, categoryId, name)
			}
		})
	})
	container.querySelectorAll('.channel-item').forEach(el => {
		el.addEventListener('click', () => selectChannel(el.dataset.channelId))
		el.addEventListener('contextmenu', (event) => {
			const { channelId } = el.dataset
			if (channelId) void showChannelContextMenu(event, channelId)
		})
	})

	const canManageChannels = Object.values(store.context.currentState?.channelCaps || {})
		.some(cap => cap?.canEditList)
	if (canManageChannels && store.context.currentGroupId) {
		const addChannelButton = document.createElement('button')
		addChannelButton.type = 'button'
		addChannelButton.className = 'btn btn-ghost btn-sm w-[calc(100%-8px)] mx-1 mt-1 channel-create-button'
		addChannelButton.dataset.i18n = 'chat.hub.newChannel.button'
		addChannelButton.addEventListener('click', () => void showCreateChannelModal())
		container.appendChild(addChannelButton)
	}
}
