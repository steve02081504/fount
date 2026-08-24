/**
 * 【文件】public/hub/sidebar/channelListVirtual.mjs
 * 【职责】侧栏频道树的虚拟列表渲染：把树扁平为可见行，按分类折叠裁剪，交给 `createVirtualList` 窗口化渲染，
 *   避免大量频道（如 5 万个）时整棵树落 DOM 导致爆炸。分类折叠状态按群、按「展开路径」持久化到 localStorage，
 *   同一频道 id 出现在不同父节点下各自独立折叠。
 * 【原理】`buildVisibleChannelRows` 沿 `links` 建树并输出一维 `rows`；`createVirtualList` 只渲染视口附近的缓冲行；
 *   每行在 `renderItem` 内自绑定点击 / 右键。折叠分类时重算 `rows` 并 `refresh()`（键控复用未变 DOM，保留滚动）。
 */
import { mountTemplate, renderTemplate } from '../../src/templates.mjs'
import { escapeHtml } from '/scripts/lib/escapeHtml.mjs'
import { createVirtualList } from '/scripts/lib/virtualList.mjs'
import { canEditChannelList, showCategoryContextMenu, showChannelListCreateMenu } from '../categoryContextMenu.mjs'
import { showChannelContextMenu } from '../channelContextMenu.mjs'
import { channelTypeIconHtml } from '../channels.mjs'
import { store } from '../core/state.mjs'
import { isThreadChannel } from '../threadDrawer.mjs'
import { formatUnreadBadgeHtml, getChannelUnreadCount } from '../unread.mjs'

import { channelDisplayName } from './channelDisplayName.mjs'
import { bindCategoryDrag } from './channelDnd.mjs'
import { quickCreateChannel, refreshChannelSidebar, showCreateChannelModal } from './createChannel.mjs'
import { isPrivateChatActive } from './privateShell.mjs'
import { selectChannel } from './selectChannel.mjs'

const COLLAPSE_LS_PREFIX = 'fount.chat.collapsedCategories.'

/** 展开路径的分隔符（频道 id 均为 64 位 hex，不含该字符）。 */
const PATH_SEP = '/'

/** @type {ReturnType<typeof createVirtualList> | null} 当前虚拟列表实例 */
let virtualList = null
/** @type {{ id: string, kind: 'category' | 'channel', channel: object, depth: number, collapsed: boolean }[]} 当前可见行 */
let currentRows = []
/** @type {object | null} 当前渲染状态 */
let currentState = null

/**
 * @param {string} groupId 群 ID
 * @returns {Set<string>} 已折叠分类「展开路径」集合（懒加载自 localStorage 并入 store 缓存）
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
 * 切换某分类的折叠状态并持久化（按展开路径，而非频道 id——同一 id 在不同父节点下独立折叠）。
 * @param {string} groupId 群 ID
 * @param {string} categoryPath 分类的展开路径
 * @returns {boolean} 切换后是否折叠
 */
export function toggleCategoryCollapsed(groupId, categoryPath) {
	const set = collapsedSetFor(groupId)
	if (set.has(categoryPath)) set.delete(categoryPath)
	else set.add(categoryPath)
	persistCollapsed(groupId)
	return set.has(categoryPath)
}

/**
 * 读取某分类是否折叠。
 * @param {string} groupId 群 ID
 * @param {string} categoryPath 分类的展开路径
 * @returns {boolean} 是否折叠
 */
export function isCategoryCollapsed(groupId, categoryPath) {
	return collapsedSetFor(groupId).has(categoryPath)
}

/**
 * 沿 `links` 把频道树展开为可见行（分类折叠时裁剪其子树；线程频道跳过）。
 * 根容器频道 `rootChannelId` 自身不渲染，只渲染其子树；顶层顺序由 root 的 `links` 承载。
 * 折叠判定用「展开路径」而非频道 id：同一 id 出现在不同父节点下独立折叠。
 * 防环沿单条根→叶路径做，允许同一 id 分处不同分支，但同分支内不重复，避免 b→d→b→d… 无限递归。
 * @param {Record<string, object>} channels 频道表
 * @param {string} rootChannelId 根容器频道 id
 * @param {string} groupId 群 ID（用于折叠判定）
 * @returns {{ id: string, path: string, kind: 'category' | 'channel', channel: object, depth: number, collapsed: boolean }[]} 可见行
 */
