/**
 * 生成运行时：共享 WebSocket、按会话路由的运行状态、attach/recover、终态合并与完成分发。
 * 通过运行时缓存（previewText / liveTools）驱动 streamView；不直接 import messages 或 completion。
 */
import { showToastI18n } from '/scripts/features/toast.mjs'
import { geti18n } from '/scripts/i18n/index.mjs'

import * as api from './endpoints.mjs'
import { refreshSessionUsage, renderMessages } from './messages.mjs'
import { flushSession, markSessionDirty } from './sessionPersistence.mjs'
import { getActiveRuntime, getRuntime, isGenerating, store, tabKeyOf } from './store.mjs'
import { appendVisibleEntry, clearRuntimeView, endGeneratingBubble, generatingBubbleFor, handlePreview, handleToolOutput, insertIncrementalEntries, refreshEmptyMode, startGeneratingBubble } from './streamView.mjs'

/** 运行状态变更监听（submission 借此刷新发送/停止按钮，避免反向依赖）。 @type {Set<(runtime: object|null) => void>} */
const statusListeners = new Set()

/**
 * 注册运行状态变更监听。
 * @param {(runtime: object|null) => void} listener - 回调。
 * @returns {void}
 */
export function onRuntimeStatusChange(listener) {
	statusListeners.add(listener)
}

/**
 * 通知运行状态变更。
 * @param {object|null} runtime - 变更的运行时。
 * @returns {void}
 */
function notifyStatus(runtime) {
	for (const listener of statusListeners) listener(runtime)
}

/** 运行终态处理器（boot 注入 completion.handleRunSettled）。 @type {((payload: object) => void)|null} */
let runSettledHandler = null

/**
 * 注入运行终态处理器。
 * @param {(payload: object) => void} handler - 处理器。
 * @returns {void}
 */
export function setRunSettledHandler(handler) {
	runSettledHandler = handler
}

/* ---------------- 共享 WebSocket ---------------- */

let socket = null
/** 连接建立中的共享等待 Promise（并发调用者复用）。 */
let socketOpening = null

/**
 * 获取（懒建立）会话 WebSocket。
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
			socket = null
			socketOpening = null
			if (opened) handleSocketClose()
			else reject(new Error('websocket failed'))
		})
		ws.addEventListener('message', onSocketMessage)
	})
	return socketOpening
}

/**
 * 按会话 id 找运行时（跨标签页，不限于活动标签）。
 * @param {string} sessionId - 会话 id。
 * @returns {object|null} 运行时。
 */
function runtimeForSessionId(sessionId) {
	if (!sessionId) return null
	// 同一会话可能因标签改绑工作区短暂出现在多个键下：优先命中运行中的运行时
	let fallback = null
	for (const runtime of store.runtimes.values()) {
		if (runtime.session?.id !== sessionId) continue
		if (runtime.status !== 'idle') return runtime
		fallback ||= runtime
	}
	if (fallback) return fallback
	if (store.session?.id === sessionId) return getActiveRuntime()
	return null
}

/**
 * 一帧是否属于该运行时的当前运行。
 * @param {object} runtime - 运行时。
 * @param {object} msg - 服务端帧。
 * @returns {boolean} 是否接纳。
 */
function isCurrentRunFrame(runtime, msg) {
	if (msg.runId && runtime.runId && msg.runId !== runtime.runId) return false
	if (msg.sessionId && runtime.session && msg.sessionId !== runtime.session.id) return false
	return true
}

/**
 * 进入生成态：登记运行 id、重建流式气泡并标记运行时。
 * @param {object} runtime - 运行时。
 * @param {string} [runId] - 运行 id（缺省新生成）。
 * @returns {string} 本轮运行 id。
 */
export function beginGeneration(runtime, runId = crypto.randomUUID()) {
	runtime.status = 'generating'
	runtime.runId = runId
	runtime.previewText = ''
	runtime.liveTools = new Map()
	if (runtime === getActiveRuntime()) startGeneratingBubble(runtime)
	if (runtime.session) markSessionDirty(runtime.session)
	notifyStatus(runtime)
	return runId
}

/**
 * 发送一帧运行请求（自动补全 session 与共享连接）。
 * @param {object} runtime - 运行时。
 * @param {object} frame - 请求帧（需含 type 与 runId）。
 * @returns {Promise<void>} 发送完成。
 */
export async function sendRunRequest(runtime, frame) {
	const ws = await getSocket()
	ws.send(JSON.stringify({ ...frame, session: runtime.session }))
}

/* ---------------- attach / recover ---------------- */

