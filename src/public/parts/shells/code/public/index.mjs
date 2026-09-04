/**
 * code shell 前端主逻辑：会话 / composer（@file、/ 命令、! shell 模式）/ 下拉与面板。
 */
import { createMarkdownRichInput } from '../../scripts/components/markdownRichInput.mjs'
import { attachMentionAutocomplete } from '../../scripts/components/mentionAutocomplete.mjs'
import { whoami } from '../../scripts/endpoints/base.mjs'
import { getPartList, getAnyPreferredDefaultPart } from '../../scripts/endpoints/parts.mjs'
import { renderMarkdownAsString } from '../../scripts/features/markdown/index.mjs'
import { showToastI18n } from '../../scripts/features/toast.mjs'
import { initTranslations, geti18n, onLanguageChange } from '../../scripts/i18n/index.mjs'
import { applyTheme } from '../../scripts/theme/index.mjs'
import { StreamRenderer } from '/parts/shells:chat/src/ui/StreamRenderer.mjs'

import * as api from './src/endpoints.mjs'

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
	machineSelect: $('machine-select'),
	workspaceSelect: $('workspace-select'),
	workspaceManageButton: $('workspace-manage-button'),
	workspaceBrowseButton: $('workspace-browse-button'),
	workspaceRemoveButton: $('workspace-remove-button'),
	charMenuButton: $('char-menu-button'),
	charSwitchButton: $('char-switch-button'),
	charSettingsLink: $('char-settings-link'),
	messages: $('messages'),
	composerInput: $('composer-input'),
	modeSelect: $('mode-select'),
	aiSourceSelect: $('ai-source-select'),
	shellModeControl: $('shell-mode-control'),
	shellSelect: $('shell-select'),
	sendButton: $('send-button'),
	aiSourcePanel: $('ai-source-panel'),
	aiSourceList: $('ai-source-list'),
	folderBrowser: $('folder-browser'),
	folderPathInput: $('folder-path-input'),
	folderGoButton: $('folder-go-button'),
	folderEntries: $('folder-entries'),
	folderSelectButton: $('folder-select-button'),
	commandParams: $('command-params'),
	commandParamsTitle: $('command-params-title'),
	commandParamsFields: $('command-params-fields'),
	commandParamsRun: $('command-params-run'),
	charSwitchDialog: $('char-switch-dialog'),
	charSwitchList: $('char-switch-list'),
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
 * 渲染会话列表。
 * @returns {void}
 */
