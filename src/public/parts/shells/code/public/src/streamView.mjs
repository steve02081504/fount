/**
 * 流式视图：生成中的气泡、实时工具卡与增量条目的 DOM 呈现；按会话解耦，后台会话只缓存不渲染。
 * 不直接依赖 generation 模块：generation 通过运行时缓存（previewText / liveTools）驱动本模块。
 */
import { StreamRenderer } from '/parts/shells:chat/src/ui/StreamRenderer.mjs'
import { geti18n } from '/scripts/i18n/index.mjs'
import { compactToolSummary } from '/parts/shells:chat/shared/toolSummary.mjs'

import { appendEntryBubble, backToBottom, isEntryVisible, messageMarkdown, renderEntryBubble, updateBackToBottom, updateEmptyMode } from './messages.mjs'
import { updateRunCards } from './runCards.mjs'
import { elements, getActiveRuntime, store } from './store.mjs'

/** 当前活动视图：仅活动标签页的生成会话有 DOM。 @type {{session: object, bubble: HTMLElement, renderer: object, cards: Map<string, {root: HTMLElement, output: HTMLElement}>}|null} */
let view = null

/**
 * 创建实时工具卡（代码头 + 纯文本输出）。
 * @param {{lang?: string|null, code?: string, output?: string}} tool - 工具状态。
 * @returns {{root: HTMLElement, output: HTMLElement}} 卡片元素与输出节点。
 */
function createLiveToolCard(tool) {
	const root = document.createElement('details')
	root.className = 'code-tool-log code-tool-live'
	root.open = true
	const summary = document.createElement('summary')
	const chevron = document.createElement('span')
	chevron.className = 'code-tool-log-chevron'
	chevron.textContent = '▸'
	const name = document.createElement('span')
	name.className = 'code-tool-log-name'
	name.textContent = tool.lang ? geti18n('code.tool.runShell', { lang: tool.lang }) : geti18n('code.tool.userShell')
	summary.append(chevron, name)
	const operation = document.createElement('span')
	operation.className = 'code-tool-log-operation'
	operation.textContent = compactToolSummary(tool.code)
	operation.title = operation.textContent
	summary.appendChild(operation)
	const content = document.createElement('div')
	content.className = 'mt-1'
	const code = document.createElement('pre')
	code.className = 'code-shell-stream-command'
	code.textContent = tool.code || ''
	const output = document.createElement('pre')
	output.className = 'code-shell-stream-output'
	output.textContent = tool.output || ''
	content.append(code, output)
	root.append(summary, content)
	return { root, output }
}

/**
 * 创建（或从缓存重建）生成中的流式气泡。
 * 仅活动标签页的会话调用；切回标签页时由 session 依 runtime 缓存重建。
 * @param {import('./store.mjs').SessionRuntime|null} [runtime] - 目标运行时；缺省为活动运行时。
 * @returns {void}
 */
export function startGeneratingBubble(runtime = getActiveRuntime()) {
	const session = runtime?.session ?? store.session
	if (!session) return
	if (view?.session === session) return
	endGeneratingBubble()
	const bubble = document.createElement('div')
	bubble.className = 'code-message role-char generating'
	bubble.setAttribute('user-content', '')
	const name = document.createElement('div')
	name.className = 'code-message-name'
	name.textContent = session.charname || ''
	const body = document.createElement('div')
	body.className = 'code-message-body markdown-body'
	bubble.append(name, body)
	elementsInsert(bubble)
	view = {
		session,
		bubble,
		renderer: new StreamRenderer(body, {
			allowDangerousHtml: true,
			/**
			 * 流式展示文本渲染前的变换（token 重写 + 孤立围栏修复）。
			 * @param {string} text - 当前展示文本。
			 * @returns {string} 供 Markdown 渲染的文本。
			 */
			transform: text => messageMarkdown(text, 'char'),
		}),
		cards: new Map(),
	}
	// 切回标签页：用运行时缓存的实时工具卡与预览重建 DOM
	for (const [callId, tool] of runtime?.liveTools || []) {
		const card = createLiveToolCard(tool)
		view.cards.set(callId, card)
		bubble.appendChild(card.root)
	}
	if (runtime?.previewText) view.renderer.setTarget(runtime.previewText)
	updateEmptyMode()
}

