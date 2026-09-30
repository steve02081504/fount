/**
 * 标签条：渲染、右键菜单、开关/新建、跨页同步（BroadcastChannel）、URL 同步与后端 `code.tabs` 持久化。
 */
import { bindDismissOnDocumentInteraction } from '/scripts/components/contextMenuDismiss.mjs'
import { positionContextMenu } from '/scripts/components/positionContextMenu.mjs'
import { promptText } from '/scripts/features/promptDialog.mjs'
import { showToastI18n } from '/scripts/features/toast.mjs'
import { geti18n, setElementI18n } from '/scripts/i18n/index.mjs'
import { svgInliner } from '/scripts/lib/svgInliner.mjs'

import * as api from './endpoints.mjs'
import { iconElement, icons } from './icons.mjs'
import { activateTab, deleteSessionPermanently } from './session.mjs'
import { flushSession, registerPersistenceHooks } from './sessionPersistence.mjs'
import { activeTab, elements, getRuntime, isGenerating, store, TAB_SAVE_DEBOUNCE, tabKeyOf } from './store.mjs'

/** 标签页保存防抖定时器句柄。 */
let tabSaveTimer = 0
/** `/tabs` 写入串行链（避免并发覆盖）。 */
let tabSaveChain = Promise.resolve()
/** 跨页面标签同步频道。 */
const tabsChannel = typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel('fount-code-tabs') : null
/** 本页唯一标识（忽略自身广播）。 */
const pageId = crypto.randomUUID()

/**
 * 从后端恢复标签页（草稿含未发送内容，跨页面共享）。
 * @returns {Promise<void>} 完成。
 */
export async function loadTabPrefs() {
	try {
		const data = await api.getTabs()
		store.tabs = Array.isArray(data.tabs) ? data.tabs.filter(tab => tab?.id && (tab.type === 'draft' || tab.type === 'session')) : []
		store.activeTabKey = String(data.activeTab || '')
	}
	catch {
		store.tabs = []
		store.activeTabKey = ''
	}
}

/** 持久化标签页列表与活动标签到后端（防抖），并广播给其他打开的页面。 */
export function saveTabPrefs() {
	clearTimeout(tabSaveTimer)
	tabSaveTimer = setTimeout(() => {
		tabSaveTimer = 0
		void persistTabs()
	}, TAB_SAVE_DEBOUNCE)
}

/** 立即持久化待写的标签页（失焦/隐藏/卸载前调用）。 */
export function flushTabPrefs() {
	if (!tabSaveTimer) return
	clearTimeout(tabSaveTimer)
	tabSaveTimer = 0
	void persistTabs()
}

/** 上传当前标签页状态；成功后才广播。 */
async function persistTabs() {
	const payload = {
		tabs: store.tabs.map(tab => ({ type: tab.type, id: tab.id, workspaceId: tab.workspaceId, ...typeof tab.draft === 'string' ? { draft: tab.draft } : {} })),
		activeTab: store.activeTabKey,
	}
	tabSaveChain = tabSaveChain.catch(() => { }).then(async () => {
		try {
			await api.putTabs(payload.tabs, payload.activeTab)
			tabsChannel?.postMessage({ source: pageId, ...payload })
		}
		catch { /* 保留本地状态，下次防抖重试 */ }
	})
	await tabSaveChain
}

/**
 * 应用其他页面广播的标签页状态：保留本地运行中的标签与活动标签的未发送草稿。
 * @param {{tabs?: Array<object>, activeTab?: string}} data - 广播负载。
 * @returns {Promise<void>} 完成。
 */
