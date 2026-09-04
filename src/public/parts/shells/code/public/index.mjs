/**
 * code shell 前端主逻辑：跨工作区会话选择 / 输入历史与影子补全 / 角色覆盖 / pill 选择器 / 空态引导。
 */
import { createMarkdownRichInput } from '../../scripts/components/markdownRichInput.mjs'
import { attachMentionAutocomplete } from '../../scripts/components/mentionAutocomplete.mjs'
import { whoami } from '../../scripts/endpoints/base.mjs'
import { getPartList, getAnyPreferredDefaultPart, runPart } from '../../scripts/endpoints/parts.mjs'
import { handleError } from '../../scripts/features/errorHandlers.mjs'
import { renderMarkdownAsString } from '../../scripts/features/markdown/index.mjs'
import { showToastI18n } from '../../scripts/features/toast.mjs'
import { initTranslations, geti18n, onLanguageChange } from '../../scripts/i18n/index.mjs'
import { applyTheme } from '../../scripts/theme/index.mjs'
import { StreamRenderer } from '/parts/shells:chat/src/ui/StreamRenderer.mjs'

import * as api from './src/endpoints.mjs'
import { openDialogFromTemplate } from './src/templates.mjs'

applyTheme()

/**
 * 按 id 取元素。
 * @param {string} id - 元素 id。
 * @returns {HTMLElement} 元素。
 */
const $ = id => document.getElementById(id)

const elements = {
	homeToggle: $('home-toggle'),
	homeMenu: $('home-menu'),
	tabStrip: $('tab-strip'),
	newTabButton: $('new-tab-button'),
	workspacePill: $('workspace-pill'),
	workspacePillLabel: $('workspace-pill-label'),
	workspaceMenu: $('workspace-menu'),
	machinePill: $('machine-pill'),
	machinePillLabel: $('machine-pill-label'),
	machineMenu: $('machine-menu'),
	charPill: $('char-pill'),
	charPillLabel: $('char-pill-label'),
	charMenu: $('char-menu'),
	charSwitchButton: $('char-switch-button'),
	charSettingsLink: $('char-settings-link'),
	messages: $('messages'),
	composerInput: $('composer-input'),
	modePill: $('mode-pill'),
	modePillLabel: $('mode-pill-label'),
	modeMenu: $('mode-menu'),
	aiSourcePill: $('ai-source-pill'),
	aiSourcePillLabel: $('ai-source-pill-label'),
	aiSourceMenu: $('ai-source-menu'),
	shellPillWrap: $('shell-pill-wrap'),
	shellPill: $('shell-pill'),
	shellPillLabel: $('shell-pill-label'),
	shellMenu: $('shell-menu'),
	sendButton: $('send-button'),
	sendIcon: $('send-icon'),
}

/**
 * 全局状态。
 */
const state = {
	username: '',
	machines: [],
	workspaces: [],
	machine: '0',
	workspace: null,
	allSessions: [],
	session: null,
	tabs: [],
	activeTabKey: '',
	lastConversationWorkspaceId: '',
	profiles: [],
	commands: [],
	aiHidden: [],
	aiDefaults: [],
	profile: 'build',
	aiSources: [],
	aiSource: '',
	charname: null,
	chars: [],
	shells: [],
	shell: '',
	shellMode: false,
	generating: false,
}

/**
 * 输入历史状态（普通消息 / shell 各自独立）。
 */
const historyState = {
	mode: null,
	own: [],
	native: [],
}

/**
 * ↑/↓ 历史导航游标。
 */
const historyNav = { pos: null, draft: '' }

const markdownCache = {}

/**
 * 当前目标（机器 + 工作区路径）。
 * @returns {{machine: string, workdir: string}} 目标。
 */
function target() {
	return { machine: state.machine, workdir: state.workspace?.path || '' }
}

/**
 * localStorage 偏好键前缀。
 * @returns {string} 前缀。
 */
function prefPrefix() {
	return `code.shell.${state.username}.`
}

/**
 * 读取偏好。
 * @param {string} key - 键。
 * @param {string} [fallback=''] - 缺省值。
 * @returns {string} 值。
 */
function getPref(key, fallback = '') {
	return localStorage.getItem(prefPrefix() + key) ?? fallback
}

/**
 * 写偏好。
 * @param {string} key - 键。
 * @param {string} value - 值。
 * @returns {void}
 */
function setPref(key, value) {
	localStorage.setItem(prefPrefix() + key, value)
}

/* ---------------- 标签页（opencode 式顶栏标签） ---------------- */

/**
 * 标签页唯一键（不含 type：草稿落盘转为会话标签时键保持不变）。
 * @param {{id: string, workspaceId: string}} tab - 标签页。
 * @returns {string} 键。
 */
function tabKeyOf(tab) {
	return `t:${tab.workspaceId || ''}:${tab.id}`
}

/**
 * 当前活动标签页。
 * @returns {object|null} 标签页。
 */
function activeTab() {
	return state.tabs.find(tab => tabKeyOf(tab) === state.activeTabKey) || null
}

/** 已打开会话对象的内存缓存（tabKey → session），切换标签不丢未保存内容。 */
const sessionCache = new Map()

/** 正在生成的会话（后台生成时可能与当前展示的会话不同）。 */
let generatingSession = null

/** 待落盘标签键（生成中暂存，完成后/失焦时 flush）。 */
let dirtyTabKey = ''

/**
 * 从 localStorage 恢复标签页（草稿不可持久化，仅恢复会话标签）。
 * @returns {void}
 */
function loadTabPrefs() {
	try {
		const list = JSON.parse(getPref('tabs') || '[]')
		state.tabs = Array.isArray(list) ? list.filter(tab => tab?.type === 'session' && tab.id && tab.workspaceId) : []
	}
	catch {
		state.tabs = []
	}
	state.activeTabKey = getPref('activeTab')
}

/**
 * 持久化标签页列表与活动标签。
 * @returns {void}
 */
function saveTabPrefs() {
	setPref('tabs', JSON.stringify(state.tabs.filter(tab => tab.type === 'session')))
	setPref('activeTab', state.activeTabKey)
}

/**
 * 新建草稿标签页（未保存的新会话）。
 * @param {string} workspaceId - 绑定的工作区 id。
 * @returns {object} 标签页。
 */
function createDraftTab(workspaceId) {
	const tab = { type: 'draft', id: crypto.randomUUID().slice(0, 8), workspaceId: workspaceId || '' }
	state.tabs.push(tab)
	return tab
}

/**
 * 标签页标题。
 * @param {object} tab - 标签页。
 * @returns {string} 标题。
 */
function tabTitle(tab) {
	if (tab.type === 'draft') return geti18n('code.sessions.new')
	const cached = sessionCache.get(tabKeyOf(tab))
	const summary = state.allSessions.find(session => session.id === tab.id && session.workspaceId === tab.workspaceId)
	return cached?.title || summary?.title || geti18n('code.sessions.untitled')
}

/**
 * 渲染标签条（活动态高亮 / hover 关闭钮 / 中键关闭）。
 * @returns {void}
 */
function renderTabs() {
	elements.tabStrip.replaceChildren(...state.tabs.map(tab => {
		const key = tabKeyOf(tab)
		const wrap = document.createElement('div')
		wrap.className = 'code-tab'
		wrap.dataset.tabKey = key
		wrap.setAttribute('data-active', String(key === state.activeTabKey))
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
			const workspace = state.workspaces.find(w => w.id === tab.workspaceId)
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
	}))
	saveTabPrefs()
}

/**
 * 渲染左上角总览菜单（工作区分组会话一览 + 浏览工作区）。
 * @returns {void}
 */
