/**
 * 会话生命周期：标签条 / 工作区会话 / WebSocket 流式生成 / 落盘 flush / 发送与重新生成。
 */
import { StreamRenderer } from '/parts/shells:chat/src/ui/StreamRenderer.mjs'

import { showToastI18n } from '/scripts/features/toast.mjs'
import { geti18n } from '/scripts/i18n/index.mjs'

import { appendLocalHistory, removeGhost, renderAttachmentPreview } from './composer.mjs'
import * as api from './endpoints.mjs'
import { appendEntryBubble, backToBottom, nearBottom, renderMessages, scrollMessagesBottom, updateRegenButtons, updateEmptyMode } from './messages.mjs'
import { openFolderBrowser, renderAiSourcePillLabel, renderModePillLabel, selectWorkspace, updateCharMenu } from './pills.mjs'
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

/** 新建标签按钮（由 renderTabs 渲染在最后一个标签右侧，随标签条滚动）。 */
const newTabButton = (() => {
	const button = document.createElement('button')
	button.type = 'button'
	button.id = 'new-tab-button'
	button.className = 'btn btn-ghost btn-square btn-sm'
	button.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 5v14"></path><path d="M5 12h14"></path></svg>'
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
			icon.innerHTML = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 20h9"></path><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"></path></svg>'
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
		close.innerHTML = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M18 6 6 18"></path><path d="m6 6 12 12"></path></svg>'
		close.addEventListener('click', event => {
			event.stopPropagation()
			void closeTab(tab)
		})
		wrap.append(main, close)
		return wrap
	}), newTabButton)
}