/** 接入等待超时（ms）：超时视为无活跃运行，回退磁盘恢复。 */
const ATTACH_TIMEOUT_MS = 3000
/** 恢复轮询间隔（ms）。 */
const RECOVER_POLL_MS = 1500
/** 磁盘恢复轮询上限（ms）：超时后保持 recovering 并提供手动重连。 */
const RECOVER_TIMEOUT_MS = 2 * 60 * 1000

/**
 * 结束待决的接入等待。
 * @param {object} runtime - 运行时。
 * @param {boolean} ok - 是否接入成功。
 * @returns {void}
 */
function settleAttach(runtime, ok) {
	const waiter = runtime.attach
	if (!waiter) return
	runtime.attach = null
	clearTimeout(waiter.timer)
	waiter.resolve(ok)
}

/**
 * 向后端发送接入帧：接管一个后端正在进行的运行。
 * @param {object} runtime - 运行时。
 * @returns {Promise<boolean>} 是否成功接入。
 */
function attachToRun(runtime) {
	if (!runtime.session?.id) return Promise.resolve(false)
	return new Promise(resolve => {
		const waiter = { resolve, timer: 0 }
		waiter.timer = setTimeout(() => settleAttach(runtime, false), ATTACH_TIMEOUT_MS)
		runtime.attach = waiter
		getSocket()
			.then(ws => ws.send(JSON.stringify({ type: 'attach', sessionId: runtime.session.id })))
			.catch(() => settleAttach(runtime, false))
	})
}

/**
 * 断线 / 刷新后恢复被中断的运行：先尝试接入后端活跃运行，否则轮询磁盘。
 * 恢复只锁本标签页；超时保持 recovering 并可手动重连，绝不伪装成空闲可发送。
 * @param {object} runtime - 运行时。
 * @returns {Promise<void>} 完成。
 */
export async function recoverGeneration(runtime) {
	if (!runtime?.session) return
	if (runtime.status === 'recovering') return
	runtime.status = 'recovering'
	notifyStatus(runtime)
	try {
		if (await attachToRun(runtime)) {
			// 后端仍在跑：run-start 已回填 runId，回到生成态继续接收流
			runtime.status = 'generating'
			if (runtime === getActiveRuntime()) startGeneratingBubble(runtime)
			notifyStatus(runtime)
			return
		}
	} catch { /* 接入失败：回退磁盘轮询 */ }
	const workspace = store.workspaces.find(w => w.id === runtime.session.workspaceId)
	const loadTarget = {
		machine: String(workspace?.machine ?? store.machine),
		workdir: workspace?.path || '',
	}
	if (!loadTarget.workdir) {
		runtime.status = 'recovering'
		notifyStatus(runtime)
		return
	}
	const deadline = Date.now() + RECOVER_TIMEOUT_MS
	while (Date.now() < deadline) {
		if (runtime.status === 'generating') return
		await new Promise(resolve => setTimeout(resolve, RECOVER_POLL_MS))
		let disk = null
		try { disk = await api.loadSession(loadTarget, runtime.session.id) }
		catch { continue }
		if (!disk || disk.entries?.some(entry => entry.is_generating)) continue
		applyRecoveredSession(runtime, disk)
		return
	}
	// 超时：保持 recovering（忙碌、不可发送），提供手动重连
	notifyStatus(runtime)
}

/**
 * 用磁盘上的权威会话替换运行时会话并渲染。
 * @param {object} runtime - 运行时。
 * @param {object} disk - 磁盘会话。
 * @returns {void}
 */
function applyRecoveredSession(runtime, disk) {
	const session = runtime.session
	session.entries = disk.entries || []
	if (disk.memory) session.memory = disk.memory
	session.updated = disk.updated || session.updated
	session.title = disk.title || session.title
	runtime.status = 'idle'
	runtime.runId = null
	clearRuntimeView(runtime)
	notifyStatus(runtime)
	if (runtime === getActiveRuntime()) {
		endGeneratingBubble()
		renderMessages()
		refreshEmptyMode()
	}
	void flushSession(runtime.tabKey)
}

/**
 * 设置运行时状态并通知监听（供其他模块在非生成流程中标记忙碌/空闲）。
 * @param {object} runtime - 运行时。
 * @param {'idle'|'submitting'|'generating'|'recovering'|'stopping'} status - 状态。
 * @returns {void}
 */
export function setRuntimeStatus(runtime, status) {
	if (!runtime) return
	runtime.status = status
	notifyStatus(runtime)
}

/**
 * 手动重连某标签页的恢复流程（超时后由发送/重连按钮触发）。
 * @param {string} [tabKey] - 标签键；缺省为活动标签页。
 * @returns {void}
 */
export function retryRecovery(tabKey = store.activeTabKey) {
	const runtime = getRuntime(tabKey)
	if (!runtime || runtime.status !== 'recovering') return
	runtime.status = 'idle'
	void recoverGeneration(runtime)
}