function renderHomeMenu() {
	const menu = elements.homeMenu
	menu.replaceChildren()
	for (const workspace of state.workspaces) {
		const headerLi = document.createElement('li')
		const header = document.createElement('div')
		header.className = 'menu-title'
		header.textContent = workspace.name || workspace.path
		headerLi.appendChild(header)
		menu.appendChild(headerLi)
		const sessions = state.allSessions.filter(session => session.workspaceId === workspace.id).slice(0, 8)
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
			button.className = 'menu-item' + (session.id === state.session?.id && session.workspaceId === state.workspace?.id ? ' active' : '')
			const title = document.createElement('span')
			title.className = 'menu-item-title'
			// 会话标题为用户数据
			title.setAttribute('user-content', '')
			title.textContent = session.title || geti18n('code.sessions.untitled')
			const time = document.createElement('span')
			time.className = 'opacity-60 text-xs'
			time.textContent = formatSessionTime(session.updated || session.created)
			button.appendChild(title)
			button.appendChild(time)
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
function newSessionObject(id = crypto.randomUUID().slice(0, 8)) {
	const now = new Date().toISOString()
	return {
		id,
		title: '',
		charname: state.charname || '',
		profile: state.profile,
		ai_source: state.aiSource,
		workspaceId: state.workspace?.id || '',
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
	const now = new Date()
	if (isNaN(date.getTime())) return ''
	const sameDay = date.toDateString() === now.toDateString()
	if (sameDay) return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
	const yesterday = new Date(now)
	yesterday.setDate(now.getDate() - 1)
	if (date.toDateString() === yesterday.toDateString()) return geti18n('code.sessions.yesterday')
	return date.toLocaleDateString([], { month: '2-digit', day: '2-digit' })
}

/**
 * 刷新跨工作区会话聚合（总览菜单 / 标签标题）。
 * @returns {Promise<void>}
 */
async function refreshAllSessions() {
	try {
		state.allSessions = (await api.listAllSessions()).sessions
	}
	catch {
		state.allSessions = []
	}
}

/**
 * 找到持有某会话对象的标签键。
 * @param {object} session - 会话对象。
 * @returns {string} 标签键（未持有时空串）。
 */
function tabKeyOfSession(session) {
	if (!session) return ''
	const active = activeTab()
	if (active && state.session === session) return tabKeyOf(active)
	for (const tab of state.tabs)
		if (sessionCache.get(tabKeyOf(tab)) === session) return tabKeyOf(tab)
	return ''
}

/**
 * 打开（或聚焦）一个会话标签。
 * @param {object} summary - 聚合会话摘要（含 workspaceId）。
 * @returns {Promise<void>}
 */
async function openSessionTab(summary) {
	let tab = state.tabs.find(item => item.type === 'session' && item.id === summary.id && item.workspaceId === summary.workspaceId)
	if (!tab) {
		tab = { type: 'session', id: summary.id, workspaceId: summary.workspaceId }
		state.tabs.push(tab)
	}
	await activateTab(tab)
}

/**
 * 新建会话：活动空草稿直接聚焦；否则新建草稿标签（默认在上一个对话的工作区）。
 * @returns {Promise<void>}
 */
async function startNewSession() {
	const active = activeTab()
	if (active?.type === 'draft' && !state.session?.entries?.length) {
		elements.composerInput.focus()
		return
	}
	const workspaceId = [state.session?.workspaceId, state.lastConversationWorkspaceId, state.workspace?.id]
		.find(id => id && state.workspaces.some(w => w.id === id)) || ''
	await activateTab(createDraftTab(workspaceId))
}

/**
 * 关闭标签页（脏会话先落盘，活动标签关闭后切相邻 / 回落草稿）。
 * @param {object} tab - 目标标签页。
 * @returns {Promise<void>}
 */
async function closeTab(tab) {
	const key = tabKeyOf(tab)
	if (key === state.activeTabKey) {
		const index = state.tabs.indexOf(tab)
		const next = state.tabs[index + 1] || state.tabs[index - 1]
		if (next) await activateTab(next)
		else {
			if (state.session) sessionCache.set(key, state.session)
			state.session = null
			state.activeTabKey = ''
		}
	}
	if (dirtyTabKey === key) await flushSession()
	state.tabs = state.tabs.filter(item => tabKeyOf(item) !== key)
	sessionCache.delete(key)
	renderTabs()
	if (!state.activeTabKey || !activeTab()) await startNewSession()
}

/**
 * 激活标签页：缓存当前会话、按需切换工作区、加载目标会话并渲染。
 * @param {object} tab - 目标标签页。
 * @returns {Promise<void>}
 */
async function activateTab(tab) {
	const key = tabKeyOf(tab)
	if (key === state.activeTabKey && state.session) return
	const current = activeTab()
	if (current && tabKeyOf(current) !== key) {
		if (state.session) {
			sessionCache.set(tabKeyOf(current), state.session)
			// 后台生成：移除当前视图的流式气泡（切回时重建）
			if (state.generating && generatingSession === state.session) endGeneratingBubble()
		}
		// 空草稿离开即丢弃
		if (current.type === 'draft' && !state.session?.entries?.length)
			state.tabs = state.tabs.filter(item => tabKeyOf(item) !== tabKeyOf(current))
	}
	if (tab.workspaceId && tab.workspaceId !== state.workspace?.id)
		await selectWorkspace(tab.workspaceId, { fromTabSwitch: true })
	state.session = tab.type === 'draft'
		? sessionCache.get(key) || newSessionObject(tab.id)
		: await loadTabSession(tab)
	if (tab.type === 'session' && !state.session) {
		// 会话已不存在：移除标签并回落草稿
		state.tabs = state.tabs.filter(item => tabKeyOf(item) !== key)
		state.activeTabKey = ''
		renderTabs()
		await startNewSession()
		return
	}
	if (state.session) {
		state.session.workspaceId = state.workspace?.id || ''
		sessionCache.set(key, state.session)
		state.lastConversationWorkspaceId = state.workspace?.id
	}
	state.activeTabKey = key
	state.charname = state.session?.charname || state.charname
	state.aiSource = state.session?.ai_source ?? ''
	state.profile = state.session?.profile || state.profile
	renderTabs()
	renderMessages()
	updateCharMenu()
	renderModePillLabel()
	renderAiSourcePillLabel()
	// 切回生成中的会话：重建流式气泡
	if (state.generating && generatingSession === state.session) startGeneratingBubble()
}

/**
 * 加载会话标签的会话对象（内存缓存优先，回退目标工作区磁盘）。
 * @param {object} tab - 会话标签。
 * @returns {Promise<object|null>} 会话对象。
 */
async function loadTabSession(tab) {
	const key = tabKeyOf(tab)
	const cached = sessionCache.get(key)
	if (cached) return cached
	try {
		return await api.loadSession(target(), tab.id)
	}
	catch {
		return state.allSessions.find(s => s.id === tab.id && s.workspaceId === state.workspace?.id) || null
	}
}

/**
 * 切到工作区的草稿标签（无则新建）——工作区 pill 切换的落点。
 * @param {string} workspaceId - 工作区 id。
 * @returns {Promise<void>}
 */
async function activateDraftForWorkspace(workspaceId) {
	const draft = state.tabs.find(tab => tab.type === 'draft' && tab.workspaceId === workspaceId)
	await activateTab(draft || createDraftTab(workspaceId))
}

/* ---------------- 消息渲染 ---------------- */

/**
 * 将消息内容里的文件 token 转为行内代码以便渲染。
 * @param {string} content - 原始内容。
 * @returns {string} 处理后的 markdown。
 */
function messageMarkdown(content) {
	return content.replace(/@\[file:([^\]\n]+)\]/g, (_m, path) => '`' + path + '`')
}

/**
 * 渲染单条消息气泡。
 * @param {object} entry - 会话条目。
 * @returns {HTMLElement} 气泡元素。
 */
function renderEntryBubble(entry) {
	const bubble = document.createElement('div')
	bubble.className = `code-message role-${entry.role}`
	bubble.dataset.entryId = entry.id
	// 消息内容为动态用户/AI 文本，跳过语种扫描整棵子树
	bubble.setAttribute('user-content', '')
	if (entry.role !== 'user' && entry.name) {
		const name = document.createElement('div')
		name.className = 'code-message-name'
		name.textContent = entry.name
		bubble.appendChild(name)
	}
	const body = document.createElement('div')
	body.className = 'code-message-body'
	bubble.appendChild(body)
	if (entry.role === 'tool' || entry.role === 'system') {
		const details = document.createElement('details')
		details.className = 'code-tool-log'
		const summary = document.createElement('summary')
		const chevron = document.createElement('span')
		chevron.className = 'code-tool-log-chevron'
		chevron.textContent = '▸'
		const name = document.createElement('span')
		name.className = 'code-tool-log-name'
		name.textContent = entry.name || entry.role
		summary.appendChild(chevron)
		summary.appendChild(name)
		const content = document.createElement('div')
		content.className = 'mt-1'
		details.appendChild(summary)
		details.appendChild(content)
		body.appendChild(details)
		renderMarkdownAsString(messageMarkdown(entry.content), markdownCache).then(html => {
			content.innerHTML = html
		})
	}
	else
		renderMarkdownAsString(messageMarkdown(entry.content), markdownCache).then(html => {
			body.innerHTML = html
		})

	for (const file of entry.files || []) {
		const chip = document.createElement('div')
		chip.className = 'text-xs opacity-70'
		chip.textContent = `📎 ${file.name}`
		body.appendChild(chip)
	}
	return bubble
}

/* 贴底自动滚 */
const SCROLL_TOLERANCE = 96

/**
 * 消息流是否接近底部。
 * @returns {boolean} 是否贴底。
 */
function nearBottom() {
	const el = elements.messages
	return el.scrollHeight - el.scrollTop - el.clientHeight < SCROLL_TOLERANCE
}

/**
 * 滚动消息流到底部。
 * @returns {void}
 */
function scrollMessagesBottom() {
	elements.messages.scrollTop = elements.messages.scrollHeight
}

/**
 * 更新回到底部浮标可见性。
 * @returns {void}
 */
function updateBackToBottom() {
	backToBottom.classList.toggle('show', !nearBottom() && (state.session?.entries?.length || 0) > 0)
}

const backToBottom = document.createElement('button')
backToBottom.type = 'button'
backToBottom.id = 'code-back-to-bottom'
backToBottom.className = 'code-back-to-bottom'
backToBottom.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 5v14"></path><path d="M5 12l7 7 7-7"></path></svg>'
backToBottom.addEventListener('click', scrollMessagesBottom)
elements.messages.appendChild(backToBottom)

elements.messages.addEventListener('scroll', updateBackToBottom, { passive: true })

/* ---------------- 空态 ---------------- */

/**
 * 空态布局开关：无条目时 composer 垂直居中 + wordmark（工作区选择走下方 workspace pill）。
 * @returns {void}
 */
function updateEmptyMode() {
	const empty = !(state.session?.entries?.length || 0)
	document.querySelector('.code-main')?.classList.toggle('empty-mode', empty)
}

/**
 * 渲染全部消息。
 * @returns {void}
 */
function renderMessages() {
	updateEmptyMode()
	const entries = state.session?.entries || []
	if (!entries.length) {
		elements.messages.replaceChildren(backToBottom)
		updateBackToBottom()
		return
	}
	elements.messages.replaceChildren(...entries.map(renderEntryBubble), backToBottom)
	scrollMessagesBottom()
	updateBackToBottom()
}

/**
 * 追加消息气泡。
 * @param {object} entry - 会话条目。
 * @returns {HTMLElement} 气泡元素。
 */
function appendEntryBubble(entry) {
	const bubble = renderEntryBubble(entry)
	elements.messages.insertBefore(bubble, backToBottom)
	updateEmptyMode()
	if (nearBottom()) scrollMessagesBottom()
	updateBackToBottom()
	return bubble
}

/* ---------------- composer ---------------- */

const richInput = createMarkdownRichInput(elements.composerInput, {
	inlineTokens: [{
		kind: 'file',
		regex: /@\[file:([^\]\n]+)\]/,
		/**
		 * 解析文件 token 原文。
		 * @param {string} raw - 匹配的原文（`@[file:…]`）。
		 * @returns {{kind: string, body: string}} token 描述。
		 */
		parse: raw => ({ kind: 'file', body: raw.slice('@[file:'.length, -1) }),
		/**
		 * 解析 chip 显示名。
		 * @param {{kind: string, body: string}} parsed - token 描述。
		 * @returns {string} chip 文本。
		 */
		resolveLabel: parsed => parsed.body,
	}],
	useRegisteredInlineTokens: false,
})

/**
 * 更新 composer placeholder（normal / shell 模式）。
 * @returns {void}
 */
function updateComposerPlaceholder() {
	const placeholder = state.shellMode
		? geti18n('code.composer.placeholderShell')
		: geti18n('code.composer.placeholderNormal')
	const node = elements.composerInput.querySelector('.fount-markdown-rich-input-placeholder')
	if (node) node.textContent = placeholder
	// markdownRichInput 在 focus/click 时会按 placeholder 属性重建占位符 span，
	// 同步该属性保证重建后仍是当前模式的文案（而非 i18n 的旧 `code.composer.placeholder`）。
	elements.composerInput.setAttribute('placeholder', placeholder)
}

/**
 * `@` 文件补全 provider：在当前工作区内按文件名子串搜索。
 * @param {object} _ctx - 补全上下文（未使用）。
 * @param {string} query - 查询子串。
 * @param {number} limit - 结果上限。
 * @returns {Promise<Array<{kind: string, rawToken: string, displayName: string}>>} 候选行。
 */
const fileProvider = async (_ctx, query, limit) => {
	if (!state.workspace?.path) return []
	try {
		const { files } = await api.searchFiles(target(), query)
		return files.slice(0, limit).map(path => ({
			kind: 'file',
			rawToken: `@[file:${path}]`,
			displayName: path.split('/').pop(),
		}))
	}
	catch {
		return []
	}
}

attachMentionAutocomplete(elements.composerInput, {
	providers: [fileProvider],
	trailingSpace: false,
	listboxPrefix: 'code-file',
})

/* ---------------- 输入历史 / 影子补全 ---------------- */

/**
 * 合并历史条目（保持去重；已存在的本地追加优先，避免加载覆盖加载期间的本地新条目）。
 * @param {string[]} loaded - 后端读取的历史（追加序）。
 * @param {string[]} existing - 本地已有历史（追加序）。
 * @returns {string[]} 合并结果。
 */
function mergeHistoryEntries(loaded, existing) {
	const seen = new Set()
	/** @type {string[]} */
	const out = []
	for (const entry of [...loaded, ...existing]) {
		if (!entry || seen.has(entry)) continue
		seen.add(entry)
		out.push(entry)
	}
	return out
}

/**
 * 加载当前模式历史。
 * @param {'shell'|'message'} mode - 历史模式。
 * @returns {Promise<void>}
 */
async function loadHistory(mode) {
	if (mode === 'shell') {
		const data = await api.getHistory(target(), 'shell', state.shell).catch(() => ({ own: [], native: [] }))
		historyState.own = mergeHistoryEntries(data.own || [], historyState.own)
		historyState.native = data.native || []
	}
	else if (state.workspace) {
		const data = await api.getHistory(target(), 'message').catch(() => ({ own: [] }))
		historyState.own = mergeHistoryEntries(data.own || [], historyState.own)
		historyState.native = []
	}
	else {
		historyState.own = mergeHistoryEntries(JSON.parse(getPref('messageHistory') || '[]'), historyState.own)
		historyState.native = []
	}
	historyState.mode = mode
}

/**
 * 确保当前模式历史已加载。
 * @param {'shell'|'message'} mode - 历史模式。
 * @returns {Promise<void>}
 */
async function ensureHistory(mode) {
	if (historyState.mode === mode) return
	await loadHistory(mode)
}

/**
 * 合并后的补全候选（自有优先、newest-first、去重）。
 * @returns {string[]} 候选列表。
 */
function historySuggestions() {
	const seen = new Set()
	/** @type {string[]} */
	const merged = []
	for (const entry of [...historyState.own].reverse().concat(historyState.native)) {
		if (!entry || seen.has(entry)) continue
		seen.add(entry)
		merged.push(entry)
	}
	return merged
}

/**
 * 自有历史（newest-first，↑/↓ 遍历用）。
 * @returns {string[]} 历史列表。
 */
function ownHistoryNewest() {
	return [...historyState.own].reverse()
}

/**
 * 移除影子补全 span。
 * @returns {void}
 */
function removeGhost() {
	elements.composerInput.querySelector('.code-composer-ghost')?.remove()
}

/**
 * 渲染影子补全（光标在末尾且历史存在前缀匹配时）。
 * @returns {void}
 */
function updateGhost() {
	removeGhost()
	const value = richInput.value
	if (!value || !historySuggestions().length) return
	if (elements.composerInput.selectionStart !== value.length) return
	const ghostText = historySuggestions().find(entry => entry.length > value.length && entry.startsWith(value)) || ''
	if (!ghostText) return
	const ghost = document.createElement('span')
	ghost.className = 'code-composer-ghost'
	ghost.setAttribute('contenteditable', 'false')
	ghost.dataset.emptySlot = '1'
	ghost.textContent = ghostText.slice(value.length)
	elements.composerInput.appendChild(ghost)
}

/**
 * 接受影子补全（Tab / →）。
 * @returns {boolean} 是否已接受。
 */
function acceptGhost() {
	const ghost = elements.composerInput.querySelector('.code-composer-ghost')
	if (!ghost?.textContent) return false
	const remainder = ghost.textContent
	removeGhost()
	const caret = elements.composerInput.selectionStart
	richInput.setRangeText(remainder, caret, caret, 'end')
	elements.composerInput.dispatchEvent(new Event('input', { bubbles: true }))
	return true
}

/**
 * 光标是否在第 1 行（↑ 可触发历史导航）。
 * @returns {boolean} 是否首行。
 */
function isAtFirstLine() {
	return !richInput.value.slice(0, elements.composerInput.selectionStart).includes('\n')
}

/**
 * 光标是否在最后一行（↓ 可触发历史导航）。
 * @returns {boolean} 是否末行。
 */
function isAtLastLine() {
	return !richInput.value.slice(elements.composerInput.selectionStart).includes('\n')
}

/** 历史导航派发的 input 事件标志（避免重置导航游标）。 */
let fromNav = false

/**
 * ↑/↓ 历史导航（仅当前模式自有历史）。
 * pos 语义：0 = 草稿（最新边界），n = 从草稿起第 n 条历史（entries[n-1]）。
 * @param {number} direction - -1 更旧（↑）/ +1 更新（↓）。
 * @returns {void}
 */
function navHistory(direction) {
	const entries = ownHistoryNewest()
	if (!entries.length) return
	if (historyNav.pos === null) {
		historyNav.draft = richInput.value
		historyNav.pos = 0
	}
	const next = Math.max(0, Math.min(entries.length, historyNav.pos - direction))
	if (next === historyNav.pos) return
	historyNav.pos = next
	richInput.value = next === 0 ? historyNav.draft : entries[next - 1]
	fromNav = true
	elements.composerInput.dispatchEvent(new Event('input', { bubbles: true }))
	fromNav = false
}

/**
 * 追加一条自有历史并持久化（本地状态立即更新；无工作区时消息历史回退 localStorage）。
 * @param {'shell'|'message'} kind - 历史类型。
 * @param {string} command - 条目内容。
 * @returns {void}
 */
function appendLocalHistory(kind, command) {
	historyState.own = [...historyState.own.filter(entry => entry !== command), command]
	if (!command?.trim()) return
	if (kind === 'shell') {
		if (state.workspace) void api.appendHistory(target(), 'shell', command).catch(() => { })
	}
	else if (state.workspace) 
		void api.appendHistory(target(), 'message', command).catch(() => { })
	
	else {
		const list = JSON.parse(getPref('messageHistory') || '[]')
		setPref('messageHistory', JSON.stringify([...list.filter(entry => entry !== command), command].slice(-500)))
	}
}

/* ---------------- `/` 命令面板 ---------------- */

/**
 * `/` 命令补全面板。
 */
const slashPanel = document.createElement('div')
slashPanel.className = 'code-slash-panel hidden'
document.body.appendChild(slashPanel)
let slashSuggestions = []
let slashActive = 0
let slashRange = null
let slashQuery = ''

/**
 * 隐藏 `/` 命令面板。
 * @returns {void}
 */
function hideSlashPanel() {
	slashPanel.classList.add('hidden')
	slashSuggestions = []
}

/**
 * 渲染 `/` 命令面板列表。
 * @returns {void}
 */
function renderSlashItems() {
	slashPanel.replaceChildren(...slashSuggestions.map((cmd, index) => {
		const button = document.createElement('button')
		button.type = 'button'
		button.className = 'code-slash-item' + (index === slashActive ? ' active' : '')
		const name = document.createElement('strong')
		name.className = 'code-slash-item-name'
		name.textContent = '/' + cmd.name
		const desc = document.createElement('span')
		desc.className = 'code-slash-item-desc'
		desc.textContent = cmd.description || ''
		button.appendChild(name)
		button.appendChild(desc)
		button.addEventListener('click', () => void applySlashCommand(cmd))
		return button
	}))
}

/**
 * 显示 `/` 命令面板。
 * @param {string} query - 查询词。
 * @returns {void}
 */
function showSlashPanel(query) {
	slashQuery = query
	slashSuggestions = (state.commands || []).filter(cmd => cmd.name.startsWith(query)).slice(0, 12)
	if (!slashSuggestions.length) {
		hideSlashPanel()
		return
	}
	slashActive = 0
	renderSlashItems()
	slashPanel.classList.remove('hidden')
	const hostRect = document.querySelector('.code-composer-shell').getBoundingClientRect()
	slashPanel.style.left = `${hostRect.left}px`
	slashPanel.style.top = `${hostRect.top - 8}px`
	slashPanel.style.minWidth = `${Math.max(240, hostRect.width / 2)}px`
}

/**
 * 应用选中的 `/` 命令：补全参数并渲染后发送。
 * @param {object} command - 命令条目。
 * @returns {Promise<void>}
 */
async function applySlashCommand(command) {
	hideSlashPanel()
	const specEntries = Object.entries(command.params || {})
	/** @type {Record<string, string>} */
	let argv = {}
	if (specEntries.length) {
		argv = await openCommandParams(command)
		if (argv === null) return
	}
	try {
		const { content } = await api.renderCommand(target(), command.name, argv)
		if (slashRange) {
			richInput.setRangeText('', slashRange.start, slashRange.end, 'end')
			slashRange = null
		}
		await sendMessage(content)
	}
	catch (error) {
		showToastI18n('error', 'code.error.generic', { error: String(error.message || error) })
	}
}

/**
 * 打开命令参数填写对话框。
 * @param {object} command - 命令条目。
 * @returns {Promise<Record<string, string>|null>} 参数（取消时 null）。
 */
async function openCommandParams(command) {
	return await new Promise(resolve => {
		let settled = false
		/** @type {(value: Record<string, string>|null) => void} */
		const settle = value => {
			if (settled) return
			settled = true
			resolve(value)
		}
		void openDialogFromTemplate('command_params', { commandName: command.name }, {
			/** @param {HTMLDialogElement} dialog 对话框 */
			onReady: dialog => {
				const fields = dialog.querySelector('#command-params-fields')
				const inputs = {}
				fields.replaceChildren(...Object.entries(command.params || {}).map(([name, spec]) => {
					const label = document.createElement('label')
					label.className = 'form-control w-full mb-2'
					const caption = document.createElement('div')
					caption.className = 'label'
					caption.innerHTML = `<span class="label-text">${name}${spec?.required ? ' *' : ''}${spec?.description ? ` - ${spec.description}` : ''}</span>`
					const input = document.createElement('input')
					input.className = 'input input-sm input-bordered w-full'
					input.value = spec?.default || ''
					input.setAttribute('user-content', '')
					inputs[name] = input
					label.appendChild(caption)
					label.appendChild(input)
					return label
				}))
				dialog.querySelector('#command-params-run').addEventListener('click', () => {
					/** @type {Record<string, string>} */
					const argv = {}
					for (const [name, input] of Object.entries(inputs)) argv[name] = input.value
					dialog.close()
					settle(argv)
				})
				dialog.addEventListener('close', () => settle(null))
			},
		}).catch(error => {
			showToastI18n('error', 'code.error.generic', { error: String(error.message || error) })
			settle(null)
		})
	})
}

/* ---------------- 发送 ---------------- */

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
		if (generatingSession === state.session && generatingBubble?.renderer) generatingBubble.renderer.setTarget(msg.content)
		return
	}
	if (msg.type === 'done') {
		finishGeneration(msg.entries, msg.memory)
		return
	}
	if (msg.type === 'aborted') {
		finishGeneration(msg.entries, null, true)
		return
	}
	if (msg.type === 'error') {
		const session = generatingSession || state.session
		state.generating = false
		endGeneratingBubble()
		const fallback = geti18n('code.error.generate')
		const text = `${fallback}\n\`\`\`\n${msg.error}\n\`\`\``
		session?.entries.push(...msg.entries || [], { id: crypto.randomUUID().slice(0, 8), uid: 'system', role: 'system', name: 'error', content: text, time: new Date().toISOString() })
		if (session === state.session) 
			for (const entry of session.entries.slice(-((msg.entries || []).length + 1))) appendEntryBubble(entry)
		
		markSessionDirty(session)
	}
}