async function applyRemoteTabs({ tabs, activeTab: remoteActive } = {}) {
	if (!Array.isArray(tabs)) return
	const current = activeTab()
	const currentKey = current ? tabKeyOf(current) : ''
	const localDraft = current?.draft
	// 本地运行中的标签不被远端覆盖移除（保留其运行时与草稿）
	const busyLocal = new Map()
	for (const tab of store.tabs) {
		const key = tabKeyOf(tab)
		const runtime = getRuntime(key)
		if (runtime && runtime.status !== 'idle') busyLocal.set(key, tab)
	}
	const merged = tabs.slice()
	const mergedKeys = new Set(merged.map(tabKeyOf))
	for (const [key, tab] of busyLocal) if (!mergedKeys.has(key)) merged.push(tab)
	store.tabs = merged
	if (currentKey) {
		const kept = store.tabs.find(tab => tabKeyOf(tab) === currentKey)
		if (kept && localDraft != null) kept.draft = localDraft
	}
	const previousActiveKey = store.activeTabKey
	const keepActive = store.tabs.some(tab => tabKeyOf(tab) === previousActiveKey)
	store.activeTabKey = keepActive
		? previousActiveKey
		: remoteActive && store.tabs.some(tab => tabKeyOf(tab) === remoteActive) ? remoteActive : store.tabs[0] ? tabKeyOf(store.tabs[0]) : ''
	renderTabs()
	if (store.activeTabKey === previousActiveKey) return
	if (store.activeTabKey) {
		const nextTab = store.tabs.find(tab => tabKeyOf(tab) === store.activeTabKey)
		store.activeTabKey = ''
		await activateTab(nextTab)
	}
	else {
		store.session = null
		await startNewSession()
	}
}

tabsChannel?.addEventListener('message', event => {
	const { data } = event
	if (!data || data.source === pageId) return
	void applyRemoteTabs(data)
})

/**
 * 新建草稿标签页（未保存的新会话）。
 * @param {string} workspaceId - 绑定的工作区 id。
 * @returns {object} 标签页。
 */
export function createDraftTab(workspaceId) {
	const tab = { type: 'draft', id: crypto.randomUUID().slice(0, 8), workspaceId: workspaceId || '' }
	store.tabs.push(tab)
	return tab
}

/**
 * 标签页标题信息：chrome（草稿 / 未命名）走 `data-i18n` 自动重译，会话标题为用户/数据文本。
 * @param {object} tab - 标签页。
 * @returns {{ text: string, i18nKey: string|null }} 标题文本与（chrome 时的）i18n 键。
 */
function tabTitleInfo(tab) {
	if (tab.type === 'draft') return { text: geti18n('code.sessions.new'), i18nKey: 'code.sessions.new' }
	const cached = getRuntime(tabKeyOf(tab))?.session
	const summary = store.allSessions.find(session => session.id === tab.id && session.workspaceId === tab.workspaceId)
	const title = cached?.title || summary?.title
	return title ? { text: title, i18nKey: null } : { text: geti18n('code.sessions.untitled'), i18nKey: 'code.sessions.untitled' }
}

/**
 * 标签页标题文本。
 * @param {object} tab - 标签页。
 * @returns {string} 标题。
 */
function tabTitle(tab) {
	return tabTitleInfo(tab).text
}

/**
 * 同步地址栏为当前标签页（不带历史记录）。
 * 仅 session 标签写入 ?workspace=&session=；草稿清空查询参数，
 * 以免 reload 被 boot 当成 `fount run` 的 ?workspace= 语义而多建草稿。
 * @param {object} tab - 当前标签页。
 * @returns {void}
 */
export function syncCodeUrl(tab) {
	const url = new URL(location.href)
	url.search = ''
	if (tab?.type === 'session' && tab.id) {
		if (tab.workspaceId) url.searchParams.set('workspace', tab.workspaceId)
		url.searchParams.set('session', tab.id)
	}
	history.replaceState(null, '', url.toString())
}

/** 新建标签按钮（由 renderTabs 渲染在最后一个标签右侧，随标签条滚动）。 */
const newTabButton = (() => {
	const button = document.createElement('button')
	button.type = 'button'
	button.id = 'new-tab-button'
	button.className = 'btn btn-ghost btn-square btn-sm'
	button.appendChild(iconElement(icons.plus, { size: 16 }))
	button.addEventListener('click', () => void startNewSession())
	return button
})()

/**
 * 标签页的无障碍名称（标题 + 运行 / 未读状态）。
 * @param {object} tab - 标签页。
 * @returns {string} aria-label。
 */
function tabAriaLabel(tab) {
	const title = tabTitle(tab)
	if (isGenerating(tabKeyOf(tab))) return geti18n('code.tabs.generating.aria-label', { title })
	if (store.tabUnread.has(tabKeyOf(tab))) return geti18n('code.tabs.unread.aria-label', { title })
	return title
}

