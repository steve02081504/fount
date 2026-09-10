/**
 * 会话生命周期：标签条 / 工作区会话 / WebSocket 流式生成 / 落盘 flush / 发送与重新生成。
 */
import { StreamRenderer } from '/parts/shells:chat/src/ui/StreamRenderer.mjs'
import { getGist } from '/parts/shells:gist/src/endpoints.mjs'

import { bindDismissOnDocumentInteraction } from '/scripts/components/contextMenuDismiss.mjs'
import { positionContextMenu } from '/scripts/components/positionContextMenu.mjs'
import { confirmAction, promptText } from '/scripts/features/promptDialog.mjs'
import { showToastI18n } from '/scripts/features/toast.mjs'
import { geti18n } from '/scripts/i18n/index.mjs'
import { arrayBufferToBase64 } from '/scripts/lib/base64.mjs'
import { svgInliner } from '/scripts/lib/svgInliner.mjs'

import { appendLocalHistory, removeGhost, renderAttachmentPreview } from './composer.mjs'
import * as api from './endpoints.mjs'
import { iconElement, icons } from './icons.mjs'
import { appendEntryBubble, backToBottom, nearBottom, renderMessages, scrollMessagesBottom, updateRegenButtons, updateEmptyMode } from './messages.mjs'
import { refreshShutdownState, renderAiSourcePillLabel, renderModePillLabel, selectWorkspace, updateCharMenu } from './pills.mjs'
import { elements, richInput, store, TAB_SAVE_DEBOUNCE, target } from './store.mjs'

/** 标签页保存防抖定时器句柄。 */
let tabSaveTimer = 0
/** 跨页面标签同步频道（另开 code 页面收到后刷新标签列表与活动标签）。 */
const tabsChannel = typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel('fount-code-tabs') : null
/** 本页唯一标识（忽略自身广播）。 */
const pageId = crypto.randomUUID()

/**
 * 标签页唯一键（不含 type：草稿落盘转为会话标签时键保持不变）。
 * @param {{id: string, workspaceId: string}} tab - 标签页。
 * @returns {string} 键。
 */
export function tabKeyOf(tab) {
	return `t:${tab.workspaceId || ''}:${tab.id}`
}

/**
 * 当前活动标签页。
 * @returns {object|null} 标签页。
 */
export function activeTab() {
	return store.tabs.find(tab => tabKeyOf(tab) === store.activeTabKey) || null
}

/**
 * 找到持有某会话对象的标签键。
 * @param {object} session - 会话对象。
 * @returns {string} 标签键（未持有时空串）。
 */
function tabKeyOfSession(session) {
	if (!session) return ''
	const active = activeTab()
	if (active && store.session === session) return tabKeyOf(active)
	for (const tab of store.tabs)
		if (store.sessionCache.get(tabKeyOf(tab)) === session) return tabKeyOf(tab)
	return ''
}

/** 从后端恢复标签页（草稿含未发送内容，跨页面共享）。 */
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

/** 上传当前标签页状态并广播。 */
async function persistTabs() {
	const payload = {
		tabs: store.tabs.map(tab => ({ type: tab.type, id: tab.id, workspaceId: tab.workspaceId, ...typeof tab.draft === 'string' ? { draft: tab.draft } : {} })),
		activeTab: store.activeTabKey,
	}
	await api.putTabs(payload.tabs, payload.activeTab).catch(() => { })
	tabsChannel?.postMessage({ source: pageId, ...payload })
}

/**
 * 应用其他页面广播的标签页状态（保留本地当前标签的未发送草稿，不抢夺活动焦点）。
 * @param {{tabs?: Array<object>, activeTab?: string}} data - 广播负载。
 * @returns {Promise<void>}
 */
async function applyRemoteTabs({ tabs, activeTab: remoteActive } = {}) {
	if (!Array.isArray(tabs)) return
	const current = activeTab()
	const currentKey = current ? tabKeyOf(current) : ''
	const localDraft = current?.draft
	store.tabs = tabs
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
		void startNewSession()
	}
}