/** 生成中的气泡与流式渲染器。 */
let generatingBubble = null

/**
 * 创建生成中的流式气泡。
 * @returns {void}
 */
function startGeneratingBubble() {
	const bubble = document.createElement('div')
	bubble.className = 'code-message role-char generating'
	const name = document.createElement('div')
	name.className = 'code-message-name'
	name.textContent = state.session?.charname || ''
	const body = document.createElement('div')
	body.className = 'code-message-body'
	bubble.appendChild(name)
	bubble.appendChild(body)
	elements.messages.insertBefore(bubble, backToBottom)
	if (nearBottom()) scrollMessagesBottom()
	generatingBubble = { bubble, renderer: new StreamRenderer(body, { allowDangerousHtml: false }) }
}

/**
 * 移除生成中的气泡。
 * @returns {void}
 */
function endGeneratingBubble() {
	generatingBubble?.bubble.remove()
	generatingBubble = null
}

/**
 * 结束生成：以服务端条目替换流式气泡。
 * @param {object[]} entries - 服务端返回的新条目（含用户消息与 tool 日志）。
 * @param {object|null} memory - 会话记忆。
 * @param {boolean} [aborted=false] - 是否被中断。
 * @returns {void}
 */
function finishGeneration(entries, memory, aborted = false) {
	endGeneratingBubble()
	const session = generatingSession || state.session
	generatingSession = null
	if (!session) return
	const isActive = session === state.session
	session.entries.push(...entries)
	if (memory) session.memory = memory
	session.updated = new Date().toISOString()
	if (!session.title && entries.length)
		session.title = (entries.find(e => e.role === 'user')?.content || '').slice(0, 40) || session.title
	state.generating = false
	updateSendButton()
	if (isActive) {
		for (const entry of entries) appendEntryBubble(entry)
		if (aborted) showToastI18n('info', 'code.error.aborted')
	}
	markSessionDirty(session)
	renderTabs()
	void refreshAllSessions()
}