/** 渲染标签条（活动态高亮 / hover 关闭钮 / 中键关闭），新建按钮紧随最后一个标签。 */
export function renderTabs() {
	newTabButton.setAttribute('aria-label', geti18n('code.newTab.aria-label'))
	elements.tabStrip.replaceChildren(...store.tabs.map(tab => {
		const key = tabKeyOf(tab)
		const wrap = document.createElement('div')
		wrap.className = 'code-tab'
		wrap.dataset.tabKey = key
		wrap.setAttribute('data-active', String(key === store.activeTabKey))
		const main = document.createElement('button')
		main.type = 'button'
		main.className = 'code-tab-main'
		if (tab.type === 'draft') {
			const icon = document.createElement('span')
			icon.className = 'code-tab-avatar code-tab-avatar-draft'
			icon.appendChild(iconElement(icons.edit, { size: 12 }))
			main.appendChild(icon)
		}
		else {
			const workspace = store.workspaces.find(w => w.id === tab.workspaceId)
			const name = workspace?.name || workspace?.path || '?'
			const avatar = document.createElement('span')
			avatar.className = 'code-tab-avatar'
			avatar.textContent = [...name][0]?.toUpperCase() || '·'
			const hue = [...name].reduce((sum, ch) => sum + (ch.codePointAt(0) || 0), 0) % 360
			avatar.style.background = `oklch(72% 0.11 ${hue})`
			main.appendChild(avatar)
		}
		const title = document.createElement('span')
		title.className = 'code-tab-title'
		const titleInfo = tabTitleInfo(tab)
		if (titleInfo.i18nKey) setElementI18n(title, titleInfo.i18nKey)
		else {
			// 标题为工作区/会话动态文本，跳过语种扫描
			title.setAttribute('user-content', '')
			title.textContent = titleInfo.text
		}
		main.appendChild(title)
		// 按钮自身的 aria-label 含会话/工作区动态标题，跳过语种扫描（子树内标题元素各自处理）
		main.setAttribute('user-content', 'aria-label')
		main.setAttribute('aria-label', tabAriaLabel(tab))
		if (isGenerating(key)) {
			const badge = document.createElement('span')
			badge.className = 'code-tab-generating'
			badge.setAttribute('aria-hidden', 'true')
			main.appendChild(badge)
		}
		if (store.tabUnread.has(key)) {
			const badge = document.createElement('span')
			badge.className = 'code-tab-unread'
			badge.setAttribute('aria-hidden', 'true')
			main.appendChild(badge)
		}
		main.addEventListener('click', () => void activateTab(tab))
		main.addEventListener('auxclick', event => {
			if (event.button === 1) {
				event.preventDefault()
				void closeTab(tab)
			}
		})
		const close = document.createElement('button')
		close.type = 'button'
		close.className = 'code-tab-close'
		close.setAttribute('aria-label', geti18n('code.tabs.close'))
		close.appendChild(iconElement(icons.close, { size: 12 }))
		close.addEventListener('click', event => {
			event.stopPropagation()
			void closeTab(tab)
		})
		wrap.addEventListener('contextmenu', event => showTabContextMenu(event, tab))
		wrap.append(main, close)
		return wrap
	}), newTabButton)
	void svgInliner(elements.tabStrip)
}

/* ---------------- 标签右键菜单 ---------------- */

/** 标签右键菜单的关闭绑定。 */
let tabMenuDismiss = null

/** 隐藏标签右键菜单。 */
function hideTabContextMenu() {
	tabMenuDismiss?.unbind?.()
	tabMenuDismiss = null
	elements.tabMenu.classList.add('hidden')
}

/**
 * 批量关闭标签：活动标签被移除时落到相邻标签（无标签则新建草稿）。
 * 正在生成的标签会被跳过（避免回复落到已移除标签）。
 * @param {object[]} targets - 待关闭标签。
 * @returns {Promise<void>} 完成。
 */
