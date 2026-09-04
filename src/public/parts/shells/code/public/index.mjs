/**
 * code shell 前端主逻辑：会话 / composer（@file、/ 命令、! shell 模式）/ pill 选择器 / 空态引导。
 */
import { createMarkdownRichInput } from '../../scripts/components/markdownRichInput.mjs'
import { attachMentionAutocomplete } from '../../scripts/components/mentionAutocomplete.mjs'
import { whoami } from '../../scripts/endpoints/base.mjs'
import { getPartList, getAnyPreferredDefaultPart } from '../../scripts/endpoints/parts.mjs'
import { handleError } from '../../scripts/features/errorHandlers.mjs'
import { renderMarkdownAsString } from '../../scripts/features/markdown/index.mjs'
import { confirmAction } from '../../scripts/features/promptDialog.mjs'
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
	sessionsList: $('sessions-list'),
	newSessionButton: $('new-session-button'),
	sessionsCloseButton: $('sessions-close-button'),
	sessionsToggleButton: $('sessions-toggle-button'),
	sessionsBackdrop: $('sessions-backdrop'),
	sessionTitle: $('session-title'),
	workspacePill: $('workspace-pill'),
	workspacePillLabel: $('workspace-pill-label'),
	workspaceMenu: $('workspace-menu'),
	machinePill: $('machine-pill'),
	machinePillLabel: $('machine-pill-label'),
	machineMenu: $('machine-menu'),
	charMenuButton: $('char-menu-button'),
	charMenuLabel: $('char-menu-label'),
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
	composerInput: $('composer-input'),
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
	sessions: [],
	session: null,
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
	dirty: false,
}

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

/* ---------------- 会话 ---------------- */

/**
 * 当前会话的空会话工厂。
 * @returns {object} 会话对象。
 */