/**
 * 更新发送按钮（生成中变停止图标）。
 * @returns {void}
 */
function updateSendButton() {
	const stop = state.generating
	elements.sendButton.classList.toggle('stop', stop)
	elements.sendButton.setAttribute('aria-label', geti18n(stop ? 'code.composer.stopAria' : 'code.composer.sendAria'))
	elements.sendIcon.innerHTML = stop
		? '<rect x="5" y="5" width="14" height="14" rx="2" fill="currentColor" stroke="none"></rect>'
		: '<path d="M12 19V5"></path><path d="M5 12l7-7 7 7"></path>'
}

/**
 * 发送消息（AI 会话）。
 * @param {string} content - 消息内容。
 * @returns {Promise<void>}
 */
async function sendMessage(content) {
	if (!content?.trim() || state.generating) return
	if (!state.session) await startNewSession()
	state.session.charname = state.charname || state.session.charname
	if (!state.session.charname) {
		showToastI18n('error', 'code.error.noChar')
		return
	}
	state.session.profile = state.profile
	state.session.ai_source = state.aiSource
	generatingSession = state.session
	appendLocalHistory('message', content)
	state.generating = true
	updateSendButton()
	startGeneratingBubble()
	try {
		const ws = await getSocket()
		ws.send(JSON.stringify({
			type: 'send',
			session: state.session,
			...target(),
			ai_source: state.aiSource || '',
			profile: state.profile,
			content,
		}))
	}
	catch (error) {
		state.generating = false
		endGeneratingBubble()
		generatingSession = null
		updateSendButton()
		showToastI18n('error', 'code.error.generic', { error: String(error.message || error) })
	}
}