tabsChannel?.addEventListener('message', event => {
	const data = event.data
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
 * 标签页标题。
 * @param {object} tab - 标签页。
 * @returns {string} 标题。
 */
function tabTitle(tab) {
	if (tab.type === 'draft') return geti18n('code.sessions.new')
	const cached = store.sessionCache.get(tabKeyOf(tab))
	const summary = store.allSessions.find(session => session.id === tab.id && session.workspaceId === tab.workspaceId)
	return cached?.title || summary?.title || geti18n('code.sessions.untitled')
}

/**
 * 同步地址栏为当前标签页（不带历史记录）。
 * 仅 session 标签写入 ?workspace=&session=；草稿清空查询参数，
 * 以免 reload 被 boot 当成 `fount run` 的 ?workspace= 语义而多建草稿。
 * @param {object} tab - 当前标签页。
 * @returns {void}
 */
function syncCodeUrl(tab) {
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
		// 标题为工作区/会话动态文本，跳过语种扫描
		title.setAttribute('user-content', '')
		title.textContent = tabTitle(tab)
		main.appendChild(title)
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
export function hideTabContextMenu() {
	tabMenuDismiss?.unbind?.()
	tabMenuDismiss = null
	elements.tabMenu.classList.add('hidden')
}

/**
 * 批量关闭标签：活动标签被移除时落到相邻标签（无标签则新建草稿）。
 * 正在生成的标签会被跳过（避免回复落到已移除标签）。
 * @param {object[]} targets - 待关闭标签。
 * @returns {Promise<void>}
 */
async function closeTabs(targets) {
	const keys = new Set(targets.map(tabKeyOf))
	if (!keys.size) return
	const generatingKey = store.generating && store.generatingSession ? tabKeyOfSession(store.generatingSession) : ''
	const skipped = generatingKey && keys.delete(generatingKey)
	if (!keys.size) {
		if (skipped) showToastI18n('info', 'code.tabs.closeGenerating')
		return
	}
	// 关闭前先落盘待写会话，避免丢失生成外的未保存内容
	if (store.dirtyTabKey && keys.has(store.dirtyTabKey)) await flushSession()
	const activeRemoved = keys.has(store.activeTabKey)
	const activeIndex = store.tabs.findIndex(tab => tabKeyOf(tab) === store.activeTabKey)
	store.tabs = store.tabs.filter(tab => !keys.has(tabKeyOf(tab)))
	for (const key of keys) store.sessionCache.delete(key)
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
 * @returns {Promise<void>}
 */
async function closeOtherTabs(tab) {
	if (tabKeyOf(tab) !== store.activeTabKey) await activateTab(tab)
	await closeTabs(store.tabs.filter(item => tabKeyOf(item) !== tabKeyOf(tab)))
}

/**
 * 关闭目标左侧的全部标签。
 * @param {object} tab - 基准标签。
 * @returns {Promise<void>}
 */
async function closeTabsToLeft(tab) {
	const index = store.tabs.indexOf(tab)
	if (index <= 0) return
	await closeTabs(store.tabs.slice(0, index))
}

/**
 * 关闭目标右侧的全部标签。
 * @param {object} tab - 基准标签。
 * @returns {Promise<void>}
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
 * @returns {Promise<void>}
 */
async function renameTab(tab) {
	if (tab.type !== 'session') return
	const workspace = store.workspaces.find(w => w.id === tab.workspaceId)
	if (!workspace) return
	const key = tabKeyOf(tab)
	let session = store.sessionCache.get(key) || (key === store.activeTabKey ? store.session : null)
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
	store.sessionCache.set(key, session)
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
 * 会话相对时间展示。
 * @param {string} iso - ISO 时间串。
 * @returns {string} 展示文案。
 */
export function formatSessionTime(iso) {
	if (!iso) return ''
	const date = new Date(iso)
	if (isNaN(date.getTime())) return ''
	const now = new Date()
	if (date.toDateString() === now.toDateString()) return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
	const yesterday = new Date(now)
	yesterday.setDate(now.getDate() - 1)
	if (date.toDateString() === yesterday.toDateString()) return geti18n('code.sessions.yesterday')
	return date.toLocaleDateString([], { month: '2-digit', day: '2-digit' })
}

/**
 * 新会话空会话工厂。
 * @param {string} [id] - 会话 id（草稿标签预生成时传入）。
 * @returns {object} 会话对象。
 */
export function newSessionObject(id = crypto.randomUUID().slice(0, 8)) {
	const now = new Date().toISOString()
	return {
		id,
		title: '',
		charname: store.charname || '',
		profile: store.profile,
		ai_source: store.aiSource,
		workspaceId: store.workspace?.id || '',
		created: now,
		updated: now,
		memory: {},
		entries: [],
	}
}

/** 刷新跨工作区会话聚合（总览弹窗 / 标签标题）。 */
export async function refreshAllSessions() {
	try {
		store.allSessions = (await api.listAllSessions()).sessions
	}
	catch {
		store.allSessions = []
	}
}

/**
 * 永久删除会话（确认后关闭其标签并删除磁盘文件）。
 * @param {object} session - 聚合会话摘要（含 id / workspaceId / title）。
 * @returns {Promise<boolean>} 是否已删除。
 */
export async function deleteSessionPermanently(session) {
	const title = session.title || geti18n('code.sessions.untitled')
	if (!await confirmAction('code.sessions.deleteConfirm', { title })) return false
	const tab = store.tabs.find(item => item.type === 'session' && item.id === session.id && item.workspaceId === session.workspaceId)
	if (tab) {
		if (store.generating && store.generatingSession && tabKeyOfSession(store.generatingSession) === tabKeyOf(tab)) {
			showToastI18n('info', 'code.tabs.closeGenerating')
			return false
		}
		await closeTab(tab, { discard: true })
	}
	const workspace = store.workspaces.find(w => w.id === session.workspaceId)
	if (workspace)
		try {
			await api.deleteSession({ machine: String(workspace.machine ?? store.machine), workdir: workspace.path }, session.id)
		}
		catch (error) {
			showToastI18n('error', 'code.error.generic', { error: String(error.message || error) })
			return false
		}
	await refreshAllSessions()
	showToastI18n('success', 'code.sessions.deleted')
	return true
}

/**
 * 打开（或聚焦）一个会话标签。
 * @param {object} summary - 聚合会话摘要（含 workspaceId）。
 * @returns {Promise<void>}
 */
export async function openSessionTab(summary) {
	let tab = store.tabs.find(item => item.type === 'session' && item.id === summary.id && item.workspaceId === summary.workspaceId)
	if (!tab) {
		tab = { type: 'session', id: summary.id, workspaceId: summary.workspaceId }
		store.tabs.push(tab)
	}
	await activateTab(tab)
}

/** 新建会话：总是新建一个草稿标签（允许多个未开启正式对话的标签并存），默认在上一个对话的工作区。 */
export async function startNewSession() {
	const workspaceId = [store.session?.workspaceId, store.lastConversationWorkspaceId, store.workspace?.id]
		.find(id => id && store.workspaces.some(w => w.id === id)) || ''
	await activateTab(createDraftTab(workspaceId))
}

/**
 * 关闭标签页（脏会话先落盘，活动标签关闭后切相邻 / 回落草稿）。
 * 生成中的标签不可关闭；`discard` 用于「删除对话」——跳过落盘，避免把已删文件写回。
 * @param {object} tab - 目标标签页。
 * @param {{discard?: boolean}} [options] - 关闭选项。
 * @returns {Promise<void>}
 */
export async function closeTab(tab, { discard = false } = {}) {
	const key = tabKeyOf(tab)
	if (store.generating && store.generatingSession && tabKeyOfSession(store.generatingSession) === key) {
		showToastI18n('info', 'code.tabs.closeGenerating')
		return
	}
	if (discard && store.dirtyTabKey === key) store.dirtyTabKey = ''
	if (key === store.activeTabKey) {
		const index = store.tabs.indexOf(tab)
		const next = store.tabs[index + 1] || store.tabs[index - 1]
		if (next) await activateTab(next)
		else {
			if (store.session) store.sessionCache.set(key, store.session)
			store.session = null
			store.activeTabKey = ''
		}
	}
	if (store.dirtyTabKey === key) await flushSession()
	store.tabs = store.tabs.filter(item => tabKeyOf(item) !== key)
	store.sessionCache.delete(key)
	renderTabs()
	saveTabPrefs()
	if (!store.activeTabKey || !activeTab()) await startNewSession()
}

/**
 * 激活标签页：缓存当前会话、按需切换工作区、加载目标会话并渲染。
 * @param {object} tab - 目标标签页。
 * @returns {Promise<void>}
 */
export async function activateTab(tab) {
	const key = tabKeyOf(tab)
	if (key === store.activeTabKey && store.session) return
	const current = activeTab()
	if (current && tabKeyOf(current) !== key) {
		if (store.session) {
			store.sessionCache.set(tabKeyOf(current), store.session)
			// 后台生成：移除当前视图的流式气泡（切回时重建）
			if (store.generating && store.generatingSession === store.session) endGeneratingBubble()
		}
		// 未发送草稿跟随标签（空草稿也保留，允许多个草稿标签并存）
		current.draft = richInput.value
	}
	if (tab.workspaceId && tab.workspaceId !== store.workspace?.id)
		await selectWorkspace(tab.workspaceId, { fromTabSwitch: true })
	store.session = tab.type === 'draft'
		? store.sessionCache.get(key) || newSessionObject(tab.id)
		: await loadTabSession(tab)
	if (tab.type === 'session' && !store.session) {
		// 会话已不存在：移除标签并回落草稿
		store.tabs = store.tabs.filter(item => tabKeyOf(item) !== key)
		store.activeTabKey = ''
		renderTabs()
		await startNewSession()
		return
	}
	if (store.session) {
		store.session.workspaceId = store.workspace?.id || ''
		store.sessionCache.set(key, store.session)
		store.lastConversationWorkspaceId = store.workspace?.id
	}
	store.activeTabKey = key
	store.tabUnread.delete(key)
	store.charname = store.session?.charname || store.charname
	store.aiSource = store.session?.ai_source ?? ''
	store.profile = store.session?.profile || store.profile
	restoreTabDraft(tab)
	syncCodeUrl(tab)
	renderTabs()
	renderMessages()
	updateCharMenu()
	renderModePillLabel()
	renderAiSourcePillLabel()
	saveTabPrefs()
	// 切回生成中的会话：重建流式气泡
	if (store.generating && store.generatingSession === store.session) startGeneratingBubble()
}

/**
 * 恢复标签的未发送草稿到 composer（空草稿清空输入框）。
 * @param {object} tab - 标签页。
 * @returns {void}
 */
export function restoreTabDraft(tab) {
	richInput.value = tab?.draft || ''
	store.historyNav.pos = null
	removeGhost()
}

/** 将当前 composer 内容写入活动标签的草稿（未发送内容随标签持久化到后端）。 */
export function syncActiveTabDraft() {
	const tab = activeTab()
	if (!tab) return
	tab.draft = richInput.value
	saveTabPrefs()
}

/**
 * 加载会话标签的会话对象（内存缓存优先，回退目标工作区磁盘）。
 * @param {object} tab - 会话标签。
 * @returns {Promise<object|null>} 会话对象。
 */
async function loadTabSession(tab) {
	const key = tabKeyOf(tab)
	const cached = store.sessionCache.get(key)
	if (cached) return cached
	try {
		return await api.loadSession(target(), tab.id)
	}
	catch {
		return store.allSessions.find(s => s.id === tab.id && s.workspaceId === store.workspace?.id) || null
	}
}

/**
 * 切到工作区的草稿标签（无则新建）——工作区 pill 切换的落点。
 * 当前活动为空草稿时直接改绑到目标工作区，避免选择工作区时残留无工作区占位草稿。
 * @param {string} workspaceId - 工作区 id。
 * @returns {Promise<void>}
 */
export async function activateDraftForWorkspace(workspaceId) {
	const draft = store.tabs.find(tab => tab.type === 'draft' && tab.workspaceId === workspaceId)
	if (draft) return activateTab(draft)
	const current = activeTab()
	if (current?.type === 'draft' && !current.draft && !store.session?.entries?.length) {
		current.workspaceId = workspaceId
		return activateTab(current)
	}
	return activateTab(createDraftTab(workspaceId))
}

/* ---------------- 缓存 flush ---------------- */

/**
 * 标记会话为待持久化；焦点已移出窗口且无生成任务时立即写盘。
 * 草稿一旦可落盘即转为会话标签（防关闭丢失）。无工作区时会话无处落盘，跳过。
 * @param {object} [session] - 目标会话（默认当前展示会话；后台生成时传入）。
 * @returns {Promise<void>|undefined} 已触发落盘时返回其 promise。
 */
export function markSessionDirty(session = store.session) {
	const key = tabKeyOfSession(session)
	if (!key) return
	store.dirtyTabKey = key
	const tab = store.tabs.find(item => tabKeyOf(item) === key)
	if (!tab) return
	const workspace = store.workspaces.find(w => w.id === tab.workspaceId)
	if (!workspace) return
	if (tab.type === 'draft') {
		tab.type = 'session'
		if (key === store.activeTabKey) syncCodeUrl(tab)
		renderTabs()
		saveTabPrefs()
	}
	// 非生成时标记即落盘（AGENTS 约定），保证总览/标签标题及时可见
	if (!store.generating) return flushSession()
}

/** 持久化待写标签的会话到其工作区 `.fount/code/sessions`（生成中、无变更、无工作区时跳过）。 */
export async function flushSession() {
	const key = store.dirtyTabKey
	if (!key || store.generating) return
	store.dirtyTabKey = ''
	const tab = store.tabs.find(item => tabKeyOf(item) === key)
	// 活动标签判空后直接比较 store.activeTabKey，不向 tabKeyOf 传空对象兜底
	const session = store.activeTabKey === key ? store.session : store.sessionCache.get(key)
	const workspace = tab && store.workspaces.find(w => w.id === tab.workspaceId)
	if (!session || !workspace || !(session.entries?.length || 0)) return
	try {
		await api.putSession({ machine: String(workspace.machine ?? store.machine), workdir: workspace.path }, session)
	}
	catch (error) {
		store.dirtyTabKey = key
		showToastI18n('error', 'code.error.generic', { error: String(error.message || error) })
	}
}

window.addEventListener('blur', () => {
	void flushSession()
	flushTabPrefs()
})
document.addEventListener('visibilitychange', () => {
	if (document.hidden) {
		void flushSession()
		flushTabPrefs()
	}
})
window.addEventListener('beforeunload', () => {
	flushTabPrefs()
	if (!store.dirtyTabKey || store.generating) return
	const tab = store.tabs.find(item => tabKeyOf(item) === store.dirtyTabKey)
	const unloadingActive = activeTab()
	const session = unloadingActive && tabKeyOf(unloadingActive) === store.dirtyTabKey ? store.session : store.sessionCache.get(store.dirtyTabKey)
	const workspace = tab && store.workspaces.find(w => w.id === tab.workspaceId)
	if (session && workspace && (session.entries?.length || 0))
		api.putSession({ machine: String(workspace.machine ?? store.machine), workdir: workspace.path }, session).catch(() => { })
})

/* ---------------- 发送 / 生成 ---------------- */

let socket = null
/** 连接建立中的共享等待 Promise（并发调用者复用，连接成功后/失败/关闭时清理）。 */
let socketOpening = null

/**
 * 获取（懒建立）会话 WebSocket。
 * 仅 OPEN 状态直接复用；CONNECTING 期间并发调用者共享同一个等待 Promise，连接成功后 resolve。
 * @returns {Promise<WebSocket>} 连接。
 */
function getSocket() {
	if (socket?.readyState === WebSocket.OPEN) return Promise.resolve(socket)
	if (socketOpening) return socketOpening
	socketOpening = new Promise((resolve, reject) => {
		const protocol = location.protocol === 'https:' ? 'wss' : 'ws'
		const ws = new WebSocket(`${protocol}://${location.host}/ws/parts/shells:code/session`)
		socket = ws
		let opened = false
		ws.addEventListener('open', () => {
			opened = true
			socketOpening = null
			resolve(ws)
		}, { once: true })
		ws.addEventListener('error', () => {
			socketOpening = null
			reject(new Error('websocket failed'))
		}, { once: true })
		ws.addEventListener('close', () => {
			if (socket !== ws) return
			socketOpening = null
			// 尚未连上即断开 = 连接失败（error 分支已 reject；此处兜底覆盖无 error 直接 close 的情形）
			if (opened) handleSocketClose()
			else reject(new Error('websocket failed'))
		})
		ws.addEventListener('message', onSocketMessage)
	})
	return socketOpening
}

/** socket 断开：结束生成气泡、复位生成态并更新发送按钮（防止流式气泡/停止按钮悬挂）。 */
function handleSocketClose() {
	const interrupted = store.generating
	endGeneratingBubble()
	store.generating = false
	store.generatingSession = null
	updateSendButton()
	if (interrupted) {
		updateEmptyMode()
		showToastI18n('error', 'code.error.generate')
	}
}

/**
 * socket 消息处理。
 * @param {MessageEvent} event - 消息事件。
 * @returns {void}
 */
function onSocketMessage(event) {
	const msg = JSON.parse(String(event.data))
	if (msg.type === 'preview') {
		if (store.generatingSession === store.session && generatingBubble?.renderer) generatingBubble.renderer.setTarget(msg.content)
		return
	}
	if (msg.type === 'done') {
		void finishGeneration(msg.entries, msg.memory)
		return
	}
	if (msg.type === 'aborted') {
		void finishGeneration(msg.entries, null, true)
		return
	}
	if (msg.type === 'error') {
		const session = store.generatingSession || store.session
		store.generatingSession = null
		store.generating = false
		endGeneratingBubble()
		// 复位发送按钮（内部同步刷新 regen 按钮），与 finishGeneration 的收尾对齐
		updateSendButton()
		const fallback = geti18n('code.error.generate')
		const text = `${fallback}\n\`\`\`\n${msg.error}\n\`\`\``
		const knownIds = new Set((session?.entries || []).map(entry => String(entry.id)))
		const freshEntries = (msg.entries || []).filter(entry => !knownIds.has(String(entry.id)))
		const errorEntry = { id: crypto.randomUUID().slice(0, 8), uid: 'system', role: 'system', name: 'error', content: text, time: new Date().toISOString() }
		session?.entries.push(...freshEntries, errorEntry)
		if (session === store.session)
			for (const entry of [...freshEntries, errorEntry]) appendEntryBubble(entry)
		markSessionDirty(session)
	}
}

/** 生成中的气泡与流式渲染器。 */
let generatingBubble = null

/** 创建生成中的流式气泡。 */
export function startGeneratingBubble() {
	const bubble = document.createElement('div')
	bubble.className = 'code-message role-char generating'
	bubble.setAttribute('user-content', '')
	const name = document.createElement('div')
	name.className = 'code-message-name'
	name.textContent = store.session?.charname || ''
	const body = document.createElement('div')
	body.className = 'code-message-body'
	bubble.append(name, body)
	elements.messages.insertBefore(bubble, backToBottom)
	updateEmptyMode()
	if (nearBottom()) scrollMessagesBottom()
	generatingBubble = { bubble, renderer: new StreamRenderer(body, { allowDangerousHtml: false }) }
}

/** 移除生成中的气泡。 */
export function endGeneratingBubble() {
	generatingBubble?.bubble.remove()
	generatingBubble = null
}

/**
 * 结束生成：以服务端条目替换流式气泡。
 * @param {object[]} entries - 服务端返回的新条目（含用户消息与 tool 日志）。
 * @param {object|null} memory - 会话记忆。
 * @param {boolean} [aborted=false] - 是否被中断。
 * @returns {Promise<void>}
 */
async function finishGeneration(entries, memory, aborted = false) {
	endGeneratingBubble()
	const session = store.generatingSession || store.session
	store.generatingSession = null
	if (!session) return
	const isActive = session === store.session
	// 乐观回显的用户条目 id 可能与服务端回传重复，按 id 去重
	const knownIds = new Set(session.entries.map(entry => String(entry.id)))
	const freshEntries = entries.filter(entry => !knownIds.has(String(entry.id)))
	session.entries.push(...freshEntries)
	if (memory) session.memory = memory
	session.updated = new Date().toISOString()
	if (!session.title && session.entries.length)
		session.title = (session.entries.find(e => e.role === 'user')?.content || '').slice(0, 40) || session.title
	store.generating = false
	updateSendButton()
	if (isActive) {
		for (const entry of freshEntries) appendEntryBubble(entry)
		if (aborted) showToastI18n('info', 'code.error.aborted')
	}
	await markSessionDirty(session)
	renderTabs()
	void refreshAllSessions()
	void refreshShutdownState()
}

/** 更新发送按钮（生成中变停止图标）。 */
export function updateSendButton() {
	const stop = store.generating
	elements.sendButton.classList.toggle('btn-error', stop)
	elements.sendButton.classList.toggle('btn-primary', !stop)
	elements.sendButton.setAttribute('aria-label', geti18n(stop ? 'code.composer.stopAria' : 'code.composer.sendAria'))
	document.getElementById('send-icon')?.replaceWith(iconElement(stop ? icons.stop : icons.send, { size: 16, id: 'send-icon' }))
	void svgInliner(elements.sendButton)
	updateRegenButtons()
}

/** 中断当前生成（发送按钮停止态）。 */
export function abortGeneration() {
	void getSocket().then(ws => ws.send(JSON.stringify({ type: 'abort' }))).catch(() => { })
}

/**
 * 重新生成最后一条角色消息（弹出后走 WS regen，流式预览复用生成中气泡）。
 * @returns {Promise<void>}
 */
export async function regenerateLastReply() {
	const session = store.session
	if (!session || store.generating) return
	const last = session.entries.at(-1)
	if (last?.role !== 'char') return
	if (!session.charname) {
		showToastI18n('error', 'code.error.noChar')
		return
	}
	session.entries.pop()
	renderMessages()
	store.generating = true
	store.generatingSession = session
	updateSendButton()
	startGeneratingBubble()
	markSessionDirty(session)
	try {
		const ws = await getSocket()
		ws.send(JSON.stringify({
			type: 'regen',
			session,
			...target(),
			ai_source: store.aiSource || '',
			profile: store.profile,
		}))
	}
	catch (error) {
		store.generating = false
		endGeneratingBubble()
		store.generatingSession = null
		// 请求未送达服务端，旧回复原样放回
		session.entries.push(last)
		renderMessages()
		updateSendButton()
		showToastI18n('error', 'code.error.generic', { error: String(error.message || error) })
	}
}

/** 消息中的 `@[gist:id]` token。 */
const GIST_TOKEN_RE = /@\[gist:([^\]\n]+)\]/g

/**
 * 展开消息中的 gist token：拉取正文并构造附件（发送时随用户消息送给角色）。
 * @param {string} content - 消息原文。
 * @returns {Promise<Array<{name: string, mime_type: string, buffer: string, description: string}>>} 附件列表。
 */
async function resolveGistAttachments(content) {
	const ids = [...new Set([...content.matchAll(GIST_TOKEN_RE)].map(match => match[1]))]
	const files = []
	for (const id of ids) {
		const gist = await getGist(id).catch(() => null)
		if (!gist) continue
		const name = `${String(gist.title || gist.id).replace(/[\r\n]+/g, ' ').trim().slice(0, 80)}.md`
		files.push({
			name,
			mime_type: 'text/markdown',
			buffer: arrayBufferToBase64(new TextEncoder().encode(gist.markdown || '')),
			description: '',
		})
	}
	return files
}

/**
 * 发送消息（AI 会话）。
 * @param {string} content - 消息内容。
 * @returns {Promise<void>}
 */
export async function sendMessage(content) {
	if (!content?.trim() || store.generating) return
	if (!store.session) await startNewSession()
	store.session.charname = store.charname || store.session.charname
	if (!store.session.charname) {
		showToastI18n('error', 'code.error.noChar')
		return
	}
	store.session.profile = store.profile
	store.session.ai_source = store.aiSource
	store.generatingSession = store.session
	appendLocalHistory('message', content)
	try {
		const gistFiles = await resolveGistAttachments(content)
		const files = [...store.pendingFiles, ...gistFiles]
		// 乐观插入用户条目并立即回显；WS 带 clientEntryId，服务端据此去重、不再回传用户消息
		const userEntry = {
			id: crypto.randomUUID().slice(0, 8),
			uid: 'user',
			role: 'user',
			name: store.username,
			content,
			time: new Date().toISOString(),
			files: files.map(file => ({ ...file })),
		}
		store.session.entries.push(userEntry)
		appendEntryBubble(userEntry)
		store.pendingFiles = []
		renderAttachmentPreview()
		store.generating = true
		updateSendButton()
		startGeneratingBubble()
		markSessionDirty(store.session)
		const ws = await getSocket()
		ws.send(JSON.stringify({
			type: 'send',
			session: store.session,
			...target(),
			ai_source: store.aiSource || '',
			profile: store.profile,
			content,
			files,
			clientEntryId: userEntry.id,
		}))
	}
	catch (error) {
		store.generating = false
		endGeneratingBubble()
		store.generatingSession = null
		updateSendButton()
		showToastI18n('error', 'code.error.generic', { error: String(error.message || error) })
	}
}

/**
 * `!` shell 模式执行。
 * @param {string} command - 命令。
 * @returns {Promise<void>}
 */
export async function execShellMode(command) {
	appendLocalHistory('shell', command)
	if (!store.session) await startNewSession()
	const userEntry = {
		id: crypto.randomUUID().slice(0, 8),
		uid: 'user',
		role: 'user',
		name: store.username,
		content: '```' + (store.shell || '') + '\n' + command + '\n```',
		time: new Date().toISOString(),
	}
	store.session.entries.push(userEntry)
	appendEntryBubble(userEntry)
	const result = await api.execShell({ ...target(), shell: store.shell || undefined, command })
	const output = result.stdall ?? [result.stdout, result.stderr].filter(Boolean).join('\n')
	const elapsedText = Number(result.elapsedMs) > 0 ? `（耗时 ${(result.elapsedMs / 1000).toFixed(2)}s）` : ''
	const toolEntry = {
		id: crypto.randomUUID().slice(0, 8),
		uid: 'system',
		role: 'tool',
		name: 'shell',
		content: '```' + (store.shell || '') + '\n' + command + '\n```\n```\n' + output + '\n```' + elapsedText,
		time: new Date().toISOString(),
	}
	store.session.entries.push(toolEntry)
	appendEntryBubble(toolEntry)
	store.session.updated = new Date().toISOString()
	// 先等会话落盘完成再刷新聚合，避免总览/标签标题读到旧状态
	await markSessionDirty()
	void refreshAllSessions()
}

/**
 * 将 suppressed 通知对应到 code session tab 的角标。
 * @param {object} payload 通知载荷（含 tag，格式 code:<sessionId>）
 * @returns {void}
 */
export function bumpCodeSessionNotification(payload) {
	const tag = payload?.options?.tag || payload?.tag
	if (!tag || !tag.startsWith('code:')) return
	const sessionId = tag.slice('code:'.length)
	if (!sessionId) return
	const tab = store.tabs.find(t => t.type === 'session' && t.id === sessionId)
	if (!tab) return
	const key = tabKeyOf(tab)
	// 若当前正在看这个 tab，则无需角标
	if (key === store.activeTabKey) return
	store.tabUnread.add(key)
	renderTabs()
}