async function closeTabs(targets) {
	const keys = new Set(targets.map(tabKeyOf))
	if (!keys.size) return
	let skipped = false
	for (const key of [...keys])
		if (isGenerating(key)) {
			keys.delete(key)
			skipped = true
		}
	if (!keys.size) {
		if (skipped) showToastI18n('info', 'code.tabs.closeGenerating')
		return
	}
	// 关闭前先落盘待写会话，避免丢失生成外的未保存内容
	for (const key of keys) await flushSession(key)
	const activeRemoved = keys.has(store.activeTabKey)
	const activeIndex = store.tabs.findIndex(tab => tabKeyOf(tab) === store.activeTabKey)
	store.tabs = store.tabs.filter(tab => !keys.has(tabKeyOf(tab)))
	for (const key of keys) store.runtimes.delete(key)
	renderTabs()
	saveTabPrefs()
	if (activeRemoved) {
		store.activeTabKey = ''
		store.session = null
		const next = store.tabs[Math.min(activeIndex, store.tabs.length - 1)] || null
		if (next) await activateTab(next)
		else await startNewSession()
	}
	if (skipped) showToastI18n('info', 'code.tabs.closeGenerating')
}

/**
 * 关闭除目标外的全部标签（目标成为活动标签）。
 * @param {object} tab - 保留的标签。
 * @returns {Promise<void>} 完成。
 */
async function closeOtherTabs(tab) {
	if (tabKeyOf(tab) !== store.activeTabKey) await activateTab(tab)
	await closeTabs(store.tabs.filter(item => tabKeyOf(item) !== tabKeyOf(tab)))
}

/**
 * 关闭目标左侧的全部标签。
 * @param {object} tab - 基准标签。
 * @returns {Promise<void>} 完成。
 */
async function closeTabsToLeft(tab) {
	const index = store.tabs.indexOf(tab)
	if (index <= 0) return
	await closeTabs(store.tabs.slice(0, index))
}

/**
 * 关闭目标右侧的全部标签。
 * @param {object} tab - 基准标签。
 * @returns {Promise<void>} 完成。
 */
async function closeTabsToRight(tab) {
	const index = store.tabs.indexOf(tab)
	if (index === -1) return
	await closeTabs(store.tabs.slice(index + 1))
}

/**
 * 重命名会话标签（草稿标签无标题，跳过）。
 * 未缓存的会话按标签自身的工作区加载，避免误用当前活动工作区。
 * @param {object} tab - 目标标签页。
 * @returns {Promise<void>} 完成。
 */
async function renameTab(tab) {
	if (tab.type !== 'session') return
	const workspace = store.workspaces.find(w => w.id === tab.workspaceId)
	if (!workspace) return
	const key = tabKeyOf(tab)
	let session = getRuntime(key)?.session || (key === store.activeTabKey ? store.session : null)
	if (!session)
		try {
			session = await api.loadSession({ machine: String(workspace.machine ?? store.machine), workdir: workspace.path }, tab.id)
		}
		catch {
			return
		}
	if (!session) return
	const title = await promptText('code.tabs.rename', session.title || '')
	if (!title || title === session.title) return
	session.title = title
	getRuntime(key, { create: true }).session = session
	const summary = store.allSessions.find(item => item.id === tab.id && item.workspaceId === tab.workspaceId)
	if (summary) summary.title = title
	renderTabs()
	await api.putSession({ machine: String(workspace.machine ?? store.machine), workdir: workspace.path }, session)
		.catch(error => showToastI18n('error', 'code.error.generic', { error: String(error.message || error) }))
}

/**
 * 显示标签右键菜单（重命名 / 删除对话 / 关闭 / 关闭其他 / 关闭左侧 / 关闭右侧 / 关闭全部）。
 * @param {MouseEvent} event - contextmenu 事件。
 * @param {object} tab - 右击的标签。
 * @returns {void}
 */