/**
 * `!` shell 模式执行。
 * @param {string} command - 命令。
 * @returns {Promise<void>}
 */
async function execShellMode(command) {
	appendLocalHistory('shell', command)
	if (!state.session) await startNewSession()
	const userEntry = {
		id: crypto.randomUUID().slice(0, 8),
		uid: 'user',
		role: 'user',
		name: state.username,
		content: '```' + (state.shell || '') + '\n' + command + '\n```',
		time: new Date().toISOString(),
	}
	state.session.entries.push(userEntry)
	appendEntryBubble(userEntry)
	const result = await api.execShell({ ...target(), shell: state.shell || undefined, command })
	const output = result.stdall ?? [result.stdout, result.stderr].filter(Boolean).join('\n')
	const toolEntry = {
		id: crypto.randomUUID().slice(0, 8),
		uid: 'system',
		role: 'tool',
		name: 'shell',
		content: '```' + (state.shell || '') + '\n' + command + '\n```\n```\n' + output + '\n```',
		time: new Date().toISOString(),
	}
	state.session.entries.push(toolEntry)
	appendEntryBubble(toolEntry)
	state.session.updated = new Date().toISOString()
	markSessionDirty()
	void refreshAllSessions()
}

/* ---------------- 缓存 flush ---------------- */

/**
 * 标记会话为待持久化；焦点已移出窗口且无生成任务时立即写盘。
 * 草稿一旦可落盘即转为会话标签（防关闭丢失）。无工作区时会话无处落盘，跳过。
 * @param {object} [session] - 目标会话（默认当前展示会话；后台生成时传入）。
 * @returns {void}
 */
function markSessionDirty(session = state.session) {
	const key = tabKeyOfSession(session)
	if (!key) return
	dirtyTabKey = key
	const tab = state.tabs.find(item => tabKeyOf(item) === key)
	if (!tab) return
	const workspace = state.workspaces.find(w => w.id === tab.workspaceId)
	if (!workspace) return
	if (tab.type === 'draft') {
		tab.type = 'session'
		renderTabs()
	}
	// 非生成时标记即落盘（AGENTS 约定），保证总览/标签标题及时可见
	if (!state.generating) void flushSession()
}

/**
 * 持久化待写标签的会话到其工作区 `.fount/code/sessions`（生成中、无变更、无工作区时跳过）。
 * @returns {Promise<void>}
 */
async function flushSession() {
	const key = dirtyTabKey
	if (!key || state.generating) return
	dirtyTabKey = ''
	const tab = state.tabs.find(item => tabKeyOf(item) === key)
	const session = tabKeyOf(activeTab() || {}) === key ? state.session : sessionCache.get(key)
	const workspace = tab && state.workspaces.find(w => w.id === tab.workspaceId)
	if (!session || !workspace || !(session.entries?.length || 0)) return
	try {
		await api.putSession({ machine: String(workspace.machine ?? state.machine), workdir: workspace.path }, session)
	}
	catch (error) {
		dirtyTabKey = key
		showToastI18n('error', 'code.error.generic', { error: String(error.message || error) })
	}
}

window.addEventListener('blur', () => void flushSession())
document.addEventListener('visibilitychange', () => {
	if (document.hidden) void flushSession()
})
window.addEventListener('beforeunload', () => {
	if (!dirtyTabKey || state.generating) return
	const tab = state.tabs.find(item => tabKeyOf(item) === dirtyTabKey)
	const session = tabKeyOf(activeTab() || {}) === dirtyTabKey ? state.session : sessionCache.get(dirtyTabKey)
	const workspace = tab && state.workspaces.find(w => w.id === tab.workspaceId)
	if (session && workspace && (session.entries?.length || 0))
		api.putSession({ machine: String(workspace.machine ?? state.machine), workdir: workspace.path }, session).catch(() => { })
})

/* ---------------- 机器 / 工作区 pill ---------------- */

/**
 * 渲染机器 pill 下拉。
 * @returns {void}
 */
function renderMachineMenu() {
	elements.machineMenu.replaceChildren(...state.machines.map(machine => {
		const li = document.createElement('li')
		const button = document.createElement('button')
		button.type = 'button'
		button.className = 'menu-item' + (String(machine.id) === state.machine ? ' active' : '')
		button.textContent = machine.id === '0'
			? geti18n('code.machine.local')
			: `${machine.description || machine.deviceInfo?.hostname || `#${machine.id}`}${machine.isConnected ? '' : ' (' + geti18n('code.machine.offline') + ')'}`
		button.disabled = machine.id !== '0' && !machine.isConnected
		button.addEventListener('click', () => {
			document.activeElement?.blur()
			selectMachine(String(machine.id))
		})
		li.appendChild(button)
		return li
	}))
}

/**
 * 更新机器 pill 标签。
 * @returns {void}
 */
function renderMachinePillLabel() {
	const machine = state.machines.find(m => String(m.id) === state.machine)
	elements.machinePillLabel.textContent = machine?.id === '0'
		? geti18n('code.machine.local')
		: (machine?.description || machine?.deviceInfo?.hostname || `#${state.machine}`) + (machine?.isConnected === false ? ` (${geti18n('code.machine.offline')})` : '')
}

/**
 * 应用机器变更。
 * @param {string} id - 机器 id。
 * @returns {Promise<void>}
 */
async function selectMachine(id) {
	state.machine = id
	setPref('machine', id)
	state.shells = await api.getMachineShells(id).then(r => r.shells).catch(() => [])
	renderShellMenu()
	renderShellPillLabel()
	renderMachinePillLabel()
	renderMachineMenu()
}

/**
 * 渲染工作区 pill 下拉（列表 + 浏览/移除）。
 * @returns {void}
 */
function renderWorkspaceMenu() {
	elements.workspaceMenu.replaceChildren()
	const list = state.workspaces
	if (list.length) {
		list.forEach(workspace => {
			const li = document.createElement('li')
			const button = document.createElement('button')
			button.type = 'button'
			button.className = 'menu-item' + (state.workspace?.id === workspace.id ? ' active' : '')
			const name = document.createElement('span')
			name.textContent = workspace.name || workspace.path
			const path = document.createElement('span')
			path.className = 'opacity-60 text-xs'
			path.textContent = workspace.path
			button.appendChild(name)
			button.appendChild(path)
			button.addEventListener('click', () => {
				document.activeElement?.blur()
				selectWorkspace(workspace.id)
			})
			li.appendChild(button)
			elements.workspaceMenu.appendChild(li)
		})
		const separatorLi = document.createElement('li')
		const separator = document.createElement('div')
		separator.className = 'divider my-1'
		separatorLi.appendChild(separator)
		elements.workspaceMenu.appendChild(separatorLi)
	}
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
	elements.workspaceMenu.appendChild(browseLi)
	if (state.workspace) {
		const removeLi = document.createElement('li')
		const removeBtn = document.createElement('button')
		removeBtn.type = 'button'
		removeBtn.className = 'menu-item text-error'
		removeBtn.textContent = geti18n('code.workspaces.remove')
		removeBtn.addEventListener('click', () => {
			document.activeElement?.blur()
			removeCurrentWorkspace()
		})
		removeLi.appendChild(removeBtn)
		elements.workspaceMenu.appendChild(removeLi)
	}
}

/**
 * 更新工作区 pill 标签。
 * @returns {void}
 */
function renderWorkspacePillLabel() {
	elements.workspacePillLabel.textContent = state.workspace?.name || state.workspace?.path || geti18n('code.workspaces.none')
}

/**
 * 选择工作区（标签切换复用；底部 pill 切换后落到该工作区的草稿标签）。
 * @param {string} id - 工作区 id。
 * @param {{fromTabSwitch?: boolean}} [options] - 标签切换内部调用时不激活草稿。
 * @returns {Promise<void>}
 */