/* ---------------- socket 收帧 ---------------- */

/**
 * socket 断开：对生成中的运行转入磁盘恢复（各自独立）。
 * @returns {void}
 */
function handleSocketClose() {
	for (const runtime of store.runtimes.values())
		if (runtime.status === 'generating' || runtime.status === 'stopping') void recoverGeneration(runtime)
}

/**
 * 处理服务端 `code-session-entry` 事件（无运行时的追加，仅展示层）。
 * @param {object} payload - 事件负载（`{ chatName, entry }`）。
 * @returns {void}
 */
export function handleSessionEntryEvent(payload) {
	const { chatName, entry } = payload || {}
	const sessionId = typeof chatName === 'string' && chatName.startsWith('code-') ? chatName.slice('code-'.length) : ''
	const runtime = runtimeForSessionId(sessionId)
	const session = runtime?.session || (store.session?.id === sessionId ? store.session : null)
	if (!session || !entry) return
	if (session.entries.some(item => String(item.id) === String(entry.id))) return
	session.entries.push(entry)
	if (runtime === getActiveRuntime() || store.session === session) {
		const anchor = generatingBubbleFor(session)
		if (anchor || session === store.session) appendVisibleEntry(entry, anchor)
	}
	// 生成外的异步条目（任务通告、压缩摘要）带着自己的调用明细，累计值需要重新按盘上会话取
	if (entry.extension?.usage) void refreshSessionUsageFromDisk(runtime, session).then(changed => { if (changed) repaintSessionUsage(runtime, session) })
	refreshEmptyMode()
}

/**
 * 处理服务端 `code-run-started` 事件（后端在无页面连接时启动的运行）。
 * @param {object} payload - 事件负载（`{ chatName, runId }`）。
 * @returns {Promise<void>} 完成。
 */
export async function handleRunStartedEvent(payload) {
	const { chatName, runId } = payload || {}
	const sessionId = typeof chatName === 'string' && chatName.startsWith('code-') ? chatName.slice('code-'.length) : ''
	const tab = store.tabs.find(item => item.type === 'session' && item.id === sessionId)
	const runtime = tab ? getRuntime(tabKeyOf(tab), { create: true }) : runtimeForSessionId(sessionId)
	if (!runtime?.session) return
	if (isGenerating(runtime.tabKey)) return
	beginGeneration(runtime, runId)
	if (!await attachToRun(runtime)) {
		runtime.status = 'idle'
		runtime.runId = null
		notifyStatus(runtime)
		void recoverGeneration(runtime)
	}
}

/**
 * socket 消息处理：按 `sessionId` 路由到运行时并做运行身份校验。
 * @param {MessageEvent} event - 消息事件。
 * @returns {void}
 */
function onSocketMessage(event) {
	const msg = JSON.parse(String(event.data))
	if (msg.type === 'run-start') {
		const runtime = runtimeForSessionId(msg.sessionId)
		if (runtime && msg.runId) runtime.runId = msg.runId
		if (runtime) settleAttach(runtime, true)
		return
	}
	const runtime = runtimeForSessionId(msg.sessionId)
	if (!runtime || !isCurrentRunFrame(runtime, msg)) return
	if (msg.type === 'preview') { handlePreview(runtime, msg.content); return }
	if (msg.type === 'tool-output') { handleToolOutput(runtime, msg); return }
	if (msg.type === 'entries-append') { insertIncrementalEntries(runtime, msg.entries || []); return }
	if (msg.type === 'done') { void settleRun(runtime, { entries: msg.entries, memory: msg.memory, status: 'done' }); return }
	if (msg.type === 'aborted') { void settleRun(runtime, { entries: msg.entries, memory: null, status: 'aborted' }); return }
	if (msg.type === 'error') {
		// attach 失败（后端已无该运行）：交由恢复流程回退磁盘轮询
		if (runtime.attach && msg.error === 'no active run') { settleAttach(runtime, false); return }
		void settleRun(runtime, { entries: msg.entries, status: 'error', error: msg.error })
	}
}

/**
 * 运行终态：合并服务端条目、复位状态、刷新视图并分发完成事件。
 * @param {object} runtime - 运行时。
 * @param {{entries?: object[], memory?: object|null, status: 'done'|'aborted'|'error', error?: string}} result - 终态。
 * @returns {Promise<void>} 完成。
 */