/**
 * 将气泡插入消息流末端（回到浮标之前）。
 * @param {HTMLElement} bubble - 气泡。
 * @returns {void}
 */
function elementsInsert(bubble) {
	elements.messages?.insertBefore(bubble, backToBottom)
}

/** 移除生成中的气泡（不清除运行时缓存，供切回重建）。 */
export function endGeneratingBubble() {
	view?.bubble.remove()
	view = null
}

/**
 * 取某会话的生成中气泡元素（用于增量条目插在其前）。
 * @param {object} session - 会话。
 * @returns {HTMLElement|null} 气泡元素；非当前视图会话时为 null。
 */
export function generatingBubbleFor(session) {
	return view?.session === session ? view.bubble : null
}

/**
 * 应用服务端预览帧：写入运行时缓存，活动视图会话时更新渲染。
 * @param {import('./store.mjs').SessionRuntime} runtime - 目标运行时。
 * @param {string} content - 预览文本。
 * @returns {void}
 */
export function handlePreview(runtime, content) {
	if (!runtime) return
	runtime.previewText = content
	if (view?.session === runtime.session) view.renderer.setTarget(content)
}

/**
 * 处理实时工具输出帧：更新缓存与活动视图中的工具卡。
 * @param {import('./store.mjs').SessionRuntime} runtime - 目标运行时。
 * @param {{callId: string, phase: 'start'|'chunk'|'end', name?: string, lang?: string, code?: string, data?: string}} msg - 帧。
 * @returns {void}
 */
export function handleToolOutput(runtime, msg) {
	if (!runtime) return
	runtime.liveTools ??= new Map()
	const active = view?.session === runtime.session ? view : null
	if (msg.phase === 'start') {
		const tool = { name: msg.name || '', lang: msg.lang || null, code: msg.code || '', output: '' }
		runtime.liveTools.set(msg.callId, tool)
		if (active) {
			const card = createLiveToolCard(tool)
			active.cards.set(msg.callId, card)
			active.bubble.appendChild(card.root)
		}
		return
	}
	const tool = runtime.liveTools.get(msg.callId)
	if (!tool) return
	if (msg.phase === 'chunk' && msg.data) {
		tool.output += msg.data
		const card = active?.cards.get(msg.callId)
		if (card) card.output.textContent = tool.output
		return
	}
	if (msg.phase === 'end') {
		runtime.liveTools.delete(msg.callId)
		active?.cards.get(msg.callId)?.root.remove()
		active?.cards.delete(msg.callId)
	}
}

/**
 * 插入生成中的已完成增量条目：追加到会话并按 id 去重，活动视图会话时插在流式气泡之前。
 * @param {import('./store.mjs').SessionRuntime} runtime - 目标运行时。
 * @param {object[]} entries - 服务端增量条目。
 * @returns {void}
 */
export function insertIncrementalEntries(runtime, entries) {
	const session = runtime?.session
	if (!session || !entries?.length) return
	const knownIds = new Set(session.entries.map(entry => String(entry.id)))
	const fresh = entries.filter(entry => !knownIds.has(String(entry.id)))
	if (!fresh.length) return
	session.entries.push(...fresh)
	if (view?.session !== session) return
	const anchor = view.bubble || backToBottom
	for (const entry of fresh) {
		if (!isEntryVisible(entry)) continue
		const bubble = renderEntryBubble(entry, { isLast: false })
		elements.messages?.insertBefore(bubble, anchor)
	}
	updateEmptyMode()
	updateBackToBottom()
	updateRunCards()
}

/**
 * 清空运行时的流式缓存（运行收尾时调用）。
 * @param {import('./store.mjs').SessionRuntime} runtime - 目标运行时。
 * @returns {void}
 */
export function clearRuntimeView(runtime) {
	if (!runtime) return
	runtime.previewText = ''
	runtime.liveTools = new Map()
}

/**
 * 追加一条可见气泡（生成模块经此解耦）。
 * @param {object} entry - 会话条目。
 * @param {HTMLElement|null} [before] - 插入锚点。
 * @returns {void}
 */
export function appendVisibleEntry(entry, before = null) {
	appendEntryBubble(entry, before ? { before } : undefined)
}

/** 刷新空态布局开关（生成模块经此解耦）。 */
export function refreshEmptyMode() {
	updateEmptyMode()
}
