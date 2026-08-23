/**
 * 【文件】public/hub/sidebar/channelListVirtual.mjs
 * 【职责】侧栏频道树的虚拟列表渲染：把树扁平为可见行，按分类折叠裁剪，交给 `createVirtualList` 窗口化渲染，
 *   避免大量频道（如 5 万个）时整棵树落 DOM 导致爆炸。分类折叠状态按群持久化到 localStorage。
 * 【原理】`buildVisibleChannelRows` 沿 `links` 建树并输出一维 `rows`；`createVirtualList` 只渲染视口附近的缓冲行；
 *   每行在 `renderItem` 内自绑定点击 / 右键。折叠分类时重算 `rows` 并 `refresh()`（键控复用未变 DOM，保留滚动）。
 */
import { mountTemplate, renderTemplate } from '../../src/templates.mjs'
import { escapeHtml } from '/scripts/lib/escapeHtml.mjs'
import { createVirtualList } from '/scripts/lib/virtualList.mjs'
import { showCategoryContextMenu, showChannelListCreateMenu } from '../categoryContextMenu.mjs'
import { showChannelContextMenu } from '../channelContextMenu.mjs'
import { channelTypeIconHtml } from '../channels.mjs'
import { store } from '../core/state.mjs'
import { isThreadChannel } from '../threadDrawer.mjs'
import { formatUnreadBadgeHtml, getChannelUnreadCount } from '../unread.mjs'

import { channelDisplayName } from './channelDisplayName.mjs'
import { quickCreateChannel, showCreateChannelModal } from './createChannel.mjs'
import { isPrivateChatActive } from './privateShell.mjs'
import { selectChannel } from './selectChannel.mjs'

const COLLAPSE_LS_PREFIX = 'fount.chat.collapsedCategories.'

/** @type {WeakSet<HTMLElement>} 已挂滚动容器空白区右键的容器 */
const listMenuBoundContainers = new WeakSet()

/** @type {ReturnType<typeof createVirtualList> | null} 当前虚拟列表实例 */
let virtualList = null
/** @type {{ id: string, kind: 'category' | 'channel', channel: object, depth: number, collapsed: boolean }[]} 当前可见行 */
let currentRows = []
/** @type {object | null} 当前渲染状态 */
let currentState = null

/**
 * @param {string} groupId 群 ID
 * @returns {Set<string>} 已折叠分类 id 集合（懒加载自 localStorage 并入 store 缓存）
 */
function collapsedSetFor(groupId) {
	let set = store.sidebar.collapsedCategories.get(groupId)
	if (!set) {
		let stored = []
		try {
			const raw = localStorage.getItem(COLLAPSE_LS_PREFIX + groupId)
			if (raw) {
				const parsed = JSON.parse(raw)
				if (Array.isArray(parsed)) stored = parsed
			}
		}
		catch { /* 忽略损坏数据，回退为空集 */ }
		set = new Set(stored)
		store.sidebar.collapsedCategories.set(groupId, set)
	}
	return set
}

/**
 * 持久化某群分类折叠集合到 localStorage。
 * @param {string} groupId 群 ID
 * @returns {void}
 */
function persistCollapsed(groupId) {
	const set = collapsedSetFor(groupId)
	try {
		localStorage.setItem(COLLAPSE_LS_PREFIX + groupId, JSON.stringify([...set]))
	}
	catch { /* 存储满 / 被禁时静默忽略 */ }
}

/**
 * 切换某分类的折叠状态并持久化。
 * @param {string} groupId 群 ID
 * @param {string} categoryId 分类频道 id
 * @returns {boolean} 切换后是否折叠
 */
export function toggleCategoryCollapsed(groupId, categoryId) {
	const set = collapsedSetFor(groupId)
	if (set.has(categoryId)) set.delete(categoryId)
	else set.add(categoryId)
	persistCollapsed(groupId)
	return set.has(categoryId)
}

/**
 * 读取某分类是否折叠。
 * @param {string} groupId 群 ID
 * @param {string} categoryId 分类频道 id
 * @returns {boolean} 是否折叠
 */
export function isCategoryCollapsed(groupId, categoryId) {
	return collapsedSetFor(groupId).has(categoryId)
}

/**
 * @param {object} channel 频道元数据
 * @returns {boolean} 频道是否已有非空名称
 */
function hasChannelName(channel) {
	return !!(channel?.name && String(channel.name).trim())
}