async function selectWorkspace(id, { fromTabSwitch = false } = {}) {
	const workspace = state.workspaces.find(w => w.id === id)
	if (!workspace) return
	// 缓存当前会话，避免工作区切换丢失未保存内容
	const current = activeTab()
	if (current && state.session) sessionCache.set(tabKeyOf(current), state.session)
	state.workspace = workspace
	if (workspace.machine !== state.machine) {
		state.machine = String(workspace.machine)
		setPref('machine', state.machine)
		state.shells = await api.getMachineShells(state.machine).then(r => r.shells).catch(() => [])
		renderMachinePillLabel()
		renderMachineMenu()
		renderShellMenu()
		renderShellPillLabel()
	}
	setPref('workspace', state.workspace.id)
	state.session = null
	historyState.mode = null
	historyNav.pos = null
	removeGhost()
	await Promise.all([refreshAllSessions(), refreshProfiles()])
	renderMessages()
	renderWorkspacePillLabel()
	renderWorkspaceMenu()
	renderHomeMenu()
	renderTabs()
	void ensureHistory(state.shellMode ? 'shell' : 'message')
	void applyWorkspaceCharConfig()
	if (!fromTabSwitch) await activateDraftForWorkspace(workspace.id)
}

/**
 * 移除当前工作区。
 * @returns {Promise<void>}
 */
async function removeCurrentWorkspace() {
	if (!state.workspace) return
	const removedId = state.workspace.id
	state.workspaces = state.workspaces.filter(w => w.id !== removedId)
	await api.removeWorkspace(removedId).catch(() => { })
	state.workspace = null
	setPref('workspace', '')
	// 丢弃指向该工作区的标签；活动标签被移除时清空会话视图
	state.tabs = state.tabs.filter(tab => tab.workspaceId !== removedId)
	if (state.activeTabKey && !activeTab()) {
		state.activeTabKey = ''
		state.session = null
	}
	dirtyTabKey = ''
	renderWorkspacePillLabel()
	renderWorkspaceMenu()
	renderHomeMenu()
	await Promise.all([refreshAllSessions(), refreshProfiles()])
	renderTabs()
	renderMessages()
	if (!state.activeTabKey) await startNewSession()
}

/**
 * 渲染 shell pill 下拉（! 模式）。
 * @returns {void}
 */
function renderShellMenu() {
	elements.shellMenu.replaceChildren(...(state.shells.length ? state.shells : ['']).map(shell => {
		const li = document.createElement('li')
		const button = document.createElement('button')
		button.type = 'button'
		button.className = 'menu-item' + (shell === state.shell ? ' active' : '')
		button.textContent = shell || geti18n('code.composer.shellDefault')
		button.addEventListener('click', () => {
			document.activeElement?.blur()
			state.shell = shell
			// shell 变更后重读原生历史
			historyState.mode = null
			void ensureHistory('shell')
			renderShellMenu()
			renderShellPillLabel()
		})
		li.appendChild(button)
		return li
	}))
}

/**
 * 更新 shell pill 标签。
 * @returns {void}
 */
function renderShellPillLabel() {
	elements.shellPillLabel.textContent = state.shell || geti18n('code.composer.shellDefault')
}

/* ---------------- profile / AI 源 pill ---------------- */

/**
 * 刷新 profile 与 commands。
 * @returns {Promise<void>}
 */
async function refreshProfiles() {
	if (!state.workspace) {
		state.profiles = [{ name: 'plan', source: 'builtin', description: '' }, { name: 'build', source: 'builtin', description: '' }]
		state.commands = []
	}
	else
		try {
			const data = await api.getProfiles(target())
			state.profiles = data.profiles
			state.commands = data.commands
		}
		catch {
			state.profiles = []
			state.commands = []
		}

	renderModeMenu()
	renderModePillLabel()
}

/**
 * 渲染 mode/profile pill 下拉。
 * @returns {void}
 */
function renderModeMenu() {
	elements.modeMenu.replaceChildren(...state.profiles.map(profile => {
		const li = document.createElement('li')
		const button = document.createElement('button')
		button.type = 'button'
		button.className = 'menu-item' + (profile.name === state.profile ? ' active' : '')
		button.textContent = profile.name + (profile.source === 'builtin' ? '' : ` (${profile.source})`)
		button.addEventListener('click', () => {
			document.activeElement?.blur()
			state.profile = profile.name
			setPref('profile', state.profile)
			renderModeMenu()
			renderModePillLabel()
		})
		li.appendChild(button)
		return li
	}))
}

/**
 * 更新 mode pill 标签。
 * @returns {void}
 */
function renderModePillLabel() {
	elements.modePillLabel.textContent = state.profile
}

/**
 * Tab 键轮换 mode（溢出归 0），并给出可见反馈。
 * @returns {void}
 */
function cycleMode() {
	if (!state.profiles.length) return
	const index = state.profiles.findIndex(p => p.name === state.profile)
	state.profile = state.profiles[(index + 1) % state.profiles.length]?.name || 'build'
	setPref('profile', state.profile)
	renderModeMenu()
	renderModePillLabel()
	showToastI18n('info', 'code.composer.modeSwitched', { mode: state.profile })
}

/**
 * 刷新 AI 源列表。
 * @returns {Promise<void>}
 */
async function refreshAiSources() {
	try {
		const data = await api.getAiSources()
		state.aiSources = data.sources
		state.aiDefaults = data.defaults || []
		state.aiHidden = data.hidden || []
	}
	catch {
		state.aiSources = []
		state.aiHidden = []
	}
	renderAiSourceMenu()
	renderAiSourcePillLabel()
}

/**
 * 渲染 AI 源 pill 下拉。
 * @returns {void}
 */
function renderAiSourceMenu() {
	const visible = state.aiSources.filter(name => !state.aiHidden.includes(name))
	elements.aiSourceMenu.replaceChildren(...visible.map(name => {
		const li = document.createElement('li')
		const button = document.createElement('button')
		button.type = 'button'
		button.className = 'menu-item' + (name === state.aiSource ? ' active' : '')
		button.textContent = name + (state.aiDefaults?.includes(name) ? ' ★' : '')
		button.addEventListener('click', () => {
			document.activeElement?.blur()
			state.aiSource = name
			setPref('aiSource', state.aiSource)
			renderAiSourceMenu()
			renderAiSourcePillLabel()
		})
		li.appendChild(button)
		return li
	}), (() => {
		const ownLi = document.createElement('li')
		const ownBtn = document.createElement('button')
		ownBtn.type = 'button'
		ownBtn.className = 'menu-item' + (!state.aiSource ? ' active' : '')
		ownBtn.textContent = geti18n('code.aiSource.charOwn')
		ownBtn.addEventListener('click', () => {
			document.activeElement?.blur()
			state.aiSource = ''
			setPref('aiSource', '')
			renderAiSourceMenu()
			renderAiSourcePillLabel()
		})
		ownLi.appendChild(ownBtn)
		return ownLi
	})(), (() => {
		const separatorLi = document.createElement('li')
		const separator = document.createElement('div')
		separator.className = 'divider my-1'
		separatorLi.appendChild(separator)
		return separatorLi
	})(), (() => {
		const manageLi = document.createElement('li')
		const manageBtn = document.createElement('button')
		manageBtn.type = 'button'
		manageBtn.className = 'menu-item'
		manageBtn.textContent = geti18n('code.aiSource.manage')
		manageBtn.addEventListener('click', () => {
			document.activeElement?.blur()
			void openAiSourcePanel()
		})
		manageLi.appendChild(manageBtn)
		return manageLi
	})())
}

/**
 * 更新 AI 源 pill 标签。
 * @returns {void}
 */
function renderAiSourcePillLabel() {
	elements.aiSourcePillLabel.textContent = state.aiSource || geti18n('code.aiSource.charOwn')
}

/**
 * 渲染 AI 源可见性管理面板。
 * @param {HTMLDialogElement} dialog - 已打开的对话框。
 * @returns {void}
 */
function renderAiSourcePanel(dialog) {
	const list = dialog.querySelector('#ai-source-list')
	list.replaceChildren(...state.aiSources.map(name => {
		const row = document.createElement('label')
		row.className = 'ai-source-row'
		const checkbox = document.createElement('input')
		checkbox.type = 'checkbox'
		checkbox.className = 'checkbox checkbox-sm'
		checkbox.checked = !state.aiHidden.includes(name)
		checkbox.addEventListener('change', () => {
			if (checkbox.checked) state.aiHidden = state.aiHidden.filter(n => n !== name)
			else state.aiHidden = [...state.aiHidden, name]
			api.setAiSourceVisibility(state.aiHidden).then(() => {
				renderAiSourceMenu()
				renderAiSourcePillLabel()
			}).catch(() => { })
		})
		const text = document.createElement('span')
		text.textContent = name
		row.appendChild(checkbox)
		row.appendChild(text)
		return row
	}))
}

