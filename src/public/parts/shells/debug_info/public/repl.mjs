import { attachLogWire } from 'https://esm.sh/@steve02081504/virtual-console/wire/client'

import { renderLogItem } from './log.mjs'
import { createEvalWs } from './src/endpoints.mjs'

const HISTORY_KEY = 'debug_info.repl.history'
const MAX_HISTORY = 100

/**
 * 初始化 debug_info 浏览器 REPL。
 * @param {object} opts - 选项。
 * @param {boolean} [opts.canOpenEditor=false] - 是否允许源码跳转。
 * @param {(callsite: object) => void | Promise<void>} [opts.onOpenSource] - 打开源码回调。
 * @returns {void}
 */
export function initRepl({ canOpenEditor = false, onOpenSource } = {}) {
	const outputEl = document.getElementById('repl-output')
	const inputEl = /** @type {HTMLTextAreaElement | null} */ document.getElementById('repl-input')
	const completionsEl = document.getElementById('repl-completions')
	if (!outputEl || !inputEl || !completionsEl) return

	/** @type {ReturnType<typeof attachLogWire> | null} */
	let evalWire = null
	/** @type {Map<string, { resolve: (v: object) => void, reject: (e: Error) => void }>} */
	const pending = new Map()
	let nextId = 1
	let historyIndex = -1
	let historyDraft = ''
	/** @type {string[]} */
	let history = []
	/** @type {string[]} */
	let completionItems = []
	let completionIndex = 0
	let completionReplaceStart = 0
	let completionReplaceEnd = 0
	let evalInFlight = false

	try {
		const raw = localStorage.getItem(HISTORY_KEY)
		const parsed = JSON.parse(raw ?? '[]')
		if (Array.isArray(parsed)) history = parsed.filter(e => typeof e === 'string').slice(-MAX_HISTORY)
	} catch { /* ignore */ }

	/**
	 * 持久化历史。
	 * @returns {void}
	 */
	function saveHistory() {
		try { localStorage.setItem(HISTORY_KEY, JSON.stringify(history)) } catch { /* ignore */ }
	}

	/**
	 * 拒绝挂起请求。
	 * @param {string} message - 错误消息。
	 * @returns {void}
	 */
	function rejectAllPending(message) {
		for (const { reject } of pending.values())
			reject(new Error(message))
		pending.clear()
	}

	/**
	 * 关闭 eval 连接。
	 * @returns {void}
	 */
	function tearDownEvalWire() {
		rejectAllPending('eval_wire_closed')
		evalWire?.detach()
		evalWire = null
	}

	/**
	 * 首次输入时懒建 eval WebSocket。
	 * @returns {ReturnType<typeof attachLogWire>} eval wire 句柄。
	 */
	function ensureEvalWire() {
		if (evalWire?.ws?.readyState === WebSocket.OPEN) return evalWire
		if (evalWire?.ws?.readyState === WebSocket.CONNECTING) return evalWire
		evalWire?.detach()
		const ws = createEvalWs()
		evalWire = attachLogWire(ws, {
			extensionHandlers: {
				/**
				 * @param {{ id?: string }} raw - eval 结果。
				 * @returns {void}
				 */
				eval_result: (raw) => {
					const id = String(raw?.id ?? '')
					const slot = pending.get(id)
					if (!slot) return
					pending.delete(id)
					slot.resolve(raw)
				},
				/**
				 * @param {{ id?: string }} raw - 补全结果。
				 * @returns {void}
				 */
				completion_result: (raw) => {
					const id = String(raw?.id ?? '')
					const slot = pending.get(id)
					if (!slot) return
					pending.delete(id)
					slot.resolve(raw)
				},
			},
			/**
			 * @returns {void}
			 */
			onClose: () => {
				rejectAllPending('eval_wire_closed')
				evalWire = null
			},
		})
		return evalWire
	}

	/**
	 * 发送 eval wire 请求。
	 * @param {object} payload - 请求体（不含 id）。
	 * @returns {Promise<object>} 响应。
	 */
	function sendWireRequest(payload) {
		const wire = ensureEvalWire()
		const id = String(nextId++)
		return new Promise((resolve, reject) => {
			pending.set(id, { resolve, reject })
			/**
			 *
			 */
			const send = () => {
				if (!wire.sendJson({ ...payload, id }))
					reject(new Error('eval_wire_send_failed'))
			}
			if (wire.ws.readyState === WebSocket.OPEN) send()
			else wire.ws.addEventListener('open', send, { once: true })
		})
	}

	/**
	 * @returns {(ref: string) => Promise<unknown>} 展开 truncated 引用。
	 */
	function makeExpandRef() {
		return (ref) => {
			if (!evalWire) return Promise.reject(new Error('eval WebSocket not ready'))
			return evalWire.requestExpand(ref)
		}
	}

	/**
	 * 将求值载荷渲染到输出区。
	 * @param {object} payload - eval_result 载荷。
	 * @returns {void}
	 */
	function appendEvalPayload(payload) {
		const renderOpts = {
			canOpenEditor,
			onOpenSource,
			requestExpandRef: makeExpandRef(),
		}
		/**
		 * @param {object} entry - 日志形条目。
		 * @returns {void}
		 */
		const appendEntry = (entry) => {
			const row = renderLogItem(entry, renderOpts)
			outputEl.appendChild(row)
		}
		for (const entry of payload.outputEntries ?? [])
			appendEntry(entry)
		if (payload.result !== undefined)
			appendEntry({
				method: 'result',
				level: 'log',
				segments: [{ kind: 'value', snapshot: payload.result }],
				plainText: '',
			})
		if (payload.error !== undefined)
			appendEntry({
				method: 'error',
				level: 'error',
				segments: [{ kind: 'value', snapshot: payload.error }],
				plainText: '',
			})
		outputEl.scrollTop = outputEl.scrollHeight
	}

	/**
	 * 隐藏补全下拉。
	 * @returns {void}
	 */
	function hideCompletions() {
		completionItems = []
		completionIndex = 0
		completionsEl.classList.add('hidden')
		completionsEl.replaceChildren()
	}

	/**
	 * 显示补全候选。
	 * @returns {void}
	 */
	function showCompletions() {
		completionsEl.replaceChildren()
		if (!completionItems.length) {
			hideCompletions()
			return
		}
		completionsEl.classList.remove('hidden')
		for (let i = 0; i < completionItems.length; i++) {
			const li = document.createElement('li')
			const btn = document.createElement('button')
			btn.type = 'button'
			btn.className = `w-full text-left px-2 py-1 rounded font-mono text-sm${i === completionIndex ? ' bg-primary text-primary-content' : ''}`
			btn.textContent = completionItems[i]
			btn.addEventListener('mousedown', (e) => {
				e.preventDefault()
				completionIndex = i
				acceptCompletion()
			})
			li.appendChild(btn)
			completionsEl.appendChild(li)
		}
	}

	/**
	 * 应用当前补全项到输入框。
	 * @returns {void}
	 */
	function acceptCompletion() {
		if (!completionItems.length) return
		const item = completionItems[completionIndex]
		const value = inputEl.value
		inputEl.value = value.slice(0, completionReplaceStart) + item + value.slice(completionReplaceEnd)
		const pos = completionReplaceStart + item.length
		inputEl.setSelectionRange(pos, pos)
		hideCompletions()
	}

	/**
	 * 请求服务端补全。
	 * @returns {Promise<void>}
	 */
	async function requestCompletion() {
		const code = inputEl.value
		const cursor = inputEl.selectionStart ?? code.length
		try {
			const result = await sendWireRequest({ type: 'completion_request', code, cursor })
			completionItems = Array.isArray(result.items) ? result.items.map(String) : []
			completionReplaceStart = Number.isFinite(result.replaceStart) ? result.replaceStart : cursor
			completionReplaceEnd = Number.isFinite(result.replaceEnd) ? result.replaceEnd : cursor
			completionIndex = 0
			showCompletions()
		} catch {
			hideCompletions()
		}
	}

	/**
	 * 提交当前输入求值。
	 * @returns {Promise<void>}
	 */
	async function submitEval() {
		if (evalInFlight) return
		hideCompletions()
		const code = inputEl.value.trimEnd()
		if (!code.trim()) return
		if (history[history.length - 1] !== code.trim()) {
			history.push(code.trim())
			if (history.length > MAX_HISTORY) history = history.slice(-MAX_HISTORY)
			saveHistory()
		}
		historyIndex = -1
		historyDraft = ''
		evalInFlight = true
		const echo = document.createElement('div')
		echo.className = 'opacity-70 font-mono text-xs mb-1 whitespace-pre-wrap'
		echo.textContent = `❯ ${code}`
		outputEl.appendChild(echo)
		try {
			const payload = await sendWireRequest({ type: 'eval_request', code })
			appendEvalPayload(payload)
		} catch (err) {
			const errRow = document.createElement('div')
			errRow.className = 'text-error font-mono text-sm'
			errRow.textContent = String(err?.message ?? err)
			outputEl.appendChild(errRow)
		} finally {
			evalInFlight = false
			inputEl.value = ''
		}
	}

	inputEl.addEventListener('input', () => {
		if (inputEl.value) ensureEvalWire()
		hideCompletions()
		historyIndex = -1
	})

	inputEl.addEventListener('keydown', (e) => {
		if (e.key === 'Tab') {
			e.preventDefault()
			if (completionItems.length) {
				if (e.shiftKey)
					completionIndex = (completionIndex - 1 + completionItems.length) % completionItems.length
				else
					completionIndex = (completionIndex + 1) % completionItems.length
				showCompletions()
				return
			}
			requestCompletion()
			return
		}
		if (e.key === 'Escape') {
			hideCompletions()
			return
		}
		if (completionItems.length && (e.key === 'Enter' || e.key === 'ArrowRight')) 
			if (e.key === 'ArrowRight' || !e.shiftKey) {
				e.preventDefault()
				acceptCompletion()
				return
			}
		
		if (e.key === 'Enter' && !e.shiftKey) {
			e.preventDefault()
			submitEval()
			return
		}
		if (e.key === 'ArrowUp' && completionItems.length) {
			e.preventDefault()
			completionIndex = (completionIndex - 1 + completionItems.length) % completionItems.length
			showCompletions()
			return
		}
		if (e.key === 'ArrowDown' && completionItems.length) {
			e.preventDefault()
			completionIndex = (completionIndex + 1) % completionItems.length
			showCompletions()
			return
		}
		if (e.key === 'ArrowUp' && !completionItems.length) {
			if (!history.length) return
			e.preventDefault()
			if (historyIndex === -1) historyDraft = inputEl.value
			historyIndex = historyIndex === -1 ? history.length - 1 : Math.max(0, historyIndex - 1)
			inputEl.value = history[historyIndex]
			return
		}
		if (e.key === 'ArrowDown' && !completionItems.length) {
			if (historyIndex === -1) return
			e.preventDefault()
			if (historyIndex >= history.length - 1) {
				historyIndex = -1
				inputEl.value = historyDraft
			} else {
				historyIndex++
				inputEl.value = history[historyIndex]
			}
		}
	})

	window.addEventListener('beforeunload', () => tearDownEvalWire())
}