/**
 * 沿 `links` 把频道树展开为可见行（分类折叠时裁剪其子树；线程频道跳过）。
 * @param {Record<string, object>} channels 频道表
 * @param {string} groupId 群 ID（用于折叠判定）
 * @returns {{ id: string, kind: 'category' | 'channel', channel: object, depth: number, collapsed: boolean }[]} 可见行
 */
export function buildVisibleChannelRows(channels, groupId) {
	const entries = Object.entries(channels || {})
	/** @type {Map<string, string[]>} 父频道 id → 有序子频道 id */
	const byParent = new Map()
	const childIds = new Set()
	for (const [id, channel] of entries)
		for (const childId of channel?.links || [])
			if (channels[childId]) {
				childIds.add(childId)
				if (!byParent.has(id)) byParent.set(id, [])
				byParent.get(id).push(childId)
			}
	const roots = entries.filter(([id]) => !childIds.has(id)).map(([id]) => id)
	const rows = []
	/**
	 * 递归产出某父频道的子行（含孙）。
	 * @param {string} parentId 父频道 id
	 * @param {number} depth 子频道缩进深度
	 * @returns {void}
	 */
	const emitChildren = (parentId, depth) => {
		for (const childId of byParent.get(parentId) || []) {
			const child = channels[childId]
			if (!child || isThreadChannel(child)) continue
			if (child.type === 'category') {
				const collapsed = isCategoryCollapsed(groupId, childId)
				rows.push({ id: childId, kind: 'category', channel: child, depth, collapsed })
				if (!collapsed) emitChildren(childId, depth + 1)
			}
			else {
				rows.push({ id: childId, kind: 'channel', channel: child, depth })
				emitChildren(childId, depth + 1)
			}
		}
	}
	const categoryRoots = roots.filter(id => channels[id]?.type === 'category')
	const channelRoots = roots.filter(id => channels[id]?.type !== 'category')
	if (isPrivateChatActive())
		channelRoots.sort((a, b) => Number(hasChannelName(channels[a])) - Number(hasChannelName(channels[b])))
	for (const id of categoryRoots) {
		const collapsed = isCategoryCollapsed(groupId, id)
		rows.push({ id, kind: 'category', channel: channels[id], depth: 0, collapsed })
		if (!collapsed) emitChildren(id, 1)
	}
	for (const id of channelRoots) {
		const channel = channels[id]
		if (!channel || isThreadChannel(channel)) continue
		rows.push({ id, kind: 'channel', channel, depth: 0 })
		emitChildren(id, 1)
	}
	return rows
}

/**
 * 渲染分类头行（虚拟列表的一行，自绑定点击折叠 / 右键菜单）。
 * @param {{ id: string, channel: object, collapsed: boolean }} row 分类行
 * @returns {HTMLElement} 分类头元素
 */
function renderCategoryRow(row) {
	const groupId = store.context.currentGroupId
	const el = document.createElement('div')
	el.className = `category${row.collapsed ? ' collapsed' : ''}`
	el.dataset.cat = row.id
	const arrow = document.createElement('img')
	arrow.src = 'https://api.iconify.design/mdi/chevron-down.svg'
	arrow.className = 'category-arrow'
	arrow.width = 12
	arrow.height = 12
	arrow.alt = ''
	arrow.setAttribute('aria-hidden', 'true')
	const name = document.createElement('span')
	name.textContent = channelDisplayName(row.channel)
	el.append(arrow, name)
	el.addEventListener('click', () => {
		toggleCategoryCollapsed(groupId, row.id)
		refreshVirtualList()
	})
	el.addEventListener('contextmenu', (event) => {
		event.preventDefault()
		event.stopPropagation()
		const nameText = row.channel?.name || row.id
		showCategoryContextMenu(event, row.id, nameText)
	})
	return el
}

/**
 * 渲染频道项行（虚拟列表的一行，自绑定点击选择 / 右键菜单）。
 * @param {{ id: string, channel: object, depth: number }} row 频道行
 * @returns {Promise<HTMLElement>} 频道项元素
 */