/**
 * 打开 AI 源可见性管理面板。
 * @returns {Promise<void>}
 */
async function openAiSourcePanel() {
	try {
		await openDialogFromTemplate('ai_source_panel', {}, {
			/** @param {HTMLDialogElement} dialog 对话框 */
			onReady: renderAiSourcePanel,
		})
	}
	catch (error) {
		showToastI18n('error', 'code.error.generic', { error: String(error.message || error) })
	}
}

/* ---------------- 角色 ---------------- */

/**
 * 更新角色 pill 显示。
 * @returns {void}
 */
function updateCharMenu() {
	elements.charPillLabel.textContent = state.charname || geti18n('code.char.none')
	elements.charSettingsLink.href = `/parts/shells:config/?partpath=${encodeURIComponent('chars/' + (state.charname || ''))}`
}

/**
 * 刷新角色列表。
 * @returns {Promise<void>}
 */
async function refreshChars() {
	state.chars = await getPartList('chars').catch(() => [])
}

/**
 * 渲染角色切换列表。
 * @param {HTMLDialogElement} dialog - 已打开的对话框。
 * @returns {void}
 */
function renderCharSwitchList(dialog) {
	const list = dialog.querySelector('#char-switch-list')
	list.replaceChildren(...state.chars.map(name => {
		const option = document.createElement('button')
		option.type = 'button'
		option.className = 'char-option' + (name === state.charname ? ' active' : '')
		option.textContent = name
		option.addEventListener('click', () => {
			state.charname = name
			setPref('charname', name)
			updateCharMenu()
			renderMessages()
			dialog.close()
		})
		return option
	}))
}

/**
 * 打开角色切换对话框。
 * @returns {Promise<void>}
 */
async function openCharSwitchDialog() {
	try {
		await openDialogFromTemplate('char_switch', {}, {
			/** @param {HTMLDialogElement} dialog 对话框 */
			onReady: renderCharSwitchList,
		})
	}
	catch (error) {
		showToastI18n('error', 'code.error.generic', { error: String(error.message || error) })
	}
}

/* ---------------- 工作区角色覆盖 / 推荐 ---------------- */

/** 当前角色推荐卡（右下角）。 */
let recommendationCard = null
/** 当前角色推荐配置（语言切换时按当前语种重建卡片）。 */
let recommendationSpec = null

/**
 * 仅移除推荐卡 DOM（保留配置，供语言切换重建）。
 * @returns {void}
 */
function removeRecommendationCard() {
	recommendationCard?.remove()
	recommendationCard = null
}

/**
 * 收起角色推荐卡（并清除配置，语言切换不再重建）。
 * @returns {void}
 */
function dismissCharRecommendation() {
	removeRecommendationCard()
	recommendationSpec = null
}

/**
 * 按当前语种渲染角色推荐卡。
 * @returns {void}
 */
function renderCharRecommendation() {
	removeRecommendationCard()
	const spec = recommendationSpec
	if (!spec?.partname) return
	// 固定悬浮卡片需包裹 `<nav>` 地标（axe region 规则要求内容在地标内）
	const card = document.createElement('nav')
	card.className = 'code-char-recommend hidden'
	card.setAttribute('aria-label', geti18n('code.char.recommendAria'))
	const text = document.createElement('div')
	text.className = 'code-char-recommend-text'
	// 角色名为工作区用户数据，跳过语种扫描
	text.setAttribute('user-content', '')
	text.textContent = geti18n('code.char.recommend', { charname: spec.partname })
	const actions = document.createElement('div')
	actions.className = 'code-char-recommend-actions'
	const installBtn = document.createElement('button')
	installBtn.type = 'button'
	installBtn.className = 'btn btn-xs btn-primary'
	installBtn.textContent = geti18n('code.char.recommendInstall')
	installBtn.addEventListener('click', () => void installRecommendedChar(spec))
	const closeBtn = document.createElement('button')
	closeBtn.type = 'button'
	closeBtn.className = 'btn btn-xs btn-ghost'
	closeBtn.textContent = geti18n('code.char.recommendDismiss')
	closeBtn.addEventListener('click', dismissCharRecommendation)
	actions.append(installBtn, closeBtn)
	card.append(text, actions)
	document.body.appendChild(card)
	recommendationCard = card
	requestAnimationFrame(() => card.classList.remove('hidden'))
}

/**
 * 安装工作区推荐角色。
 * @param {{partname: string, install_url?: string}} spec - 推荐配置。
 * @returns {Promise<void>}
 */
async function installRecommendedChar(spec) {
	try {
		await runPart('shells/install', ['install', spec.install_url || spec.partname])
		await refreshChars()
		if (state.chars.includes(spec.partname)) {
			state.charname = spec.partname
			setPref('charname', spec.partname)
			updateCharMenu()
		}
		showToastI18n('success', 'code.char.recommendInstalled', { charname: spec.partname })
	}
	catch (error) {
		showToastI18n('error', 'code.error.generic', { error: String(error.message || error) })
	}
	finally {
		dismissCharRecommendation()
	}
}

/**
 * 展示右下角角色推荐卡（未安装时）。
 * @param {{partname: string, install_url?: string}} spec - 推荐配置。
 * @returns {void}
 */
function showCharRecommendation(spec) {
	recommendationSpec = spec
	renderCharRecommendation()
}

/**
 * 应用工作区角色配置（已安装自动选中；未安装右下角推荐）。
 * @returns {Promise<void>}
 */
async function applyWorkspaceCharConfig() {
	if (!state.workspace) return
	const config = await api.getWorkspaceConfig(target()).catch(() => ({}))
	const spec = config.char
	if (!spec?.partname) return
	if (state.chars.includes(spec.partname)) {
		state.charname = spec.partname
		setPref('charname', spec.partname)
		updateCharMenu()
		renderMessages()
	}
	else showCharRecommendation(spec)
}

/* ---------------- 事件绑定 ---------------- */

elements.newTabButton.addEventListener('click', () => void startNewSession())
elements.homeToggle.addEventListener('click', renderHomeMenu)
// Alt+1..9 切换标签，Alt+T 新建会话（opencode 用 mod+t / mod+1..9，但浏览器页签保留键无法拦截，改用浏览器安全的 Alt 系）
document.addEventListener('keydown', event => {
	if (!event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return
	if (event.key >= '1' && event.key <= '9') {
		const tab = state.tabs[Number(event.key) - 1]
		if (tab) {
			event.preventDefault()
			void activateTab(tab)
		}
		return
	}
	if (event.key === 't' || event.key === 'T') {
		event.preventDefault()
		void startNewSession()
	}
})
elements.workspacePill.addEventListener('click', () => renderWorkspaceMenu())
elements.machinePill.addEventListener('click', () => renderMachineMenu())
elements.modePill.addEventListener('click', () => renderModeMenu())
elements.aiSourcePill.addEventListener('click', () => renderAiSourceMenu())
elements.shellPill.addEventListener('click', () => renderShellMenu())
elements.charPill.addEventListener('click', () => { })
elements.charSwitchButton.addEventListener('click', () => {
	void openCharSwitchDialog()
})
elements.sendButton.addEventListener('click', () => {
	if (state.generating) {
		void getSocket().then(ws => ws.send(JSON.stringify({ type: 'abort' }))).catch(() => { })
		return
	}
	const value = richInput.value.trim()
	if (!value) return
	richInput.value = ''
	if (state.shellMode) {
		exitShellMode()
		void execShellMode(value).catch(error => showToastI18n('error', 'code.error.generic', { error: String(error.message || error) }))
	}
	else void sendMessage(value)
})

/**
 * 退出 shell 模式（回到普通消息模式）。
 * @returns {void}
 */
function exitShellMode() {
	if (!state.shellMode) return
	state.shellMode = false
	document.querySelector('.code-composer-shell').classList.remove('shell-mode')
	elements.shellPillWrap.classList.add('hidden')
	updateComposerPlaceholder()
	removeGhost()
}

elements.composerInput.addEventListener('input', () => {
	if (!fromNav) historyNav.pos = null
	const value = richInput.value
	// ！/! 切 shell 执行模式：内容为空时键入叹号，进入后移除该字符，供干净命令输入
	if (!state.shellMode && (value === '！' || value === '!')) {
		state.shellMode = true
		richInput.value = ''
		document.querySelector('.code-composer-shell').classList.add('shell-mode')
		elements.shellPillWrap.classList.remove('hidden')
		updateComposerPlaceholder()
		void ensureHistory('shell')
		return
	}
	if (state.shellMode) 
		hideSlashPanel()
	
	else {
		// / 命令面板
		const caret = elements.composerInput.selectionStart
		const before = value.slice(0, caret)
		const slashMatch = before.match(/(?:^|\s)\/([^\s/]*)$/)
		if (slashMatch) {
			slashRange = { start: caret - slashMatch[1].length - 1, end: caret }
			showSlashPanel(slashMatch[1])
		}
		else hideSlashPanel()
	}
	updateGhost()
})
elements.composerInput.addEventListener('keydown', event => {
	if (!slashPanel.classList.contains('hidden')) {
		if (event.key === 'ArrowDown') {
			event.preventDefault()
			slashActive = (slashActive + 1) % slashSuggestions.length
			renderSlashItems()
			return
		}
		if (event.key === 'ArrowUp') {
			event.preventDefault()
			slashActive = (slashActive - 1 + slashSuggestions.length) % slashSuggestions.length
			renderSlashItems()
			return
		}
		if (event.key === 'Enter' || event.key === 'Tab') {
			event.preventDefault()
			void applySlashCommand(slashSuggestions[slashActive])
			return
		}
		if (event.key === 'Escape') {
			hideSlashPanel()
			return
		}
	}
	// shell 模式空内容 Backspace 退出
	if (state.shellMode && event.key === 'Backspace' && !richInput.value) {
		event.preventDefault()
		exitShellMode()
		return
	}
	// Tab / →（光标在末尾）接受影子补全
	if (event.key === 'Tab' || (event.key === 'ArrowRight' && elements.composerInput.selectionStart === richInput.value.length)) 
		if (acceptGhost()) {
			event.preventDefault()
			return
		}
	
	// Tab 轮换 mode（无影子补全且非 shell 模式）
	if (event.key === 'Tab' && !event.shiftKey && !event.ctrlKey && !event.altKey && !state.shellMode) {
		event.preventDefault()
		cycleMode()
		return
	}
	// ↑/↓ 边缘行历史导航
	if (event.key === 'ArrowUp' && !event.shiftKey && !event.ctrlKey && !event.altKey && isAtFirstLine()) {
		event.preventDefault()
		navHistory(-1)
		return
	}
	if (event.key === 'ArrowDown' && !event.shiftKey && !event.ctrlKey && !event.altKey && isAtLastLine()) {
		event.preventDefault()
		navHistory(1)
		return
	}
	// Ctrl/Cmd+Enter 发送
	if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
		event.preventDefault()
		elements.sendButton.click()
	}
})