function renderSessions() {
	elements.sessionsList.replaceChildren(...state.sessions.map(session => {
		const item = document.createElement('button')
		item.type = 'button'
		item.className = 'code-session-item' + (state.session?.id === session.id ? ' active' : '')
		item.textContent = session.title || geti18n('code.sessions.untitled')
		item.addEventListener('click', () => void selectSession(session.id))
		return item
	}))
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
	renderModeOptions()
	renderAiSourceOptions()
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
	elements.composerInput.focus()
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
	if (entry.role !== 'user' && entry.name) {
		const name = document.createElement('div')
		name.className = 'code-message-name'
		name.textContent = entry.name
		bubble.appendChild(name)
	}
	const body = document.createElement('div')
	bubble.appendChild(body)
	if (entry.role === 'tool' || entry.role === 'system') {
		const details = document.createElement('details')
		details.className = 'code-tool-log'
		const summary = document.createElement('summary')
		summary.textContent = entry.name || entry.role
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

/**
 * 渲染全部消息。
 * @returns {void}
 */
function renderMessages() {
	const entries = state.session?.entries || []
	elements.messages.replaceChildren(...entries.map(renderEntryBubble))
	elements.messages.scrollTop = elements.messages.scrollHeight
}

/**
 * 追加消息气泡。
 * @param {object} entry - 会话条目。
 * @returns {HTMLElement} 气泡元素。
 */
function appendEntryBubble(entry) {
	const bubble = renderEntryBubble(entry)
	elements.messages.appendChild(bubble)
	elements.messages.scrollTop = elements.messages.scrollHeight
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
slashPanel.className = 'hidden'
slashPanel.style.cssText = 'position:absolute;z-index:60;display:flex;flex-direction:column;gap:2px;max-height:16rem;overflow:auto;'
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
		button.className = 'code-folder-entry' + (index === slashActive ? ' active' : '')
		const name = document.createElement('strong')
		name.textContent = '/' + cmd.name
		const desc = document.createElement('small')
		desc.className = 'opacity-60'
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
	slashPanel.style.top = `${hostRect.top - Math.min(slashSuggestions.length * 36 + 8, 256)}px`
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
function openCommandParams(command) {
	return new Promise(resolve => {
		let settled = false
		/** @type {(value: Record<string, string>|null) => void} */
		const settle = value => {
			if (settled) return
			settled = true
			resolve(value)
		}
		elements.commandParamsTitle.textContent = '/' + command.name
		const inputs = {}
		elements.commandParamsFields.replaceChildren(...Object.entries(command.params || {}).map(([name, spec]) => {
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
		/**
		 * 参数填写确认：收集输入并关闭对话框。
		 * @returns {void}
		 */
		elements.commandParamsRun.onclick = () => {
			/** @type {Record<string, string>} */
			const argv = {}
			for (const [name, input] of Object.entries(inputs)) argv[name] = input.value
			elements.commandParams.close()
			settle(argv)
		}
		/**
		 * 对话框关闭：以取消结算。
		 * @returns {void}
		 */
		elements.commandParams.onclose = () => settle(null)
		elements.commandParams.showModal()
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
	bubble.appendChild(name)
	bubble.appendChild(body)
	elements.messages.appendChild(bubble)
	elements.messages.scrollTop = elements.messages.scrollHeight
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
	if (aborted) showToastI18n('info', 'code.error.aborted')
	renderSessions()
	markSessionDirty()
}

/**
 * 更新发送按钮（生成中变停止）。
 * @returns {void}
 */
function updateSendButton() {
	elements.sendButton.textContent = state.generating
		? geti18n('code.composer.stop')
		: geti18n('code.composer.send')
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
 * @returns {void}
 */
function markSessionDirty() {
	state.dirty = true
	if (!state.generating && !document.hasFocus())
		void flushSession()
}

/**
 * 持久化会话到工作区 `.fount/code/sessions`（生成中或无变更时跳过）。
 * @returns {Promise<void>}
 */
async function flushSession() {
	if (state.generating || !state.dirty || !state.session) return
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
	if (state.dirty && state.session && !state.generating)
		api.putSession(target(), state.session).catch(() => { })
})

/* ---------------- 机器 / 工作区 ---------------- */

/**
 * 渲染机器下拉。
 * @returns {void}
 */
function renderMachineOptions() {
	elements.machineSelect.replaceChildren(...state.machines.map(machine => {
		const option = document.createElement('option')
		option.value = String(machine.id)
		option.textContent = machine.id === '0'
			? geti18n('code.machine.local')
			: `${machine.description || machine.deviceInfo?.hostname || `#${machine.id}`}${machine.isConnected ? '' : ' (offline)'}`
		option.disabled = machine.id !== '0' && !machine.isConnected
		return option
	}))
	elements.machineSelect.value = state.machine
}

/**
 * 渲染工作区下拉。
 * @returns {void}
 */
function renderWorkspaceOptions() {
	const placeholder = document.createElement('option')
	placeholder.value = ''
	placeholder.textContent = geti18n('code.workspaces.none')
	elements.workspaceSelect.replaceChildren(placeholder, ...state.workspaces.map(workspace => {
		const option = document.createElement('option')
		option.value = workspace.id
		option.textContent = workspace.name || workspace.path
		return option
	}))
	elements.workspaceSelect.value = state.workspace?.id || ''
}

/**
 * 应用机器变更。
 * @returns {Promise<void>}
 */
async function applyMachineChange() {
	state.machine = elements.machineSelect.value || '0'
	setPref('machine', state.machine)
	state.shells = await api.getMachineShells(state.machine).then(r => r.shells).catch(() => [])
	renderShellOptions()
}

/**
 * 应用工作区变更。
 * @returns {Promise<void>}
 */
async function applyWorkspaceChange() {
	const id = elements.workspaceSelect.value
	state.workspace = state.workspaces.find(w => w.id === id) || null
	if (state.workspace && state.workspace.machine !== state.machine) {
		state.machine = state.workspace.machine
		elements.machineSelect.value = state.machine
		setPref('machine', state.machine)
		await applyMachineChange()
	}
	setPref('workspace', state.workspace?.id || '')
	state.session = null
	await Promise.all([refreshSessions(), refreshProfiles()])
	renderSessions()
	renderMessages()
}

/**
 * 渲染 shell 下拉（! 模式）。
 * @returns {void}
 */
function renderShellOptions() {
	elements.shellSelect.replaceChildren(...(state.shells.length ? state.shells : ['']).map(shell => {
		const option = document.createElement('option')
		option.value = shell
		option.textContent = shell || geti18n('code.composer.shellDefault')
		return option
	}))
	elements.shellSelect.disabled = state.shells.length <= 1
}

/* ---------------- profile / AI 源 ---------------- */

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
	
	renderModeOptions()
}

/**
 * 渲染 mode/profile 下拉。
 * @returns {void}
 */
function renderModeOptions() {
	const names = new Set(state.profiles.map(p => p.name))
	if (!names.has(state.profile)) state.profile = state.profiles[0]?.name || 'build'
	elements.modeSelect.replaceChildren(...state.profiles.map(profile => {
		const option = document.createElement('option')
		option.value = profile.name
		option.textContent = profile.name + (profile.source === 'builtin' ? '' : ` (${profile.source})`)
		return option
	}))
	elements.modeSelect.value = state.profile
}

/**
 * Tab 键轮换 mode（溢出归 0）。
 * @returns {void}
 */
function cycleMode() {
	const index = state.profiles.findIndex(p => p.name === state.profile)
	state.profile = state.profiles[(index + 1) % state.profiles.length]?.name || 'build'
	elements.modeSelect.value = state.profile
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
	renderAiSourceOptions()
}

/**
 * 渲染 AI 源下拉。
 * @returns {void}
 */
function renderAiSourceOptions() {
	const visible = state.aiSources.filter(name => !state.aiHidden.includes(name))
	const own = document.createElement('option')
	own.value = ''
	own.textContent = geti18n('code.aiSource.charOwn')
	elements.aiSourceSelect.replaceChildren(own, ...visible.map(name => {
		const option = document.createElement('option')
		option.value = name
		option.textContent = name + (state.aiDefaults?.includes(name) ? ' ★' : '')
		return option
	}), (() => {
		const manage = document.createElement('option')
		manage.value = '__manage__'
		manage.textContent = geti18n('code.aiSource.manage')
		return manage
	})())
	elements.aiSourceSelect.value = state.aiSource
	if (elements.aiSourceSelect.value !== state.aiSource) {
		state.aiSource = ''
		elements.aiSourceSelect.value = ''
	}
}

/**
 * 渲染 AI 源可见性管理面板。
 * @returns {void}
 */
function renderAiSourcePanel() {
	elements.aiSourceList.replaceChildren(...state.aiSources.map(name => {
		const row = document.createElement('label')
		row.className = 'ai-source-row'
		const checkbox = document.createElement('input')
		checkbox.type = 'checkbox'
		checkbox.className = 'checkbox checkbox-sm'
		checkbox.checked = !state.aiHidden.includes(name)
		checkbox.addEventListener('change', () => {
			if (checkbox.checked) state.aiHidden = state.aiHidden.filter(n => n !== name)
			else state.aiHidden = [...state.aiHidden, name]
			api.setAiSourceVisibility(state.aiHidden).then(renderAiSourceOptions).catch(() => { })
		})
		const text = document.createElement('span')
		text.textContent = name
		row.appendChild(checkbox)
		row.appendChild(text)
		return row
	}))
}

/* ---------------- 角色 ---------------- */

/**
 * 更新角色菜单显示。
 * @returns {void}
 */
function updateCharMenu() {
	elements.charMenuButton.textContent = state.charname || geti18n('code.char.none')
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
 * @returns {void}
 */
function renderCharSwitchList() {
	elements.charSwitchList.replaceChildren(...state.chars.map(name => {
		const option = document.createElement('button')
		option.type = 'button'
		option.className = 'char-option' + (name === state.charname ? ' active' : '')
		option.textContent = name
		option.addEventListener('click', () => {
			state.charname = name
			setPref('charname', name)
			updateCharMenu()
			elements.charSwitchDialog.close()
		})
		return option
	}))
}

/* ---------------- 事件绑定 ---------------- */

elements.newSessionButton.addEventListener('click', startNewSession)
elements.machineSelect.addEventListener('change', () => void applyMachineChange())
elements.workspaceSelect.addEventListener('change', () => void applyWorkspaceChange())
elements.workspaceBrowseButton.addEventListener('click', () => {
	openFolderBrowser()
})
elements.workspaceRemoveButton.addEventListener('click', async () => {
	if (!state.workspace) return
	state.workspaces = state.workspaces.filter(w => w.id !== state.workspace.id)
	await api.removeWorkspace(state.workspace.id).catch(() => { })
	state.workspace = null
	setPref('workspace', '')
	renderWorkspaceOptions()
	void applyWorkspaceChange()
})
elements.charSwitchButton.addEventListener('click', () => {
	renderCharSwitchList()
	elements.charSwitchDialog.showModal()
})
elements.modeSelect.addEventListener('change', () => {
	state.profile = elements.modeSelect.value
	setPref('profile', state.profile)
})
elements.aiSourceSelect.addEventListener('change', () => {
	if (elements.aiSourceSelect.value === '__manage__') {
		renderAiSourcePanel()
		elements.aiSourcePanel.showModal()
		renderAiSourceOptions()
		return
	}
	state.aiSource = elements.aiSourceSelect.value
	setPref('aiSource', state.aiSource)
})
elements.shellSelect.addEventListener('change', () => {
	state.shell = elements.shellSelect.value
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
		elements.shellModeControl.classList.add('hidden')
		suppressComposerInput = true
		richInput.value = ''
		void execShellMode(value.replace(/^[!！]/, ''))
	}
	else void sendMessage(value)
})
elements.folderGoButton.addEventListener('click', () => {
	openFolderEntries(elements.folderPathInput.value)
})
elements.folderSelectButton.addEventListener('click', async () => {
	const path = elements.folderPathInput.value
	if (!path) return
	const machine = browseMachineId
	const name = path.split(/[\\/]/).filter(Boolean).pop() || path
	const data = await api.addWorkspace({ name, machine, path }).catch(error => {
		showToastI18n('error', 'code.error.generic', { error: String(error.message || error) })
		return null
	})
	if (!data) return
	state.workspaces = data.list
	state.workspace = state.workspaces.find(w => w.path === path && w.machine === machine) || null
	setPref('workspace', state.workspace?.id || '')
	renderWorkspaceOptions()
	elements.folderBrowser.close()
	void applyWorkspaceChange()
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
		elements.shellModeControl.classList.remove('hidden')
		return
	}
	if (state.shellMode) {
		// 删光内容退出 shell 模式
		if (!value) {
			state.shellMode = false
			suppressComposerInput = true
			richInput.value = ''
			document.querySelector('.code-composer-shell').classList.remove('shell-mode')
			elements.shellModeControl.classList.add('hidden')
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
	if (event.key === 'Tab' && !event.shiftKey && !event.ctrlKey && !event.altKey) {
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

/**
 * 打开文件夹浏览器（当前机器）。
 * @returns {Promise<void>}
 */
async function openFolderBrowser() {
	browseMachineId = state.machine
	await openFolderEntries('')
	elements.folderBrowser.showModal()
}

/**
 * 列出目录内容。
 * @param {string} path - 目录路径。
 * @returns {Promise<void>}
 */
async function openFolderEntries(path) {
	try {
		const data = await api.browseMachine(browseMachineId, path)
		elements.folderPathInput.value = data.path
		elements.folderEntries.replaceChildren(...data.entries.map(entry => {
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

/* ---------------- 启动 ---------------- */

/**
 * 初始化。
 * @returns {Promise<void>}
 */
async function boot() {
	state.username = (await whoami()).username
	await initTranslations('code')
	// 语言切换时重渲染动态文案（geti18n 的 textContent 不随 setLanguage 自动更新）
	onLanguageChange(() => {
		renderSessions()
		renderMachineOptions()
		renderWorkspaceOptions()
		renderShellOptions()
		renderModeOptions()
		renderAiSourceOptions()
		updateCharMenu()
		updateSendButton()
	})
	const [machines, workspaces, chars] = await Promise.all([
		api.getMachines().then(r => r.machines).catch(() => [{ id: '0', description: 'localhost', isConnected: true, deviceInfo: null }]),
		api.getWorkspaces().then(r => r.list).catch(() => []),
		refreshChars(),
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
	renderMachineOptions()
	renderWorkspaceOptions()
	updateCharMenu()
	updateSendButton()
	state.shells = await api.getMachineShells(state.machine).then(r => r.shells).catch(() => [])
	renderShellOptions()
	await Promise.all([refreshProfiles(), refreshAiSources(), refreshSessions()])
	renderMessages()
	elements.composerInput.focus()
}

boot().catch(error => showToastI18n('error', 'code.error.generic', { error: String(error.message || error) }))