async function renderChannelRow(row) {
	const groupId = store.context.currentGroupId
	const active = row.id === store.context.currentChannelId ? 'active' : ''
	const nested = row.depth > 0 ? ' channel-nested' : ''
	const item = await renderTemplate('hub/nav/channel_item', {
		activeClass: active,
		nestedClass: nested,
		channelId: row.id,
		paddingLeft: String(12 + row.depth * 14),
		iconHtml: await channelTypeIconHtml(row.channel.type || 'text'),
		channelName: escapeHtml(channelDisplayName(row.channel)),
		unreadBadgeHtml: groupId
			? formatUnreadBadgeHtml(getChannelUnreadCount(groupId, row.id))
			: '',
	})
	const li = item.nodeType === Node.DOCUMENT_FRAGMENT_NODE ? item.firstElementChild : item
	// 直接返回 `<a class="channel-item">`（丢弃 `<li>` 外壳），避免虚拟列表里出现游离 `<li>` 触发 a11y 告警。
	const anchor = li?.querySelector?.('.channel-item')
	anchor?.addEventListener('click', () => selectChannel(row.id))
	anchor?.addEventListener('contextmenu', (event) => {
		event.preventDefault()
		event.stopPropagation()
		void showChannelContextMenu(event, row.id)
	})
	return anchor || li
}

/**
 * 折叠状态变化后重建当前可见行并刷新虚拟列表（保留滚动）。
 * @returns {void}
 */
function refreshVirtualList() {
	if (!currentState) return
	currentRows = buildVisibleChannelRows(currentState.channels || {}, store.context.currentGroupId)
	void virtualList?.refresh()
}

/**
 * 渲染频道列表虚拟化容器（含空态、创建按钮）。
 * @param {HTMLElement} container 频道列表挂载容器
 * @param {object} state 群组状态
 * @returns {Promise<void>}
 */
export async function renderChannelListVirtual(container, state) {
	virtualList?.destroy()
	virtualList = null
	if (!container || !state) return
	const channels = state.channels || {}
	const groupId = store.context.currentGroupId
	if (!Object.keys(channels).length) {
		currentState = state
		currentRows = []
		await mountTemplate(container, 'hub/nav/side_muted', { i18nKey: 'chat.hub.no.channels' })
		return
	}
	currentState = state
	currentRows = buildVisibleChannelRows(channels, groupId)

	container.replaceChildren()
	const shell = document.createElement('div')
	shell.className = 'channel-list-virtual-shell'
	const scroll = document.createElement('div')
	scroll.className = 'channel-list-virtual'
	shell.appendChild(scroll)
	container.appendChild(shell)

	if (!isPrivateChatActive() && !listMenuBoundContainers.has(scroll)) {
		listMenuBoundContainers.add(scroll)
		scroll.addEventListener('contextmenu', (event) => {
			showChannelListCreateMenu(event)
		})
	}

	const canManageChannels = Object.values(state.channelCaps || {})
		.some(cap => cap?.canEditList)
	if (canManageChannels && groupId) {
		const addChannelButton = document.createElement('button')
		addChannelButton.type = 'button'
		addChannelButton.className = 'btn btn-ghost btn-sm w-[calc(100%-8px)] mx-1 mt-1 channel-create-button'
		addChannelButton.dataset.i18n = 'chat.hub.newChannel.button'
		addChannelButton.addEventListener('click', () => {
			if (isPrivateChatActive()) void quickCreateChannel()
			else void showCreateChannelModal()
		})
		shell.appendChild(addChannelButton)
	}

	virtualList = createVirtualList({
		container: scroll,
		/**
		 * 按窗口取当前可见行的分页切片。
		 * @param {number} offset 起始下标
		 * @param {number} limit 条数
		 * @returns {{ items: object[], total: number }} 分页
		 */
		fetchData: (offset, limit) => ({
			items: limit === 0 ? [] : currentRows.slice(offset, offset + limit),
			total: currentRows.length,
		}),
		/**
		 * 渲染单个频道树行（分类头或频道项）。
		 * @param {object} row 行数据
		 * @returns {Promise<HTMLElement>} 行元素
		 */
		renderItem: row => row.kind === 'category'
			? renderCategoryRow(row)
			: renderChannelRow(row),
		/**
		 * 行键：分类与频道各自带前缀，refresh 时键控复用 DOM。
		 * @param {object} row 行数据
		 * @returns {string} 行键
		 */
		getItemKey: row => (row.kind === 'category' ? 'cat:' : 'ch:') + row.id,
		/** 渲染完成回调（行内已自绑定交互，此处无需额外装饰）。 */
		onRenderComplete: () => {},
	})
}