/* ---------------- 文件夹浏览器 ---------------- */

let browseMachineId = '0'
/** @type {HTMLDialogElement|null} 当前打开的浏览对话框。 */
let browseDialog = null

/**
 * 打开文件夹浏览器（当前机器）。
 * @returns {Promise<void>}
 */
async function openFolderBrowser() {
	browseMachineId = state.machine
	try {
		browseDialog = await openDialogFromTemplate('folder_browser', {}, {
			// onReady：绑定浏览操作并加载根目录
			/**
			 * 绑定浏览操作并加载根目录。
			 * @param {HTMLDialogElement} dialog 对话框。
			 * @returns {Promise<void>} 根目录加载完成。
			 */
			onReady: dialog => {
				dialog.querySelector('#folder-go-button').addEventListener('click', () => {
					void openFolderEntries(dialog.querySelector('#folder-path-input').value)
				})
				dialog.querySelector('#folder-path-input').addEventListener('keydown', event => {
					if (event.key === 'Enter') void openFolderEntries(event.currentTarget.value)
				})
				dialog.querySelector('#folder-select-button').addEventListener('click', () => {
					void selectBrowsedFolder(dialog.querySelector('#folder-path-input').value)
				})
				return openFolderEntries('')
			},
		})
	}
	catch (error) {
		browseDialog = null
		showToastI18n('error', 'code.error.generic', { error: String(error.message || error) })
	}
}

/**
 * 列出目录内容。
 * @param {string} path - 目录路径。
 * @returns {Promise<void>}
 */
async function openFolderEntries(path) {
	const dialog = browseDialog
	if (!dialog) return
	try {
		const data = await api.browseMachine(browseMachineId, path)
		dialog.querySelector('#folder-path-input').value = data.path
		dialog.querySelector('#folder-entries').replaceChildren(...data.entries.map(entry => {
			const row = document.createElement('button')
			row.type = 'button'
			row.className = 'code-folder-entry'
			row.textContent = (entry.isDirectory ? '📁 ' : '📄 ') + entry.name
			row.addEventListener('click', () => {
				if (entry.isDirectory) void openFolderEntries(entry.path)
			})
			row.addEventListener('dblclick', () => {
				if (entry.isFile) void openFolderEntries(data.path.replace(/[^\\/]+$/, ''))
			})
			return row
		}))
	}
	catch (error) {
		showToastI18n('error', 'code.error.generic', { error: String(error.message || error) })
	}
}

/**
 * 选定当前目录为工作区。
 * @param {string} path - 目录路径。
 * @returns {Promise<void>}
 */
async function selectBrowsedFolder(path) {
	const dialog = browseDialog
	if (!path || !dialog) return
	const machine = browseMachineId
	const name = path.split(/[\\/]/).filter(Boolean).pop() || path
	const data = await api.addWorkspace({ name, machine, path }).catch(error => {
		showToastI18n('error', 'code.error.generic', { error: String(error.message || error) })
		return null
	})
	if (!data) return
	state.workspaces = data.list
	state.workspace = state.workspaces.find(w => w.path === path && w.machine === machine) || null
	renderWorkspacePillLabel()
	renderWorkspaceMenu()
	renderHomeMenu()
	dialog.close()
	await selectWorkspace(state.workspace?.id || '')
}

/* ---------------- 启动 ---------------- */

/**
 * 语言切换时的动态文案重渲染。
 * @returns {void}
 */
function rerenderDynamicText() {
	renderHomeMenu()
	renderTabs()
	renderMachinePillLabel()
	renderMachineMenu()
	renderWorkspacePillLabel()
	renderWorkspaceMenu()
	renderShellMenu()
	renderShellPillLabel()
	renderModeMenu()
	renderModePillLabel()
	renderAiSourceMenu()
	renderAiSourcePillLabel()
	updateCharMenu()
	updateSendButton()
	updateComposerPlaceholder()
	updateEmptyMode()
	renderCharRecommendation()
	backToBottom.setAttribute('aria-label', geti18n('code.messages.backToBottom'))
}

/**
 * 初始化。
 * @returns {Promise<void>}
 */
async function boot() {
	state.username = (await whoami()).username
	await initTranslations('code')
	// 语言切换时重渲染动态文案（geti18n 的 textContent 不随 setLanguage 自动更新）
	onLanguageChange(rerenderDynamicText)
	const [machines, workspaces] = await Promise.all([
		api.getMachines().then(r => r.machines).catch(() => [{ id: '0', description: 'localhost', isConnected: true, deviceInfo: null }]),
		api.getWorkspaces().then(r => r.list).catch(() => []),
	])
	state.machines = machines
	state.workspaces = workspaces
	state.machine = getPref('machine', '0')
	if (!machines.some(m => String(m.id) === state.machine && (m.id === '0' || m.isConnected))) state.machine = '0'
	state.charname = getPref('charname') || await getAnyPreferredDefaultPart('chars') || null
	state.profile = getPref('profile', 'build')
	state.aiSource = getPref('aiSource', '')
	state.shells = await api.getMachineShells(state.machine).then(r => r.shells).catch(() => [])
	await Promise.all([refreshProfiles(), refreshAiSources(), refreshAllSessions(), refreshChars()])
	// `fount run` 打开的页面经 ?workspace= 直达目标工作区
	const urlWorkspace = new URLSearchParams(location.search).get('workspace')
	const savedWorkspace = urlWorkspace || getPref('workspace')
	state.workspace = workspaces.find(w => w.id === savedWorkspace) || workspaces[0] || null
	if (state.workspace && urlWorkspace) setPref('workspace', state.workspace.id)
	// 标签恢复：丢弃指向已消失工作区/会话的标签；?workspace= 直达时聚焦该工作区的新草稿
	loadTabPrefs()
	state.tabs = state.tabs.filter(tab =>
		state.workspaces.some(w => w.id === tab.workspaceId)
		&& state.allSessions.some(s => s.id === tab.id && s.workspaceId === tab.workspaceId))
	let initialTab = activeTab() || state.tabs[0] || null
	if (urlWorkspace) {
		initialTab = createDraftTab(state.workspace?.id || '')
		state.activeTabKey = ''
	}
	else if (!initialTab) initialTab = createDraftTab(state.workspace?.id || '')
	// 恢复的活动标签指向其他工作区时以标签为准
	if (!urlWorkspace && initialTab.workspaceId && initialTab.workspaceId !== state.workspace?.id)
		state.workspace = state.workspaces.find(w => w.id === initialTab.workspaceId) || state.workspace
	state.activeTabKey = tabKeyOf(initialTab)
	renderTabs()
	await activateTab(initialTab)
	rerenderDynamicText()
	void ensureHistory(state.shellMode ? 'shell' : 'message')
	if (state.workspace) void applyWorkspaceCharConfig()
	elements.composerInput.focus()
}

boot().catch(handleError('code.error.generic'))
