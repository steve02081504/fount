/**
 * 【文件】public/hub/sidebar/channels.mjs
 * 【职责】侧栏频道树渲染（分类折叠、未读徽章、创建按钮）。
 */
import {
	mountTemplate,
	renderTemplate,
} from '../../../../../scripts/features/template.mjs'
import { escapeHtml } from '/scripts/lib/escapeHtml.mjs'
import { showChannelContextMenu } from '../channelContextMenu.mjs'
import { buildChannelTree, channelTypeIconHtml } from '../channels.mjs'
import { store } from '../core/state.mjs'
import { isThreadChannel } from '../threadDrawer.mjs'
import { formatUnreadBadgeHtml, getChannelUnreadCount } from '../unread.mjs'

import { showCreateChannelModal } from './createChannel.mjs'
import { getChannelListContainer } from './privateShell.mjs'
import { selectChannel } from './selectChannel.mjs'

/**
 * 渲染频道树列表。
 * @param {object} state 群组状态
 * @returns {Promise<void>}
 */
export async function renderChannelList(state) {
	const container = getChannelListContainer()
	if (!container) return
	const channels = state.channels || {}
	const channelIds = Object.keys(channels)
	if (!channelIds.length) {
		await mountTemplate(container, 'hub/nav/side_muted', { i18nKey: 'chat.hub.noChannels' })
		return
	}
	const { ordered } = buildChannelTree(channels)
	const visible = ordered.filter(({ channel }) => !isThreadChannel(channel))
	const groupsByCat = {}
	for (const { id, channel, depth } of visible) {
		const category = channel.category || ''
		const categoryI18n = channel.category ? '' : 'chat.hub.defaultCategory'
		const catKey = category || '__default__'
		if (!groupsByCat[catKey]) groupsByCat[catKey] = { category, categoryI18n, channels: [] }
		groupsByCat[catKey].channels.push({ id, depth, ...channel })
	}
	container.replaceChildren()
	for (const catKey of Object.keys(groupsByCat)) {
		const { category, categoryI18n, channels } = groupsByCat[catKey]
		const isCollapsed = store.sidebar.collapsedCategories.has(catKey)
		container.appendChild(await renderTemplate('hub/nav/channel_category', {
			collapsedClass: isCollapsed ? 'collapsed' : '',
			category: escapeHtml(catKey),
			categoryName: escapeHtml(category),
			categoryI18nAttr: categoryI18n ? ` data-i18n="${categoryI18n}"` : '',
		}))
		if (!isCollapsed) {
			const listHost = container.querySelector(`.category[data-cat="${CSS.escape(catKey)}"] + .category-channels`)
			const sortedChannels = [...channels].sort((left, right) => {
				const leftSeq = Number(state.channels?.[left.id]?.messageSeq) || 0
				const rightSeq = Number(state.channels?.[right.id]?.messageSeq) || 0
				return rightSeq - leftSeq
			})
			for (const channel of sortedChannels) {
				const active = channel.id === store.context.currentChannelId ? 'active' : ''
				const nested = channel.depth > 0 ? ' channel-nested' : ''
				const groupId = store.context.currentGroupId
				listHost.appendChild(await renderTemplate('hub/nav/channel_item', {
					activeClass: active ? 'active' : '',
					nestedClass: nested,
					channelId: channel.id,
					paddingLeft: String(12 + channel.depth * 14),
					iconHtml: await channelTypeIconHtml(channel.type || 'text'),
					channelName: escapeHtml(channel.name || channel.id),
					unreadBadgeHtml: groupId
						? formatUnreadBadgeHtml(getChannelUnreadCount(groupId, channel.id))
						: '',
				}))
			}
		}
	}
	container.querySelectorAll('.category').forEach(el => {
		el.addEventListener('click', () => {
			const category = el.dataset.cat
			if (store.sidebar.collapsedCategories.has(category)) store.sidebar.collapsedCategories.delete(category)
			else store.sidebar.collapsedCategories.add(category)
			void import('./index.mjs').then(({ renderHubChannelSidebar }) =>
				renderHubChannelSidebar(store.context.currentState),
			)
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
		addChannelButton.dataset.i18n = 'chat.hub.newChannelButton'
		addChannelButton.addEventListener('click', () => void showCreateChannelModal())
		container.appendChild(addChannelButton)
	}
}