/** 渲染左上角总览菜单（工作区分组会话一览 + 浏览工作区）。 */
export function renderHomeMenu() {
	const menu = elements.homeMenu
	menu.replaceChildren()
	for (const workspace of store.workspaces) {
		const headerLi = document.createElement('li')
		const header = document.createElement('div')
		header.className = 'menu-title'
		header.textContent = workspace.name || workspace.path
		headerLi.appendChild(header)
		menu.appendChild(headerLi)
		const sessions = store.allSessions.filter(session => session.workspaceId === workspace.id).slice(0, 8)
		if (!sessions.length) {
			const emptyLi = document.createElement('li')
			const empty = document.createElement('div')
			empty.className = 'opacity-60 text-xs px-4 py-1'
			empty.textContent = geti18n('code.workspaces.overviewEmpty')
			emptyLi.appendChild(empty)
			menu.appendChild(emptyLi)
		}
		else for (const session of sessions) {
			const li = document.createElement('li')
			const button = document.createElement('button')
			button.type = 'button'
			button.className = 'menu-item' + (session.id === store.session?.id && session.workspaceId === store.workspace?.id ? ' active' : '')
			const title = document.createElement('span')
			title.className = 'menu-item-title'
			title.setAttribute('user-content', '')
			title.textContent = session.title || geti18n('code.sessions.untitled')
			const time = document.createElement('span')
			time.className = 'opacity-60 text-xs'
			time.textContent = formatSessionTime(session.updated || session.created)
			button.append(title, time)
			button.addEventListener('click', () => {
				document.activeElement?.blur()
				void openSessionTab(session)
			})
			li.appendChild(button)
			menu.appendChild(li)
		}
	}
	const separatorLi = document.createElement('li')
	const separator = document.createElement('div')
	separator.className = 'divider my-1'
	separatorLi.appendChild(separator)
	menu.appendChild(separatorLi)
	const browseLi = document.createElement('li')
	const browseBtn = document.createElement('button')
	browseBtn.type = 'button'
	browseBtn.className = 'menu-item'
	browseBtn.textContent = geti18n('code.workspaces.browse')
	browseBtn.addEventListener('click', () => {
		document.activeElement?.blur()
		void openFolderBrowser()
	})
	browseLi.appendChild(browseBtn)
	menu.appendChild(browseLi)
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

/**
 * 会话相对时间展示。
 * @param {string} iso - ISO 时间串。
 * @returns {string} 展示文案。
 */
function formatSessionTime(iso) {
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

/** 刷新跨工作区会话聚合（总览菜单 / 标签标题）。 */
export async function refreshAllSessions() {
	try {
		store.allSessions = (await api.listAllSessions()).sessions
	}
	catch {
		store.allSessions = []
	}
}

/**
 * 打开（或聚焦）一个会话标签。
 * @param {object} summary - 聚合会话摘要（含 workspaceId）。
 * @returns {Promise<void>}
 */
async function openSessionTab(summary) {
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
 * @param {object} tab - 目标标签页。
 * @returns {Promise<void>}
 */
export async function closeTab(tab) {
	const key = tabKeyOf(tab)
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
	store.charname = store.session?.charname || store.charname
	store.aiSource = store.session?.ai_source ?? ''
	store.profile = store.session?.profile || store.profile
	restoreTabDraft(tab)
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
	const session = tabKeyOf(activeTab() || {}) === key ? store.session : store.sessionCache.get(key)
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
	const session = tabKeyOf(activeTab() || {}) === store.dirtyTabKey ? store.session : store.sessionCache.get(store.dirtyTabKey)
	const workspace = tab && store.workspaces.find(w => w.id === tab.workspaceId)
	if (session && workspace && (session.entries?.length || 0))
		api.putSession({ machine: String(workspace.machine ?? store.machine), workdir: workspace.path }, session).catch(() => { })
})

/* ---------------- 发送 / 生成 ---------------- */

let socket = null

/**
 * 获取（懒建立）会话 WebSocket。
 * @returns {Promise<WebSocket>} 连接。
 */
function getSocket() {
	if (socket && socket.readyState <= WebSocket.OPEN) return Promise.resolve(socket)
	return new Promise((resolve, reject) => {
		const protocol = location.protocol === 'https:' ? 'wss' : 'ws'
		socket = new WebSocket(`${protocol}://${location.host}/ws/parts/shells:code/session`)
		socket.addEventListener('open', () => resolve(socket), { once: true })
		socket.addEventListener('error', () => reject(new Error('websocket failed')), { once: true })
		socket.addEventListener('message', onSocketMessage)
	})
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
		store.generating = false
		endGeneratingBubble()
		const fallback = geti18n('code.error.generate')
		const text = `${fallback}\n\`\`\`\n${msg.error}\n\`\`\``
		session?.entries.push(...msg.entries || [], { id: crypto.randomUUID().slice(0, 8), uid: 'system', role: 'system', name: 'error', content: text, time: new Date().toISOString() })
		if (session === store.session)
			for (const entry of session.entries.slice(-((msg.entries || []).length + 1))) appendEntryBubble(entry)
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
	session.entries.push(...entries)
	if (memory) session.memory = memory
	session.updated = new Date().toISOString()
	if (!session.title && entries.length)
		session.title = (entries.find(e => e.role === 'user')?.content || '').slice(0, 40) || session.title
	store.generating = false
	updateSendButton()
	if (isActive) {
		for (const entry of entries) appendEntryBubble(entry)
		if (aborted) showToastI18n('info', 'code.error.aborted')
	}
	await markSessionDirty(session)
	renderTabs()
	void refreshAllSessions()
}

/** 更新发送按钮（生成中变停止图标）。 */
export function updateSendButton() {
	const stop = store.generating
	elements.sendButton.classList.toggle('btn-error', stop)
	elements.sendButton.classList.toggle('btn-primary', !stop)
	elements.sendButton.setAttribute('aria-label', geti18n(stop ? 'code.composer.stopAria' : 'code.composer.sendAria'))
	elements.sendIcon.innerHTML = stop
		? '<rect x="5" y="5" width="14" height="14" rx="2" fill="currentColor" stroke="none"></rect>'
		: '<path d="M12 19V5"></path><path d="M5 12l7-7 7 7"></path>'
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
	store.generating = true
	updateSendButton()
	startGeneratingBubble()
	try {
		const ws = await getSocket()
		ws.send(JSON.stringify({
			type: 'send',
			session: store.session,
			...target(),
			ai_source: store.aiSource || '',
			profile: store.profile,
			content,
			files: store.pendingFiles.slice(),
		}))
		// 已随消息发出（后端并入用户条目）
		store.pendingFiles = []
		renderAttachmentPreview()
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
	const toolEntry = {
		id: crypto.randomUUID().slice(0, 8),
		uid: 'system',
		role: 'tool',
		name: 'shell',
		content: '```' + (store.shell || '') + '\n' + command + '\n```\n```\n' + output + '\n```',
		time: new Date().toISOString(),
	}
	store.session.entries.push(toolEntry)
	appendEntryBubble(toolEntry)
	store.session.updated = new Date().toISOString()
	// 先等会话落盘完成再刷新聚合，避免总览/标签标题读到旧状态
	await markSessionDirty()
	void refreshAllSessions()
}