export function showTabContextMenu(event, tab) {
	event.preventDefault()
	hideTabContextMenu()
	const index = store.tabs.indexOf(tab)
	const actions = [
		tab.type === 'session' ? {
			i18n: 'code.tabs.rename',
			/** @returns {Promise<void>} 重命名该标签。 */
			run: () => renameTab(tab),
		} : null,
		tab.type === 'session' ? {
			i18n: 'code.sessions.delete',
			danger: true,
			/** @returns {Promise<void>} 永久删除该会话（确认后关闭标签并删除磁盘文件）。 */
			run: async () => { await deleteSessionPermanently({ id: tab.id, workspaceId: tab.workspaceId, title: tabTitle(tab) }) },
		} : null,
		{
			i18n: 'code.tabs.close',
			/** @returns {Promise<void>} 关闭该标签。 */
			run: () => closeTab(tab),
		},
		{
			i18n: 'code.tabs.closeMenu.others',
			/** @returns {Promise<void>} 关闭其他标签。 */
			run: () => closeOtherTabs(tab),
		},
		index > 0 ? {
			i18n: 'code.tabs.closeMenu.left',
			/** @returns {Promise<void>} 关闭左侧标签。 */
			run: () => closeTabsToLeft(tab),
		} : null,
		index !== -1 && index < store.tabs.length - 1 ? {
			i18n: 'code.tabs.closeMenu.right',
			/** @returns {Promise<void>} 关闭右侧标签。 */
			run: () => closeTabsToRight(tab),
		} : null,
		{
			i18n: 'code.tabs.closeMenu.all',
			danger: true,
			/** @returns {Promise<void>} 关闭全部标签。 */
			run: () => closeTabs([...store.tabs]),
		},
	].filter(Boolean)
	const menu = elements.tabMenu
	menu.replaceChildren(...actions.map(action => {
		const button = document.createElement('button')
		button.type = 'button'
		button.className = 'code-tab-menu-item'
		button.setAttribute('role', 'menuitem')
		if (action.danger) button.classList.add('text-error')
		const label = document.createElement('span')
		label.dataset.i18n = action.i18n
		button.appendChild(label)
		button.addEventListener('click', () => {
			hideTabContextMenu()
			void action.run()
		})
		return button
	}))
	menu.setAttribute('aria-label', geti18n('code.tabs.closeMenu.aria-label'))
	menu.classList.remove('hidden')
	positionContextMenu(menu, { x: event.clientX, y: event.clientY, minWidth: '11rem' })
	tabMenuDismiss = bindDismissOnDocumentInteraction(hideTabContextMenu)
}

/**
 * 关闭标签页（脏会话先落盘，活动标签关闭后切相邻 / 回落草稿）。
 * 生成中的标签不可关闭；`discard` 用于「删除对话」——跳过落盘，避免把已删文件写回。
 * @param {object} tab - 目标标签页。
 * @param {{discard?: boolean}} [options] - 关闭选项。
 * @returns {Promise<void>} 完成。
 */
export async function closeTab(tab, { discard = false } = {}) {
	const key = tabKeyOf(tab)
	if (isGenerating(key)) {
		showToastI18n('info', 'code.tabs.closeGenerating')
		return
	}
	const runtime = getRuntime(key)
	if (runtime && discard) runtime.savedRevision = runtime.revision
	if (key === store.activeTabKey) {
		const index = store.tabs.indexOf(tab)
		const next = store.tabs[index + 1] || store.tabs[index - 1]
		if (next) await activateTab(next)
		else {
			if (store.session && runtime) runtime.session = store.session
			store.session = null
			store.activeTabKey = ''
		}
	}
	if (!discard) await flushSession(key)
	store.tabs = store.tabs.filter(item => tabKeyOf(item) !== key)
	store.runtimes.delete(key)
	renderTabs()
	saveTabPrefs()
	if (!store.activeTabKey || !activeTab()) await startNewSession()
}

/**
 * 新建会话：总是新建一个草稿标签（允许多个未开启正式对话的标签并存），默认在上一个对话的工作区。
 * @returns {Promise<void>} 完成。
 */
export async function startNewSession() {
	const workspaceId = [store.session?.workspaceId, store.lastConversationWorkspaceId, store.workspace?.id]
		.find(id => id && store.workspaces.some(w => w.id === id)) || ''
	await activateTab(createDraftTab(workspaceId))
}

registerPersistenceHooks({
	/**
	 * 草稿转为会话标签时同步 URL 并刷新标签条。
	 * @param {string} tabKey - 标签键。
	 * @returns {void}
	 */
	onTabPromoted: tabKey => {
		const tab = store.tabs.find(item => tabKeyOf(item) === tabKey)
		if (tab && tabKey === store.activeTabKey) syncCodeUrl(tab)
		renderTabs()
		saveTabPrefs()
	},
})
