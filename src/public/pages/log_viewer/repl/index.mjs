import { attachLogWire } from 'https://esm.sh/@steve02081504/virtual-console/wire/client'

import { createEvalWs } from '../endpoints.mjs'

import { editBackspace, editInsertChar, isPairInputEvent } from './pairs.mjs'

/**
 *
 */
export { mountReplPanel } from './ui.mjs'

const HISTORY_KEY = 'log_viewer.repl.history'
const MAX_HISTORY = 100
const COMPLETION_DEBOUNCE_MS = 150

/**
 * 初始化 log_viewer 浏览器 REPL。
 * @param {object} opts - 选项。
 * @param {ReturnType<import('./ui.mjs').mountReplPanel>} opts.replUi - REPL 输入 UI。
 * @param {(entry: object) => void | Promise<void>} [opts.onAppendEntry] - 向主日志区追加条目。
 * @param {(fn: ((ref: string) => Promise<unknown>) | null) => void} [opts.onEvalExpandRef] - eval 展开引用注册。
 * @returns {void}
 */
export function initRepl({ replUi, onAppendEntry, onEvalExpandRef }) {
	if (!replUi) return
	const { inputEl, completionsEl, syncInputView, setBusy } = replUi
	if (!inputEl || !completionsEl) return

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
		onEvalExpandRef?.(null)
	}

	/**
	 * 按请求 id 兑现 eval/completion 回包。
	 * @param {{ id?: string }} raw - wire 响应帧。
	 * @returns {void}
	 */
	function resolveWireReply(raw) {
		const id = String(raw?.id ?? '')
		const slot = pending.get(id)
		if (!slot) return
		pending.delete(id)
		slot.resolve(raw)
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
				eval_result: resolveWireReply,
				completion_result: resolveWireReply,
			},
			/**
			 * @returns {void}
			 */
			onClose: () => {
				rejectAllPending('eval_wire_closed')
				evalWire = null
				onEvalExpandRef?.(null)
			},
		})
		onEvalExpandRef?.(makeExpandRef())
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
	 * 标记条目来自 eval 会话（truncated 展开走 eval wire）。
	 * @param {object} entry - 日志条目。
	 * @returns {object} 带 `fromEvalSession` 的条目。
	 */
	function tagEvalEntry(entry) {
		return { ...entry, fromEvalSession: true }
	}

	/**
	 * 将求值载荷追加到主日志区。
	 * @param {object} payload - eval_result 载荷。
	 * @returns {Promise<void>}
	 */
	async function appendEvalPayload(payload) {
		if (Array.isArray(payload.outputEntries)) 
			for (const entry of payload.outputEntries)
				await onAppendEntry?.(tagEvalEntry(entry))
		
		if (payload.error !== undefined)
			await onAppendEntry?.(tagEvalEntry({
				method: 'error',
				level: 'error',
				segments: [{ kind: 'value', snapshot: payload.error }],
				plainText: '',
			}))
		else if ('result' in payload)
			await onAppendEntry?.(tagEvalEntry({
				method: 'result',
				level: 'log',
				segments: [{ kind: 'value', snapshot: payload.result }],
				plainText: '',
			}))
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
			btn.className = `block w-full text-left px-2 py-0.5 rounded${i === completionIndex ? ' bg-primary text-primary-content' : ''}`
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
		syncInputView()
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
		setBusy(true)
		try {
			const echoText = `❯ ${code}`
			await onAppendEntry?.({
				method: 'repl',
				level: 'log',
				segments: [{ kind: 'text', text: echoText }],
				plainText: echoText,
			})
			const payload = await sendWireRequest({ type: 'eval_request', code })
			await appendEvalPayload(payload)
		} catch (err) {
			const msg = String(err?.message ?? err)
			await onAppendEntry?.({
				method: 'error',
				level: 'error',
				segments: [{ kind: 'text', text: msg }],
				plainText: msg,
			})
		} finally {
			evalInFlight = false
			setBusy(false)
			inputEl.value = ''
			syncInputView()
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

	inputEl.addEventListener('input', (e) => {
		syncInputView()
		if (inputEl.value) ensureEvalWire()
		historyIndex = -1
		// 合成中（IME 未上屏）不请求补全，避免对半成品文本误补全。
		if (e.isComposing) return
		scheduleCompletionRefresh()
	})

	// 失焦时清理补全候选，避免下拉残留在面板上。
	// 点击候选项靠 mousedown.preventDefault 保住焦点，不会误触此处。
	inputEl.addEventListener('blur', () => {
		cancelCompletionRefresh()
		hideCompletions()
	})

	inputEl.addEventListener('keydown', (e) => {
		// 输入法合成期间（如中文选词）的 Enter/方向键应交还给 IME，
		// 否则按 Enter 选词会被当成提交/拦截，导致「Enter 无法发送」。
		if (e.isComposing || e.keyCode === 229) return
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
			// 多行编辑：光标不在首行时交还文本框上移，仅首行才回溯历史。
			if (inputEl.value.slice(0, inputEl.selectionStart ?? 0).includes('\n')) return
			if (!history.length) return
			e.preventDefault()
			if (historyIndex === -1) historyDraft = inputEl.value
			historyIndex = historyIndex === -1 ? history.length - 1 : Math.max(0, historyIndex - 1)
			inputEl.value = history[historyIndex]
			syncInputView()
			scheduleCompletionRefresh()
			return
		}
		if (e.key === 'ArrowDown' && !completionItems.length) {
			// 多行编辑：光标不在末行时交还文本框下移。
			if (inputEl.value.slice(inputEl.selectionEnd ?? inputEl.value.length).includes('\n')) return
			if (historyIndex === -1) return
			e.preventDefault()
			if (historyIndex >= history.length - 1) {
				historyIndex = -1
				inputEl.value = historyDraft
			} else {
				historyIndex++
				inputEl.value = history[historyIndex]
			}
			syncInputView()
			scheduleCompletionRefresh()
		}
	})

	window.addEventListener('beforeunload', () => tearDownEvalWire())
}