export function buildVisibleChannelRows(channels, rootChannelId, groupId) {
	const rows = []
	/**
	 * 递归产出某父频道的子行（含孙）。
	 * @param {string} parentId 父频道 id
	 * @param {number} depth 子频道缩进深度
	 * @param {string} parentPath 父频道的展开路径
	 * @param {Set<string>} ancestors 当前根→父路径上的频道 id，防同分支内成环
	 * @returns {void}
	 */
	const emitChildren = (parentId, depth, parentPath, ancestors) => {
		for (const childId of channels?.[parentId]?.links || []) {
			if (ancestors.has(childId)) continue
			const child = channels?.[childId]
			if (!child || isThreadChannel(child)) continue
			const childPath = parentPath + PATH_SEP + childId
			if (child.type === 'category') {
				const collapsed = isCategoryCollapsed(groupId, childPath)
				rows.push({ id: childId, path: childPath, kind: 'category', channel: child, depth, collapsed })
				if (!collapsed)
					emitChildren(childId, depth + 1, childPath, new Set(ancestors).add(childId))
			}
			else {
				rows.push({ id: childId, path: childPath, kind: 'channel', channel: child, depth })
				emitChildren(childId, depth + 1, childPath, new Set(ancestors).add(childId))
			}
		}
	}
	emitChildren(rootChannelId, 0, rootChannelId, new Set([rootChannelId]))
	return rows
}

/**
 * 渲染分类头行（虚拟列表的一行，自绑定点击折叠 / 右键菜单）。
 * @param {{ id: string, channel: object, collapsed: boolean }} row 分类行
 * @returns {HTMLElement} 分类头元素
 */
function renderCategoryRow(row) {
	const groupId = store.context.currentGroupId
	const el = document.createElement('button')
	el.type = 'button'
	el.className = `category${row.collapsed ? ' collapsed' : ''}`
	el.dataset.cat = row.id
	el.setAttribute('aria-expanded', String(!row.collapsed))
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
		toggleCategoryCollapsed(groupId, row.path)
		refreshVirtualList()
	})
	el.addEventListener('contextmenu', (event) => {
		event.preventDefault()
		event.stopPropagation()
		const nameText = row.channel?.name || row.id
		showCategoryContextMenu(event, row.id, nameText)
	})
	bindCategoryDrag(el, row, { groupId, onExecuted: refreshChannelSidebar })
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
	currentRows = buildVisibleChannelRows(currentState.channels || {}, currentState.groupSettings?.rootChannelId || null, store.context.currentGroupId)
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

	/**
	 * 渲染新建频道按钮（DM 在外部固定槽位，普通群在传入容器内部底部）。
	 * @param {HTMLElement} hostElement 挂载容器
	 * @returns {void}
	 */
	function renderCreateButton(hostElement) {
		if (!canEditChannelList(state) || !groupId) return
		const addChannelButton = document.createElement('button')
		addChannelButton.type = 'button'
		addChannelButton.className = 'btn btn-ghost btn-sm w-[calc(100%-8px)] mx-1 mt-1 channel-create-button'
		addChannelButton.dataset.i18n = 'chat.hub.newChannel.button'
		addChannelButton.addEventListener('click', () => {
			if (isPrivateChatActive()) void quickCreateChannel()
			else void showCreateChannelModal()
		})
		if (isPrivateChatActive()) {
			const host = document.getElementById('dm-new-channel-button-host')
			if (host) host.replaceChildren(addChannelButton)
		}
		else if (hostElement) hostElement.appendChild(addChannelButton)
	}

	if (!Object.keys(channels).length) {
		currentState = state
		currentRows = []
		await mountTemplate(container, 'hub/nav/side_muted', { i18nKey: 'chat.hub.no.channels' })
		renderCreateButton(container)
		return
	}
	currentState = state
	currentRows = buildVisibleChannelRows(channels, state.groupSettings?.rootChannelId || null, groupId)

	container.replaceChildren()
	const shell = document.createElement('div')
	shell.className = 'channel-list-virtual-shell'
	const scroll = document.createElement('div')
	scroll.className = 'channel-list-virtual'
	shell.appendChild(scroll)
	container.appendChild(shell)

	scroll.addEventListener('contextmenu', (event) => {
		if (isPrivateChatActive()) return
		showChannelListCreateMenu(event)
	})

	renderCreateButton(shell)

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
		 * 行键：分类与频道各自带前缀，refresh 时键控复用 DOM。用展开路径而非 id——同一 id 在不同父节点下是不同行。
		 * @param {object} row 行数据
		 * @returns {string} 行键
		 */
		getItemKey: row => (row.kind === 'category' ? 'cat:' : 'ch:') + row.path,
	})
}