function newSessionObject() {
	const now = new Date().toISOString()
	return {
		id: crypto.randomUUID().slice(0, 8),
		title: '',
		charname: state.charname || '',
		profile: state.profile,
		ai_source: state.aiSource,
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
 * 渲染会话列表。
 * @returns {void}
 */
function renderSessions() {
	if (!state.sessions.length) {
		const empty = document.createElement('div')
		empty.className = 'code-sessions-empty'
		empty.textContent = state.workspace ? geti18n('code.sessions.empty') : geti18n('code.workspaces.none')
		elements.sessionsList.replaceChildren(empty)
		return
	}
	elements.sessionsList.replaceChildren(...state.sessions.map(session => {
		const item = document.createElement('div')
		item.className = 'code-session-item' + (state.session?.id === session.id ? ' active' : '')
		const body = document.createElement('button')
		body.type = 'button'
		body.className = 'code-session-item-body'
		body.addEventListener('click', () => void selectSession(session.id))
		const title = document.createElement('span')
		title.className = 'code-session-item-title'
		title.textContent = session.title || geti18n('code.sessions.untitled')
		body.appendChild(title)
		const time = document.createElement('span')
		time.className = 'code-session-item-time'
		time.textContent = formatSessionTime(session.updated || session.created)
		body.appendChild(time)
		item.appendChild(body)
		const del = document.createElement('button')
		del.type = 'button'
		del.className = 'btn btn-xs btn-ghost btn-square code-session-item-delete'
		del.setAttribute('aria-label', geti18n('code.sessions.deleteAria'))
		del.innerHTML = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12"></path><path d="M18 6L6 18"></path></svg>'
		del.addEventListener('click', event => {
			event.stopPropagation()
			void deleteSessionFlow(session)
		})
		item.appendChild(del)
		return item
	}))
}

/**
 * 删除会话流程（确认 → 调用后端 → 刷新）。
 * @param {object} session - 会话。
 * @returns {Promise<void>}
 */
async function deleteSessionFlow(session) {
	if (!state.workspace) return
	const ok = await confirmAction('code.sessions.deleteConfirm', { title: session.title || geti18n('code.sessions.untitled') })
	if (!ok) return
	try {
		await api.deleteSession(target(), session.id)
	}
	catch (error) {
		showToastI18n('error', 'code.error.generic', { error: String(error.message || error) })
		return
	}
	if (state.session?.id === session.id) {
		state.session = null
		renderMessages()
	}
	await refreshSessions()
}

/**
 * 刷新会话列表（从工作区读取）。
 * @returns {Promise<void>}
 */
async function refreshSessions() {
	if (!state.workspace) {
		state.sessions = []
		renderSessions()
		return
	}
	try {
		state.sessions = (await api.listSessions(target())).sessions
	}
	catch {
		state.sessions = []
	}
	renderSessions()
}

/**
 * 选择会话。
 * @param {string} id - 会话 id。
 * @returns {Promise<void>}
 */
async function selectSession(id) {
	try {
		state.session = await api.loadSession(target(), id)
	}
	catch {
		state.session = state.sessions.find(s => s.id === id) || null
	}
	state.charname = state.session?.charname || state.charname
	state.aiSource = state.session?.ai_source ?? ''
	state.profile = state.session?.profile || state.profile
	updateCharMenu()
	renderModePillLabel()
	renderAiSourcePillLabel()
	renderMessages()
	renderSessions()
}

/**
 * 开始新会话。
 * @returns {void}
 */
function startNewSession() {
	state.session = newSessionObject()
	state.sessions.unshift({ ...state.session })
	renderSessions()
	renderMessages()
	closeSessionsDrawer()
	elements.composerInput.focus()
}

/**
 * 顶栏会话标题。
 * @returns {void}
 */
function updateSessionTitle() {
	elements.sessionTitle.textContent = state.session?.title || geti18n('code.sessions.untitled')
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
 * 渲染空态引导（无工作区 / 新会话 / 未选角色）。
 * @returns {void}
 */
function renderEmpty() {
	const empty = document.createElement('div')
	empty.className = 'code-empty'
	if (!state.workspace) {
		const icon = document.createElement('div')
		icon.className = 'code-empty-icon'
		icon.textContent = '🗂'
		const title = document.createElement('div')
		title.className = 'code-empty-title'
		title.textContent = geti18n('code.empty.noWorkspace.title')
		const desc = document.createElement('div')
		desc.className = 'code-empty-description'
		desc.textContent = geti18n('code.empty.noWorkspace.description')
		const action = document.createElement('button')
		action.type = 'button'
		action.className = 'btn btn-sm btn-primary mt-1'
		action.textContent = geti18n('code.empty.noWorkspace.action')
		action.addEventListener('click', () => void openFolderBrowser())
		empty.append(icon, title, desc, action)
	}
	else {
		const icon = document.createElement('div')
		icon.className = 'code-empty-icon'
		icon.textContent = '💬'
		const title = document.createElement('div')
		title.className = 'code-empty-title'
		title.textContent = geti18n('code.empty.noSession.title')
		const desc = document.createElement('div')
		desc.className = 'code-empty-description'
		desc.textContent = geti18n('code.empty.noSession.description', { charname: state.charname || geti18n('code.char.none') })
		empty.append(icon, title, desc)
	}
	return empty
}

/**
 * 渲染全部消息。
 * @returns {void}
 */
function renderMessages() {
	const entries = state.session?.entries || []
	if (!entries.length) {
		elements.messages.replaceChildren(renderEmpty(), backToBottom)
		updateBackToBottom()
		return
	}
	elements.messages.replaceChildren(...entries.map(renderEntryBubble), backToBottom)
	scrollMessagesBottom()
	updateSessionTitle()
}

/**
 * 追加消息气泡。
 * @param {object} entry - 会话条目。
 * @returns {HTMLElement} 气泡元素。
 */
function appendEntryBubble(entry) {
	const bubble = renderEntryBubble(entry)
	// 首条消息到达时移除空态引导（renderMessages 只在无条目时重渲染）
	elements.messages.querySelector('.code-empty')?.remove()
	elements.messages.insertBefore(bubble, backToBottom)
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
		if (generatingBubble?.renderer) generatingBubble.renderer.setTarget(msg.content)
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
		state.session?.entries.push(...msg.entries || [])
		for (const entry of msg.entries || []) appendEntryBubble(entry)
		state.generating = false
		endGeneratingBubble()
		const fallback = geti18n('code.error.generate')
		const text = `${fallback}\n\`\`\`\n${msg.error}\n\`\`\``
		state.session?.entries.push({ id: crypto.randomUUID().slice(0, 8), uid: 'system', role: 'system', name: 'error', content: text, time: new Date().toISOString() })
		appendEntryBubble(state.session?.entries.at(-1))
		markSessionDirty()
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
	state.session.entries.push(...entries)
	for (const entry of entries) appendEntryBubble(entry)
	if (memory) state.session.memory = memory
	state.session.updated = new Date().toISOString()
	if (!state.session.title && entries.length)
		state.session.title = (entries.find(e => e.role === 'user')?.content || '').slice(0, 40) || state.session.title
	state.generating = false
	updateSendButton()
	updateSessionTitle()
	if (aborted) showToastI18n('info', 'code.error.aborted')
	renderSessions()
	markSessionDirty()
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
	if (!state.session) startNewSession()
	state.session.charname = state.charname || state.session.charname
	if (!state.session.charname) {
		showToastI18n('error', 'code.error.noChar')
		return
	}
	state.session.profile = state.profile
	state.session.ai_source = state.aiSource
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
	if (!state.session) startNewSession()
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
}

/* ---------------- 缓存 flush ---------------- */

/**
 * 标记会话为待持久化；焦点已移出窗口且无生成任务时立即写盘。
 * 无工作区时会话无处落盘，跳过以免无效写盘报错。
 * @returns {void}
 */
function markSessionDirty() {
	if (!state.workspace) return
	state.dirty = true
	if (!state.generating && !document.hasFocus())
		void flushSession()
}

/**
 * 持久化会话到工作区 `.fount/code/sessions`（生成中、无变更、无工作区时跳过）。
 * @returns {Promise<void>}
 */
async function flushSession() {
	if (state.generating || !state.dirty || !state.session || !state.workspace) return
	state.dirty = false
	try {
		await api.putSession(target(), state.session)
	}
	catch (error) {
		state.dirty = true
		showToastI18n('error', 'code.error.generic', { error: String(error.message || error) })
	}
}

window.addEventListener('blur', () => void flushSession())
document.addEventListener('visibilitychange', () => {
	if (document.hidden) void flushSession()
})
window.addEventListener('beforeunload', () => {
	if (state.dirty && state.session && state.workspace && !state.generating)
		api.putSession(target(), state.session).catch(() => { })
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
 * 选择工作区。
 * @param {string} id - 工作区 id。
 * @returns {Promise<void>}
 */
async function selectWorkspace(id) {
	const workspace = state.workspaces.find(w => w.id === id)
	if (!workspace) return
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
	await Promise.all([refreshSessions(), refreshProfiles()])
	renderSessions()
	renderMessages()
	renderWorkspacePillLabel()
	renderWorkspaceMenu()
}

/**
 * 移除当前工作区。
 * @returns {Promise<void>}
 */
async function removeCurrentWorkspace() {
	if (!state.workspace) return
	state.workspaces = state.workspaces.filter(w => w.id !== state.workspace.id)
	await api.removeWorkspace(state.workspace.id).catch(() => { })
	state.workspace = null
	setPref('workspace', '')
	state.session = null
	renderWorkspacePillLabel()
	renderWorkspaceMenu()
	await Promise.all([refreshSessions(), refreshProfiles()])
	renderSessions()
	renderMessages()
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
 * 更新角色菜单显示。
 * @returns {void}
 */
function updateCharMenu() {
	elements.charMenuLabel.textContent = state.charname || geti18n('code.char.none')
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

/* ---------------- 移动端侧栏 ---------------- */

/**
 * 打开/关闭移动端会话侧栏。
 * @param {boolean} open - 目标开合状态。
 * @returns {void}
 */
function toggleSessionsDrawer(open) {
	const forceOpen = open ?? !document.querySelector('.code-sessions').classList.contains('open')
	document.querySelector('.code-sessions').classList.toggle('open', forceOpen)
	elements.sessionsBackdrop.classList.toggle('hidden', !forceOpen)
}

/**
 * 关闭移动端会话侧栏。
 * @returns {void}
 */
function closeSessionsDrawer() {
	toggleSessionsDrawer(false)
}

/* ---------------- 事件绑定 ---------------- */

elements.newSessionButton.addEventListener('click', startNewSession)
elements.sessionsToggleButton.addEventListener('click', () => toggleSessionsDrawer())
elements.sessionsCloseButton.addEventListener('click', () => toggleSessionsDrawer(false))
elements.sessionsBackdrop.addEventListener('click', () => toggleSessionsDrawer(false))
elements.workspacePill.addEventListener('click', () => renderWorkspaceMenu())
elements.machinePill.addEventListener('click', () => renderMachineMenu())
elements.modePill.addEventListener('click', () => renderModeMenu())
elements.aiSourcePill.addEventListener('click', () => renderAiSourceMenu())
elements.shellPill.addEventListener('click', () => renderShellMenu())
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
		state.shellMode = false
		document.querySelector('.code-composer-shell').classList.remove('shell-mode')
		elements.shellPillWrap.classList.add('hidden')
		suppressComposerInput = true
		richInput.value = ''
		updateComposerPlaceholder()
		void execShellMode(value.replace(/^[!！]/, '')).catch(error => showToastI18n('error', 'code.error.generic', { error: String(error.message || error) }))
	}
	else void sendMessage(value)
})

/** 程序性设置 richInput.value 引发的 input 事件抑制标志。 */
let suppressComposerInput = false

elements.composerInput.addEventListener('input', () => {
	if (suppressComposerInput) {
		suppressComposerInput = false
		return
	}
	const value = richInput.value
	// ！/! 切 shell 执行模式：内容为空时键入全角/半角叹号；保留 ！ 作为模式提示
	if (!state.shellMode && (value === '！' || value === '!')) {
		state.shellMode = true
		document.querySelector('.code-composer-shell').classList.add('shell-mode')
		elements.shellPillWrap.classList.remove('hidden')
		updateComposerPlaceholder()
		return
	}
	if (state.shellMode) {
		// 删光内容退出 shell 模式
		if (!value) {
			state.shellMode = false
			suppressComposerInput = true
			richInput.value = ''
			document.querySelector('.code-composer-shell').classList.remove('shell-mode')
			elements.shellPillWrap.classList.add('hidden')
			updateComposerPlaceholder()
		}
		hideSlashPanel()
		return
	}
	// / 命令面板
	const caret = richInput.selectionStart
	const before = value.slice(0, caret)
	const slashMatch = before.match(/(?:^|\s)\/([^\s/]*)$/)
	if (slashMatch) {
		slashRange = { start: caret - slashMatch[1].length - 1, end: caret }
		showSlashPanel(slashMatch[1])
	}
	else hideSlashPanel()
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
	// Tab 轮换 mode
	if (event.key === 'Tab' && !event.shiftKey && !event.ctrlKey && !event.altKey && !state.shellMode) {
		event.preventDefault()
		cycleMode()
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
	dialog.close()
	await selectWorkspace(state.workspace?.id || '')
}

/* ---------------- 启动 ---------------- */

/**
 * 语言切换时的动态文案重渲染。
 * @returns {void}
 */
function rerenderDynamicText() {
	renderSessions()
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
	updateSessionTitle()
	updateComposerPlaceholder()
	backToBottom.setAttribute('aria-label', geti18n('code.messages.backToBottom'))
	if (!(state.session?.entries?.length || 0)) renderMessages()
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
	const savedWorkspace = getPref('workspace')
	state.workspace = workspaces.find(w => w.id === savedWorkspace) || workspaces[0] || null
	state.charname = getPref('charname') || await getAnyPreferredDefaultPart('chars') || null
	state.profile = getPref('profile', 'build')
	state.aiSource = getPref('aiSource', '')
	state.shells = await api.getMachineShells(state.machine).then(r => r.shells).catch(() => [])
	renderMachinePillLabel()
	renderWorkspacePillLabel()
	updateCharMenu()
	updateSendButton()
	renderShellPillLabel()
	await Promise.all([refreshProfiles(), refreshAiSources(), refreshSessions(), refreshChars()])
	renderMessages()
	rerenderDynamicText()
	elements.composerInput.focus()
}

boot().catch(handleError('code.error.generic'))
