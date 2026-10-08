import { randomUUID } from 'node:crypto'

import { executeCommand } from './commands.mjs'

/** code shell 的 HTTP / WS 前缀。 */
export const API_PREFIX = '/api/parts/shells:code'
/** WS 终态帧；收到任一即结束本次流。 */
export const TERMINAL_FRAMES = ['done', 'aborted', 'error']

/**
 * 创建 CLI 会话客户端：持有状态、解析执行目标，并暴露运行 / 观察 / 列举入口。
 * @param {object} root0 - 依赖与初始选择。
 * @param {object} root0.transport - HTTP / WS 传输层。
 * @param {string} [root0.workspaceId] - 初始工作区 ID。
 * @param {string} [root0.sessionId] - 初始会话 ID。
 * @param {string} [root0.char] - 初始角色名。
 * @param {string} [root0.model] - 初始 AI source（`char` 表示跟随角色）。
 * @param {string} [root0.profile] - 初始 profile 名。
 * @param {string} [root0.username] - 执行用户名。
 * @param {string} [root0.locale] - 当前界面语言（export 等本地渲染用）。
 * @param {(key: string) => string} [root0.t] - 文案翻译函数。
 * @returns {object} 客户端句柄，含 `state`、`command` 与各业务方法。
 */
export function createCodeClient({ transport, workspaceId, sessionId, char, model, profile, username, locale = '', t = key => key }) {
	const state = { workspaceId, sessionId, char, model, profile, username, status: 'idle', runId: null, session: null, workspace: null, attachments: [] }
	const initial = { char, model, profile }
	let firstOpen = true
	const listeners = new Set()
	/**
	 * 通知订阅者当前状态快照。
	 * @returns {void} 无返回值。
	 */
	const notify = () => { for (const listener of listeners) listener({ ...state }) }
	/**
	 * 当前工作区的执行目标。
	 * @returns {{machine: string, workdir: string}} 目标机器与工作区路径。
	 */
	const target = () => ({ machine: state.workspace.machine, workdir: state.workspace.path })
	/**
	 * 把执行目标拼成查询串。
	 * @returns {string} URL 查询串。
	 */
	const query = () => new URLSearchParams(target()).toString()
	/**
	 * 载入并切换工作区，同时清空当前会话。
	 * @param {string} id - 已保存工作区 ID。
	 * @returns {Promise<object>} 工作区记录。
	 */
	async function selectWorkspace(id) {
		const workspace = (await transport.get(`${API_PREFIX}/workspaces`)).list.find(item => item.id === id)
		if (!workspace) throw new Error(`workspace not found: ${id}`)
		state.workspace = workspace
		state.workspaceId = id
		await transport.put(`${API_PREFIX}/workspaces/${encodeURIComponent(id)}/use`, {})
		state.session = null
		state.sessionId = null
		notify()
		return workspace
	}
	/**
	 * 打开已存在会话，或在所选工作区新建会话。
	 * @param {string} [id] - 会话 ID；省略时随机新建。
	 * @returns {Promise<object>} 会话对象。
	 */
	async function openSession(id = randomUUID().slice(0, 8)) {
		if (!/^[\w-]{1,64}$/.test(id)) throw new Error('invalid session ID')
		let session
		try { session = await transport.get(`${API_PREFIX}/sessions/${encodeURIComponent(id)}?${query()}`) }
		catch (error) { if (error.status !== 404) throw error }
		if (!session) {
			const now = new Date().toISOString()
			const config = await transport.get(`${API_PREFIX}/workspace-config?${query()}`)
			const chars = await transport.get('/api/getlist/chars')
			session = {
				id, title: '', charname: state.char || config.char?.partname || chars[0] || '', profile: state.profile || 'build',
				ai_source: state.model === 'char' ? '' : state.model || '',
				workspaceId: state.workspaceId, created: now, updated: now, memory: {}, entries: [],
			}
			await transport.post(`${API_PREFIX}/sessions`, { ...target(), session })
			session.version = 1
		}
		state.session = session
		state.sessionId = id
		state.char = firstOpen && initial.char || session.charname || ''
		state.model = firstOpen && initial.model != null ? initial.model : session.ai_source ?? ''
		state.profile = firstOpen && initial.profile || session.profile || 'build'
		firstOpen = false
		notify()
		return session
	}
	/**
	 * 从服务端重新载入当前会话；尚无会话时新建。
	 * 读盘期间会话 / 工作区已被切走时只交出读到的快照，不覆盖新选择。
	 * @returns {Promise<object>} 请求发出时那个会话的快照。
	 */
	async function refreshSession() {
		if (!state.sessionId) return openSession()
		const requestedSessionId = state.sessionId
		const requestedWorkspaceId = state.workspaceId
		const session = await transport.get(`${API_PREFIX}/sessions/${encodeURIComponent(requestedSessionId)}?${query()}`)
		if (requestedSessionId !== state.sessionId || requestedWorkspaceId !== state.workspaceId) return session
		state.session = session
		notify()
		return state.session
	}
	/**
	 * 保存某个会话的未发送输入；目标由调用方固定，必要时用自身状态补全。
	 * @param {string} text - 草稿文本；空字符串清除草稿。
	 * @param {{sessionId?: string, workspaceId?: string}} [draftTarget] - 目标会话身份。
	 * @returns {Promise<object>} 服务端保存结果。
	 */
	function saveDraft(text, draftTarget = {}) {
		const sessionId = draftTarget.sessionId ?? state.sessionId
		const workspaceId = draftTarget.workspaceId ?? state.workspaceId
		if (!sessionId || !workspaceId) return Promise.reject(new Error('open a session before saving a draft'))
		return transport.put(`${API_PREFIX}/cli-drafts/${encodeURIComponent(sessionId)}`, { workspaceId, draft: text })
	}
	/**
	 * 读取某个会话的未发送输入。
	 * @param {{sessionId?: string, workspaceId?: string}} [draftTarget] - 目标会话身份。
	 * @returns {Promise<string>} 草稿文本。
	 */
	async function loadDraft(draftTarget = {}) {
		const sessionId = draftTarget.sessionId ?? state.sessionId
		const workspaceId = draftTarget.workspaceId ?? state.workspaceId
		if (!sessionId || !workspaceId) return ''
		const result = await transport.get(`${API_PREFIX}/cli-drafts/${encodeURIComponent(sessionId)}?workspaceId=${encodeURIComponent(workspaceId)}`)
		return result.draft || ''
	}
	/**
	 * 合并运行期间收到的权威条目，按 ID 去重并保持到达顺序。
	 * @param {Map<unknown, object|null>} collected - 本轮新条目（值为 null 表示只记 ID 不留正文）。
	 * @param {Set<string>} baseline - 发送前的条目 ID 集合。
	 * @param {boolean} collectEntries - 是否保留条目正文。
	 * @param {(event: object) => void} onEvent - 事件回调。
	 * @returns {(entries: object[]) => void} 条目合并函数。
	 */
	const createEntryCollector = (collected, baseline, collectEntries, onEvent) => entries => {
		for (const entry of entries || []) if (!entry.is_generating && !collected.has(entry.id) && !baseline.has(String(entry.id))) {
			onEvent({ type: 'entry', entry })
			collected.set(entry.id, collectEntries ? entry : null)
		}
	}
	/**
	 * 转发帧里与展示无关的临时输出（预览 / 工具实时输出 / 错误）。
	 * @param {(event: object) => void} onEvent - 事件回调。
	 * @param {object} frame - WS 帧。
	 * @returns {void} 无返回值。
	 */
	const forwardTransientFrames = (onEvent, frame) => {
		if (frame.type === 'preview') onEvent({ type: 'preview', entry: { content: frame.content } })
		else if (frame.type === 'tool-output') onEvent(frame)
		else if (frame.type === 'error') onEvent({ type: 'error', error: frame.error, code: frame.code })
	}
	/**
	 * 发送一轮生成，按 `runId` 归并权威条目并等待终态。
	 * @param {object} [root0] - 运行选项。
	 * @param {string} [root0.input] - 用户输入文本。
	 * @param {object[]} [root0.files] - 附件列表；省略时用客户端暂存附件。
	 * @param {AbortSignal} [root0.signal] - 中断信号。
	 * @param {(event: object) => void} [root0.onEvent] - 事件回调。
	 * @param {'send'|'regen'|'trigger'} [root0.type] - 请求类型。
	 * @param {boolean} [root0.replace] - 是否显式取代进行中的运行。
	 * @param {number} [root0.truncateAt] - 先截断到该条目下标再生成。
	 * @param {boolean} [root0.collectEntries] - 是否收集条目正文。
	 * @returns {Promise<object>} 终态结果（含 status / entries / runId / error / code）。
	 */
	async function run({ input = '', files, signal, onEvent = () => { }, type = 'send', replace = false, truncateAt, collectEntries = true } = {}) {
		if (state.status !== 'idle') throw new Error('session is already running in this client')
		files ??= state.attachments
		if (type === 'send' && !input && !files.length) throw new Error('prompt or attachment is required')
		state.status = 'starting'
		notify()
		try { await refreshSession() }
		catch (error) { state.status = 'idle'; notify(); throw error }
		if (!state.char) { state.status = 'idle'; notify(); throw new Error('no character is available; choose one with --char or /char') }
		const runId = randomUUID()
		const baseline = new Set(state.session.entries.map(entry => String(entry.id)))
		const sentSessionId = state.sessionId
		const sentWorkspaceId = state.workspaceId
		const sentTarget = target()
		const session = { ...state.session, charname: state.char, profile: state.profile, ai_source: state.model === 'char' ? '' : state.model, entries: [...state.session.entries] }
		if (type === 'regen' && session.entries.at(-1)?.role === 'char') session.entries.pop()
		if (truncateAt != null) session.entries.splice(truncateAt)
		const payload = {
			type, session, ...sentTarget, ai_source: session.ai_source, profile: state.profile,
			runId, expectedVersion: state.session.version ?? 0, replace,
		}
		if (type === 'send') {
			payload.content = input
			payload.files = files
			payload.clientEntryId = randomUUID()
			session.entries.push({
				id: payload.clientEntryId, role: 'user', uid: 'user', name: state.username, content: input,
				time: new Date().toISOString(), files,
			})
		}
		// Publish the exact submitted transcript before the first streaming frame.
		state.session = session
		state.runId = runId
		state.status = 'running'
		notify()
		onEvent({ type: 'state', state: { ...state } })
		try {
			const collected = new Map()
			const collectEntriesFrame = createEntryCollector(collected, baseline, collectEntries, onEvent)
			/** @param {object} frame - 原始连接或重连 socket 的帧。 @returns {void} 无返回值。 */
			const onFrame = frame => {
				if (TERMINAL_FRAMES.includes(frame.type) || frame.type === 'entries-append') collectEntriesFrame(frame.entries)
				forwardTransientFrames(onEvent, frame)
			}
			let terminal
			try { terminal = await transport.stream('/ws/parts/shells:code/session', payload, { signal, runId, onFrame }) }
			catch (error) {
				if (signal?.aborted) throw error
				// send 可能已经到达服务端：绝不重发，只按 runId 接回观察。
				try {
					terminal = await transport.stream('/ws/parts/shells:code/session', {
						type: 'attach', sessionId: sentSessionId, runId, ...sentTarget,
					}, { signal, onFrame })
				}
				catch (attachError) {
					terminal = { type: 'error', error: `connection lost while observing run ${runId}: ${attachError.message}` }
				}
			}
			collectEntriesFrame(terminal.entries)
			if (state.sessionId === sentSessionId && state.workspaceId === sentWorkspaceId) await refreshSession()
			const result = {
				type: 'done', status: terminal.type, entries: collectEntries ? [...collected.values()] : [], runId, sessionId: sentSessionId,
				error: terminal.error, code: terminal.code,
			}
			if (type === 'send' && terminal.type === 'done') state.attachments = []
			onEvent(result)
			return result
		}
		finally {
			if (state.runId === runId) { state.status = 'idle'; state.runId = null }
			notify()
			onEvent({ type: 'state', state: { ...state } })
		}
	}
	/**
	 * 观察当前会话正在进行的运行，直到它出现终态。
	 * @param {object} [root0] - 观察选项。
	 * @param {AbortSignal} [root0.signal] - 中断信号。
	 * @param {(event: object) => void} [root0.onEvent] - 事件回调。
	 * @param {string} [root0.runId] - 只接入该运行；省略时接入当前会话的运行。
	 * @param {boolean} [root0.collectEntries] - 是否在结果中保留条目正文。
	 * @returns {Promise<object>} 终态结果。
	 */
	async function attach({ signal, onEvent = () => { }, runId = state.runId, collectEntries = true } = {}) {
		const entries = new Map()
		const collectEntriesFrame = createEntryCollector(entries, new Set(), collectEntries, onEvent)
		state.status = 'running'
		notify()
		try {
			const terminal = await transport.stream('/ws/parts/shells:code/session', { type: 'attach', sessionId: state.sessionId, ...target(), ...runId ? { runId } : {} }, {
				signal,
				/**
				 * 记录运行身份、回放权威条目并转发临时输出。
				 * @param {object} frame - WS 帧。
				 * @returns {void} 无返回值。
				 */
				onFrame: frame => {
					if (frame.type === 'run-start') state.runId = frame.runId
					if (frame.type === 'entries-append' || TERMINAL_FRAMES.includes(frame.type)) collectEntriesFrame(frame.entries)
					forwardTransientFrames(onEvent, frame)
				},
			})
			collectEntriesFrame(terminal.entries)
			await refreshSession()
			return { type: 'done', status: terminal.type, entries: collectEntries ? [...entries.values()] : [], runId: terminal.runId, error: terminal.error }
		}
		finally { state.status = 'idle'; state.runId = null; notify() }
	}
	/**
	 * 中止当前运行。
	 * @returns {Promise<boolean>} 是否发出了中止。
	 */
	async function abort() {
		if (!state.runId) return false
		await transport.stream('/ws/parts/shells:code/session', { type: 'abort', sessionId: state.sessionId, runId: state.runId, ...target() }, {
			signal: AbortSignal.timeout(1000),
		}).catch(() => { })
		return true
	}
	/**
	 * 列举可选资源并按关键字过滤。
	 * @param {string} kind - 资源类型（sessions / chars / models / profiles / commands / workspaces / machines / tasks）。
	 * @param {object} [root0] - 过滤选项。
	 * @param {string} [root0.query] - 关键字。
	 * @returns {Promise<unknown[]>} 过滤后的列表。
	 */
	async function list(kind, { query: search = '' } = {}) {
		let items
		switch (kind) {
			case 'sessions': items = (await transport.get(`${API_PREFIX}/sessions?${query()}`)).sessions; break
			case 'all-sessions': items = (await transport.get(`${API_PREFIX}/sessions/all`)).sessions; break
			case 'chars': items = await transport.get('/api/getlist/chars'); break
			case 'models': items = ['char', ...(await transport.get(`${API_PREFIX}/aisources`)).sources]; break
			case 'profiles': items = (await transport.get(`${API_PREFIX}/profiles?${query()}`)).profiles; break
			case 'commands': items = (await transport.get(`${API_PREFIX}/profiles?${query()}`)).commands; break
			case 'workspaces': items = (await transport.get(`${API_PREFIX}/workspaces`)).list; break
			case 'machines': items = (await transport.get(`${API_PREFIX}/machines`)).machines; break
			case 'tasks': items = (await transport.get(`${API_PREFIX}/async-tasks?chatId=code-${state.sessionId}`)).tasks; break
			default: throw new Error(`unknown list: ${kind}`)
		}
		return search ? items.filter(item => JSON.stringify(item).toLowerCase().includes(search.toLowerCase())) : items
	}
	/**
	 * 订阅服务端事件总线（当前会话的运行开始 / 追加条目 / 终态），用于接入非本客户端发起的运行。
	 * @param {object} [root0] - 订阅选项。
	 * @param {(event: object) => void} [root0.onEvent] - 事件回调。
	 * @param {AbortSignal} [root0.signal] - 中断信号。
	 * @returns {Promise<void>} 订阅结束。
	 */
	function subscribeServerEvents({ onEvent = () => { }, signal } = {}) {
		return transport.events({
			signal,
			/**
			 * 只转发本会话相关的事件，并映射成客户端事件。
			 * @param {string} type - 服务端事件类型。
			 * @param {object} data - 事件负载。
			 * @returns {void} 无返回值。
			 */
			onEvent: (type, data) => {
				if (data?.chatName !== `code-${state.sessionId}`) return
				if (data.workdir != null && (String(data.machine ?? '0') !== String(state.workspace?.machine ?? '0') || data.workdir !== state.workspace?.path)) return
				if (data.workspaceId != null && data.workspaceId !== state.workspaceId) return
				if (type === 'code-run-started') onEvent({ type: 'run-started', runId: data.runId })
				else if (type === 'code-run-settled') onEvent({ type: 'settled', runId: data.runId, status: data.status })
				else if (type === 'code-session-entry') onEvent({ type: 'entry', entry: data.entry })
			},
		})
	}
	/**
	 * 订阅状态变化。
	 * @param {(state: object) => void} listener - 状态监听器。
	 * @returns {() => boolean} 退订函数。
	 */
	const subscribe = listener => { listeners.add(listener); return () => listeners.delete(listener) }
	const client = {
		state, t, locale, transport, target, selectWorkspace, openSession, refreshSession, saveDraft, loadDraft, run, attach, abort, list, subscribe, subscribeServerEvents,
		dispose: transport.close,
	}
	/**
	 * 执行一条内建命令或普通输入。
	 * @param {string} line - 原始输入行。
	 * @param {object} [options] - 事件回调与中断信号。
	 * @returns {Promise<object|undefined>} 命令结果。
	 */
	client.command = async (line, options) => {
		try { return await executeCommand(line, { client, ...options }) }
		finally { notify() }
	}
	return client
}