async function settleRun(runtime, { entries, memory = null, status, error = '' }) {
	const session = runtime.session
	if (!session) { resetRuntime(runtime); return }
	const wasActive = runtime === getActiveRuntime()
	const knownIds = new Set(session.entries.map(entry => String(entry.id)))
	const fresh = (entries || []).filter(entry => !knownIds.has(String(entry.id)))
	session.entries = session.entries.filter(entry => !entry.is_generating)
	session.entries.push(...fresh)
	if (memory) session.memory = memory
	session.updated = new Date().toISOString()
	if (!session.title && session.entries.length)
		session.title = (session.entries.find(entry => entry.role === 'user')?.content || '').slice(0, 40) || session.title
	if (status === 'error') {
		const hasErrorEntry = fresh.some(entry => entry.name === 'error' && entry.role === 'system')
		if (!hasErrorEntry) session.entries.push(buildErrorEntry(error))
	}
	const runId = runtime.runId
	resetRuntime(runtime)
	if (wasActive) {
		endGeneratingBubble()
		const visibleFresh = status === 'error' && !fresh.some(entry => entry.name === 'error')
			? [session.entries.at(-1)]
			: fresh
		for (const entry of visibleFresh) if (entry) appendVisibleEntry(entry)
		if (status === 'aborted') showToastI18n('info', 'code.error.aborted')
		refreshEmptyMode()
	}
	await flushSession(runtime.tabKey)
	await refreshSessionUsageFromDisk(runtime, session).then(changed => { if (changed) repaintSessionUsage(runtime, session) })
	runSettledHandler?.({
		chatName: `code-${session.id}`,
		sessionId: session.id,
		workspaceId: session.workspaceId,
		runId,
		status,
	})
}

/**
 * 只在会话已被绘制时重绘画面上的累计用量标签。
 * @param {object} runtime - 对应会话的运行时。
 * @param {object} session - 该运行时的会话对象。
 * @returns {void}
 */
function repaintSessionUsage(runtime, session) {
	if (runtime === getActiveRuntime() && store.session === session) refreshSessionUsage()
}

/**
 * 终态后只从持久化会话刷新用量，避免把压缩条目与回复累计重复相加；生成中或无运行时时不改动。
 * @param {object} runtime 对应会话的运行时。
 * @param {object} session 当前会话对象。
 * @returns {Promise<boolean>} 成功刷新时返回 true。
 */
async function refreshSessionUsageFromDisk(runtime, session) {
	if (runtime?.session !== session || runtime.status !== 'idle') return false
	const workspace = store.workspaces.find(item => item.id === session.workspaceId)
	if (!workspace?.path) return false
	try {
		const stored = await api.loadSession({ machine: String(workspace.machine ?? store.machine), workdir: workspace.path }, session.id)
		if (runtime.session !== session || runtime.status !== 'idle' || !stored) return false
		if (stored.usage) session.usage = stored.usage
		else delete session.usage
		return true
	}
	catch { return false }
}

/**
 * 构造前端兜底错误条目（后端未持久化时使用）。
 * @param {string} error - 错误文本。
 * @returns {object} 错误条目。
 */
function buildErrorEntry(error) {
	const fallback = geti18n('code.error.generate')
	const text = error ? `${fallback}\n\`\`\`\n${error}\n\`\`\`` : fallback
	return { id: crypto.randomUUID().slice(0, 8), uid: 'system', role: 'system', name: 'error', content: text, time: new Date().toISOString() }
}

/**
 * 复位运行时到空闲态。
 * @param {object} runtime - 运行时。
 * @returns {void}
 */
function resetRuntime(runtime) {
	runtime.status = 'idle'
	runtime.runId = null
	clearRuntimeView(runtime)
	notifyStatus(runtime)
}

/* ---------------- 输入通知 / 中止 ---------------- */

/** 输入通知节流间隔（ms）：后端据此重置延迟收尾计时。 */
const TYPING_NOTIFY_INTERVAL_MS = 1000
/** 上次发送输入通知的时间。 */
let lastTypingNotify = 0

/**
 * 告知后端用户正在输入（节流；有活动会话且其未生成时）。
 * @returns {void}
 */
export function notifyTyping() {
	const session = store.session
	if (!session?.id || isGenerating(store.activeTabKey)) return
	const now = Date.now()
	if (now - lastTypingNotify < TYPING_NOTIFY_INTERVAL_MS) return
	lastTypingNotify = now
	void getSocket().then(ws => ws.send(JSON.stringify({ type: 'typing', sessionId: session.id }))).catch(() => { })
}

/**
 * 中止活动标签页的运行（只发送该会话的 sessionId / runId）。
 * @param {string} [tabKey] - 标签键；缺省为活动标签页。
 * @returns {void}
 */
export function abortGeneration(tabKey = store.activeTabKey) {
	const runtime = getRuntime(tabKey)
	if (!runtime?.session?.id) return
	if (runtime.status === 'generating') {
		runtime.status = 'stopping'
		notifyStatus(runtime)
	}
	void getSocket().then(ws => ws.send(JSON.stringify({ type: 'abort', sessionId: runtime.session.id, runId: runtime.runId }))).catch(() => { })
}
