import { attachLogWire } from 'https://esm.sh/@steve02081504/virtual-console/wire/client'

import { createEvalWs } from './endpoints.mjs'
import { renderLogItem } from './log.mjs'
import { editBackspace, editInsertChar, isPairInputEvent } from './repl_pairs.mjs'

const HISTORY_KEY = 'log_viewer.repl.history'
const MAX_HISTORY = 100
const COMPLETION_DEBOUNCE_MS = 150

/**
 * 初始化 log_viewer 浏览器 REPL。
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
	let completionSuffixes = []
	let completionIndex = 0
	let completionReplaceStart = 0
	let completionReplaceEnd = 0
	let completionRequestSeq = 0
	/** @type {ReturnType<typeof setTimeout> | null} */
	let completionRefreshTimer = null
	let completionSuppressed = false
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
		if (payload.error !== undefined)
			appendEntry({
				method: 'error',
				level: 'error',
				segments: [{ kind: 'value', snapshot: payload.error }],
				plainText: '',
			})
		else if ('result' in payload)
			appendEntry({
				method: 'result',
				level: 'log',
				segments: [{ kind: 'value', snapshot: payload.result }],
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
		completionSuffixes = []
		completionIndex = 0
		completionsEl.classList.add('hidden')
		completionsEl.replaceChildren()
	}

	/**
	 * 取消待执行的补全刷新。
	 * @returns {void}
	 */
	function cancelCompletionRefresh() {
		if (completionRefreshTimer === null) return
		clearTimeout(completionRefreshTimer)
		completionRefreshTimer = null
	}

	/**
	 * 输入变化后防抖请求补全。
	 * @returns {void}
	 */
	function scheduleCompletionRefresh() {
		completionSuppressed = false
		cancelCompletionRefresh()
		completionRefreshTimer = setTimeout(() => {
			completionRefreshTimer = null
			if (completionSuppressed) return
			if (!inputEl.value) {
				hideCompletions()
				return
			}
			requestCompletion()
		}, COMPLETION_DEBOUNCE_MS)
	}

	/**
	 * 将当前选中候选项滚到补全列表可视区域中间。
	 * @returns {void}
	 */
	function scrollCompletionSelectionIntoView() {
		const selected = completionsEl.children[completionIndex]
		if (!(selected instanceof HTMLElement)) return
		const maxScroll = completionsEl.scrollHeight - completionsEl.clientHeight
		if (maxScroll <= 0) return
		const target = selected.offsetTop - (completionsEl.clientHeight - selected.offsetHeight) / 2
		completionsEl.scrollTop = Math.max(0, Math.min(maxScroll, target))
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
			li.className = 'block w-full'
			const btn = document.createElement('button')
			btn.type = 'button'
			btn.className = `block w-full text-left px-2 py-1 rounded font-mono text-sm${i === completionIndex ? ' bg-primary text-primary-content' : ''}`
			btn.textContent = completionItems[i]
			btn.addEventListener('mousedown', (e) => {
				e.preventDefault()
				completionIndex = i
				acceptCompletion()
			})
			li.appendChild(btn)
			completionsEl.appendChild(li)
		}
		scrollCompletionSelectionIntoView()
	}

	/**
	 * 当前选中候选项是否仍有未输入的后缀。
	 * @param {number} [index] - 候选项下标。
	 * @returns {boolean} 是否仍有可接受的后缀。
	 */
	function completionPendingSuffix(index = completionIndex) {
		if (!completionItems.length) return false
		return (completionSuffixes[index] ?? '').length > 0
	}

	/**
	 * 应用当前补全项到输入框。
	 * @returns {void}
	 */
	function acceptCompletion() {
		if (!completionItems.length || !completionPendingSuffix()) {
			hideCompletions()
			return
		}
		const item = completionItems[completionIndex]
		const value = inputEl.value
		inputEl.value = value.slice(0, completionReplaceStart) + item + value.slice(completionReplaceEnd)
		const pos = completionReplaceStart + item.length
		inputEl.setSelectionRange(pos, pos)
		hideCompletions()
		scheduleCompletionRefresh()
	}

	/**
	 * 请求服务端补全。
	 * @returns {Promise<void>}
	 */
	async function requestCompletion() {
		const seq = ++completionRequestSeq
		const code = inputEl.value
		const cursor = inputEl.selectionStart ?? code.length
		try {
			const result = await sendWireRequest({ type: 'completion_request', code, cursor })
			if (seq !== completionRequestSeq) return
			if (code !== inputEl.value || cursor !== (inputEl.selectionStart ?? inputEl.value.length)) return
			completionItems = Array.isArray(result.items) ? result.items.map(String) : []
			completionSuffixes = Array.isArray(result.suffixes)
				? result.suffixes.map(String)
				: completionItems.map(() => '')
			completionReplaceStart = Number.isFinite(result.replaceStart) ? result.replaceStart : cursor
			completionReplaceEnd = Number.isFinite(result.replaceEnd) ? result.replaceEnd : cursor
			completionIndex = 0
			if (completionItems.length === 1 && !completionPendingSuffix(0))
				hideCompletions()
			else
				showCompletions()
		} catch {
			if (seq !== completionRequestSeq) return
			hideCompletions()
		}
	}

	/**
	 * 模拟水平方向键移动光标。
	 * @param {number} delta - 列偏移（-1 左，+1 右）。
	 * @returns {void}
	 */
	function moveCaretHorizontal(delta) {
		const start = inputEl.selectionStart ?? 0
		const end = inputEl.selectionEnd ?? start
		if (start !== end) {
			const pos = delta < 0 ? Math.min(start, end) : Math.max(start, end)
			inputEl.setSelectionRange(pos, pos)
			return
		}
		const pos = Math.max(0, Math.min(inputEl.value.length, start + delta))
		if (pos === start) return
		inputEl.setSelectionRange(pos, pos)
		scheduleCompletionRefresh()
	}

	/**
	 * 提交当前输入求值。
	 * @returns {Promise<void>}
	 */
	async function submitEval() {
		if (evalInFlight) return
		cancelCompletionRefresh()
		completionSuppressed = false
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

	inputEl.addEventListener('beforeinput', (e) => {
		if (!isPairInputEvent(e)) return
		const start = inputEl.selectionStart ?? 0
		const end = inputEl.selectionEnd ?? start
		if (start !== end) return
		if (e.inputType === 'insertText' && e.data?.length === 1) {
			const next = editInsertChar(inputEl.value, start, e.data)
			const plain = inputEl.value.slice(0, start) + e.data + inputEl.value.slice(start)
			if (next.value === plain && next.caret === start + e.data.length) return
			e.preventDefault()
			inputEl.value = next.value
			inputEl.setSelectionRange(next.caret, next.caret)
			inputEl.dispatchEvent(new Event('input', { bubbles: true }))
			return
		}
		if (e.inputType === 'deleteContentBackward') {
			const next = editBackspace(inputEl.value, start)
			if (!next) return
			const plain = start > 0
				? { value: inputEl.value.slice(0, start - 1) + inputEl.value.slice(start), caret: start - 1 }
				: null
			if (plain && next.value === plain.value && next.caret === plain.caret) return
			e.preventDefault()
			inputEl.value = next.value
			inputEl.setSelectionRange(next.caret, next.caret)
			inputEl.dispatchEvent(new Event('input', { bubbles: true }))
		}
	})

	inputEl.addEventListener('input', () => {
		if (inputEl.value) ensureEvalWire()
		historyIndex = -1
		scheduleCompletionRefresh()
	})

	inputEl.addEventListener('keydown', (e) => {
		if (e.key === 'Tab') {
			e.preventDefault()
			if (completionItems.length && completionPendingSuffix()) {
				acceptCompletion()
				return
			}
			if (completionItems.length) hideCompletions()
			moveCaretHorizontal(e.shiftKey ? -1 : 1)
			return
		}
		if (e.key === 'Escape') {
			if (completionItems.length || completionSuppressed) {
				completionSuppressed = true
				cancelCompletionRefresh()
				hideCompletions()
			}
			return
		}
		if (e.key === 'ArrowRight') {
			const start = inputEl.selectionStart ?? 0
			const end = inputEl.selectionEnd ?? start
			if (start === end && start >= inputEl.value.length) {
				if (completionItems.length && completionPendingSuffix()) {
					e.preventDefault()
					acceptCompletion()
				}
				return
			}
			if (completionItems.length) hideCompletions()
		}

		if (e.key === 'Enter' && !e.shiftKey) {
			e.preventDefault()
			submitEval()
			return
		}
		if (e.key === 'ArrowUp' && completionItems.length > 1) {
			e.preventDefault()
			completionIndex = (completionIndex - 1 + completionItems.length) % completionItems.length
			showCompletions()
			return
		}
		if (e.key === 'ArrowDown' && completionItems.length > 1) {
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
			scheduleCompletionRefresh()
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
			scheduleCompletionRefresh()
		}
	})

	window.addEventListener('beforeunload', () => tearDownEvalWire())
}
