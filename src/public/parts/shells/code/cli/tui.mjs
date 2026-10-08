/* eslint jsdoc/require-jsdoc: off, jsdoc/require-param: off, jsdoc/require-param-description: off, jsdoc/require-param-type: off, jsdoc/require-returns: off */
import { Buffer } from 'node:buffer'
import process from 'node:process'

import { InputDecoder } from '../../../../../scripts/terminal_ui/input.mjs'
import { TerminalScreen } from '../../../../../scripts/terminal_ui/screen.mjs'
import { cells, crop, pad, replaceCells, sliceCells, wrap } from '../../../../../scripts/terminal_ui/text.mjs'

import { CLI_COMMANDS } from './commands.mjs'
import { clean, formatUsage } from './transcript.mjs'
import { composerView, createTranscriptRenderer, scrollViewport } from './view.mjs'

const options = ['model', 'char', 'session', 'profile']
const fieldName = { model: 'model', char: 'char', session: 'sessionId', profile: 'profile' }
const listName = { model: 'models', char: 'chars', session: 'all-sessions', profile: 'profiles' }

function normalizeItems(kind, items) {
	return (items ?? []).map(item => {
		if (typeof item === 'string') return { label: item, value: item }
		const id = item.id ?? item.sessionId
		const value = kind === 'session' ? `${id}${item.workspaceId ? ` ${item.workspaceId}` : ''}` : item.name ?? item.id ?? item.value
		return { label: clean(item.label ?? item.title ?? item.name ?? item.id ?? value), value, detail: clean(item.description ?? item.workspaceId ?? '') }
	})
}

export function createTitleGesture({ invalidate, holdMs = 380, frameMs = 40 }) {
	let state = 'idle'
	let holdTimer = null
	let frameTimer = null
	let frame = 0
	const stopTimers = () => {
		if (holdTimer) clearTimeout(holdTimer)
		if (frameTimer) clearInterval(frameTimer)
		holdTimer = frameTimer = null
	}
	const animate = () => {
		if (frameTimer) return
		frameTimer = setInterval(() => { frame++; invalidate() }, frameMs)
	}
	return {
		get state() { return state },
		get frame() { return frame },
		press() {
			stopTimers()
			state = 'pressed'
			frame = 0
			invalidate()
			animate()
			holdTimer = setTimeout(() => { holdTimer = null; state = 'held'; invalidate() }, holdMs)
		},
		release(inside = true) {
			if (state === 'idle') return
			stopTimers()
			state = inside && state === 'pressed' ? 'clicked' : 'idle'
			invalidate()
			if (state === 'clicked') queueMicrotask(() => { state = 'idle'; invalidate() })
		},
		cancel() { stopTimers(); state = 'idle'; invalidate() },
		get activeTimers() { return Number(!!holdTimer) + Number(!!frameTimer) },
	}
}

export async function runTui({ client, argv = {}, stdin = process.stdin, stdout = process.stdout, signal }) {
	const mode = argv.tuiMode ?? 'fullscreen'
	const screen = new TerminalScreen({ stdin, stdout, mode })
	const decoder = new InputDecoder()
	const renderTranscript = createTranscriptRenderer()
	// TUI 自己也想在退出时停掉事件订阅与接入连接，因此叠加一个本地中断信号（不反向影响调用方）。
	const localController = new AbortController()
	const runSignal = signal ? AbortSignal.any([signal, localController.signal]) : localController.signal
	/**
	 * 读取 `code.cli.tui.*` 文案；缺失（返回键名）时回落到英文原文。
	 * @param {string} key - 文案键后缀。
	 * @param {string} fallback - 缺失时的原文。
	 * @returns {string} 展示文案。
	 */
	const translate = (key, fallback) => {
		const value = client.t(`code.cli.tui.${key}`)
		return value === `code.cli.tui.${key}` ? fallback : value
	}
	const state = {
		entries: [], localEntries: [], preview: null, draft: '', caret: 0, scroll: 0, follow: true, busy: false,
		popup: null, popupIndex: 0, popupScroll: 0, popupQuery: '', popupItems: [],
		tools: new Set(), toolOutput: '', hits: [], lastLines: [], selectStart: null, selection: null, stopping: false, operationBusy: false,
		history: [], historyIndex: -1, historyDraft: '', focused: null, maxScroll: 0, controls: [], message: '', pressed: null, quitting: false,
	}
	let dirty = false
	let escapeTimer = null
	let operationController = null
	let draftTimer = null
	let draftWrite
	let draftRevision = 0
	// 草稿始终写回进入 TUI 时的会话；切换会话时显式改指向，避免异步写入落到别处。
	const draftTarget = { sessionId: client.state.sessionId, workspaceId: client.state.workspaceId }
	let activeWorkspaceId = client.state.workspaceId
	let activeSessionId = client.state.sessionId
	let activeSession = client.state.session
	let closing
	let closeResolve
	const done = new Promise(resolve => { closeResolve = resolve })
	const invalidate = () => {
		if (dirty || state.quitting) return
		dirty = true
		queueMicrotask(() => { dirty = false; if (!state.quitting) render() })
	}
	const gesture = createTitleGesture({ invalidate })
	const saveDraft = value => {
		const target = { ...draftTarget }
		const write = (draftWrite ?? Promise.resolve()).then(() => client.saveDraft(value, target)).catch(error => {
			if (!state.quitting) { state.message = clean(error?.message ?? error); invalidate() }
		})
		draftWrite = write
		return write
	}
	const scheduleDraft = () => {
		if (draftTimer) clearTimeout(draftTimer)
		draftTimer = setTimeout(() => { draftTimer = null; void saveDraft(state.draft) }, 200)
	}
	const loadDraft = async () => {
		const saved = await client.loadDraft(draftTarget)
		state.draft = saved
		state.caret = saved.length
	}
	const reloadTarget = async () => { draftTarget.sessionId = client.state.sessionId; draftTarget.workspaceId = client.state.workspaceId; return loadDraft() }
	const flushDraft = value => {
		if (draftTimer) clearTimeout(draftTimer)
		draftTimer = null
		return saveDraft(value)
	}
	const syncState = (snapshot = client.state, force = false) => {
		const switched = snapshot.workspaceId !== activeWorkspaceId || snapshot.sessionId !== activeSessionId
		if (switched || force || snapshot.session !== activeSession) {
			state.entries = [...snapshot.session?.entries ?? []]
			activeWorkspaceId = snapshot.workspaceId
			activeSessionId = snapshot.sessionId
			activeSession = snapshot.session
			if (switched) {
				state.preview = null
				state.localEntries = []
				state.toolOutput = ''
				state.tools.clear()
				state.focused = null
				state.scroll = 0
				state.follow = true
			}
		}
		state.busy = snapshot.status === 'running' || state.operationBusy
		invalidate()
	}
	const addEntry = entry => {
		const index = state.entries.findIndex(value => value.id === entry.id)
		if (index >= 0) state.entries[index] = entry
		else state.entries.push(entry)
		invalidate()
	}
	const notifiedRuns = new Set()
	/**
	 * 接入当前会话正在进行的运行；用于 `--attach` 与服务端事件通知的后台运行。
	 * @returns {void} 无返回值。
	 */
	const attachCurrent = () => {
		state.busy = true
		void client.attach({ signal: runSignal, onEvent }).catch(error => onEvent({ type: 'error', error }))
	}
	const onEvent = event => {
		if (event.type === 'state') syncState(event.state)
		else if (event.type === 'entry') {
			addEntry(event.entry)
			if (!state.busy && event.entry.extension?.usage) void client.refreshSession().catch(() => { })
		}
		else if (event.type === 'preview') state.preview = event.entry
		else if (event.type === 'tool-output') state.toolOutput = event.phase === 'end' ? '' : clean(event.text ?? event.chunk ?? event.output ?? state.toolOutput)
		else if (event.type === 'run-started') {
			if (!state.busy) { attachCurrent(); state.message = 'attached to a run started elsewhere' }
		}
		else if (event.type === 'settled') {
			if (event.runId && !notifiedRuns.has(event.runId)) {
				notifiedRuns.add(event.runId)
				stdout.write('\x07')
			}
			state.stopping = false
			if (!state.busy) {
				state.message = `run finished (${event.status ?? 'unknown'})`
				void client.refreshSession().catch(() => { })
			}
		}
		else if (event.type === 'done') {
			for (const entry of event.entries ?? []) addEntry(entry)
			state.preview = null
			state.toolOutput = ''
			state.busy = state.operationBusy
			state.stopping = false
			state.message = event.status === 'done' ? '' : String(event.status ?? '')
		}
		else if (event.type === 'error') state.message = clean(event.error?.message ?? event.error)
		else if (event.type === 'notice') state.message = clean(event.text)
		invalidate()
	}
	const close = code => { if (state.quitting) return; state.quitting = true; closing = code; closeResolve() }
	const showCommandResult = (input, content) => {
		state.localEntries.push({ afterId: state.entries.at(-1)?.id, id: `local-${state.localEntries.length}`, role: 'system', name: input, content: clean(content) })
	}
	const execute = async input => {
		if (state.operationBusy) return
		if (state.busy && (!input.startsWith('/') || input.startsWith('/send'))) {
			state.message = translate('busy', 'A run is already active')
			invalidate()
			return
		}
		state.follow = true
		state.focused = null
		state.history.push(input)
		state.historyIndex = -1
		state.draft = ''
		state.caret = 0
		draftRevision++
		state.message = ''
		state.operationBusy = true
		state.busy = true
		operationController = new AbortController()
		const commandSignal = AbortSignal.any([runSignal, operationController.signal])
		const sessionId = client.state.sessionId
		const revision = draftRevision
		invalidate()
		try {
			await flushDraft('')
			const result = await client.command(input, {
				signal: commandSignal,
				onEvent: event => { if (client.state.sessionId === sessionId) onEvent(event) },
			})
			if (result?.copy != null) {
				stdout.write(`\x1b]52;c;${Buffer.from(String(result.copy)).toString('base64')}\x07`)
				state.message = translate('copied', 'Selection copied')
			}
			else if (result?.text) showCommandResult(input, result.text)
			if (result?.exit) close(0)
			if (result?.items) showCommandResult(input, result.items.map(item => clean(item.label ?? item.name ?? item.id ?? item)).join('\n'))
			if (result?.status && result.status !== 'done' && draftRevision === revision) {
				state.draft = input
				state.caret = input.length
				draftRevision++
				scheduleDraft()
			}
			if (client.state.sessionId !== sessionId && draftRevision === revision) await reloadTarget()
		} catch (error) {
			if (!state.quitting) state.message = clean(error?.message ?? error)
			if (draftRevision === revision) { state.draft = input; state.caret = input.length; draftRevision++; scheduleDraft() }
		}
		finally {
			operationController = null
			state.operationBusy = false
			state.stopping = false
			syncState(client.state, true)
		}
	}
	const openPopup = async kind => {
		state.popup = kind
		state.popupQuery = kind === 'command' ? state.draft : ''
		state.popupIndex = 0
		state.popupScroll = 0
		state.popupItems = []
		invalidate()
		try {
			const items = kind === 'command' ? CLI_COMMANDS : await client.list(listName[kind], { query: '' })
			if (state.popup === kind) state.popupItems = normalizeItems(kind, items)
		}
		catch (error) { state.message = clean(error?.message ?? error) }
		invalidate()
	}
	const filtered = () => state.popupItems.filter(item => `${item.label} ${item.detail}`.toLowerCase().includes(state.popupQuery.toLowerCase()))
	const choose = async item => {
		const kind = state.popup
		state.popup = null
		if (!item) return invalidate()
		if (kind === 'command') { state.draft = item.value + ' '; state.caret = state.draft.length; draftRevision++; scheduleDraft(); invalidate(); return }
		try {
			const revision = draftRevision
			if (kind === 'session') await flushDraft(state.draft)
			await client.command(`/${kind} ${item.value}`, { onEvent, signal: runSignal })
			if (kind === 'session' && draftRevision === revision) await reloadTarget()
			syncState(client.state, true)
		}
		catch (error) { state.message = clean(error?.message ?? error) }
		invalidate()
	}
	function render() {
		const status = client.state
		const width = Math.max(12, stdout.columns || 80)
		const height = Math.max(8, stdout.rows || 24)
		const lines = Array(height).fill('')
		const styles = Array(height).fill('')
		styles[0] = '1;36'
		styles[1] = '2'
		state.hits = []
		const hit = (x, y, w, action, data) => state.hits.push({ x, y, w, action, data })
		const title = gesture.state === 'idle' ? '✦ fount code' : gesture.state === 'held' ? ['✧ FOUNT CODE ✧', '✦ FOUNT CODE ✦'][gesture.frame % 2] : ['✦ fount code', '✧ fount code'][gesture.frame % 2]
		lines[0] = crop(`${title}  ${clean(status.workspaceId || '')}  ${state.busy ? translate('busy', '● running') : translate('idle', '○ ready')}${status.session?.usage ? `  ${formatUsage(status.session.usage, client.t)}` : ''}`, width)
		hit(0, 0, Math.min(width, cells(title)), 'title')
		let x = 0
		for (const kind of options) {
			const label = `[${translate(kind, kind)}: ${clean(status[fieldName[kind]] || '—')}] `
			lines[1] += crop(label, Math.max(0, width - x))
			hit(x, 1, cells(label), 'picker', kind)
			x += cells(label)
		}
		const inputHeight = Math.max(2, Math.min(height - 5, 6, wrap(state.draft, Math.max(1, width - 3)).length + 1))
		const bodyEnd = height - inputHeight - 2
		state.bodyEnd = bodyEnd
		const orderedEntries = [...state.entries]
		const locals = new Set(state.localEntries)
		for (const entry of state.localEntries) {
			const anchor = orderedEntries.findIndex(value => value.id === entry.afterId)
			let position = anchor < 0 ? 0 : anchor + 1
			// 同一锚点的多条命令输出保持先后顺序。
			while (locals.has(orderedEntries[position])) position++
			orderedEntries.splice(position, 0, entry)
		}
		const { lines: content, controls, styles: contentStyles } = renderTranscript(
			[...orderedEntries, ...state.preview ? [{ ...state.preview, id: 'live-preview', role: 'char', name: status.char }] : []],
			{ width, expanded: state.tools, focused: state.focused, reasoning: translate('reasoning', 'Thinking'), user: translate('you', 'You'), translateUsage: client.t },
		)
		state.controls = controls
		if (state.focused && !controls.some(control => control.key === state.focused)) state.focused = null
		if (state.toolOutput) content.push(...wrap(`  ${state.toolOutput}`, width - 2))
		const visible = Math.max(0, bodyEnd - 3)
		state.visible = visible
		state.maxScroll = Math.max(0, content.length - visible)
		if (state.follow) state.scroll = state.maxScroll
		Object.assign(state, scrollViewport(state.scroll, state.maxScroll))
		for (let row = 0; row < visible; row++) {
			lines[row + 2] = crop(content[state.scroll + row] ?? '', width)
			styles[row + 2] = contentStyles[state.scroll + row] || ''
		}
		if (!content.length && visible > 1) {
			lines[3] = crop(`  ${translate('welcome', 'Start a conversation with your coding agent')}`, width)
			if (visible > 3) lines[5] = crop(`  ${translate('emptyHint', 'Type a message below · Tab choose model · /help commands')}`, width)
		}
		for (const item of controls) {
			const y = item.line - state.scroll + 2
			if (y >= 2 && y < bodyEnd - 1) hit(0, y, width, 'disclosure', item.key)
		}
		if (!state.follow && bodyEnd > 2) {
			lines[bodyEnd - 1] = crop(`${translate('backToBottom', '↓ Back to bottom')} · ${state.maxScroll - state.scroll}`, width)
			hit(0, bodyEnd - 1, width, 'bottom')
		}
		lines[bodyEnd] = crop(state.message || translate('inputHint', 'Enter send · Shift+Enter newline · Shift+Tab fold · /help · Ctrl+C stop/clear/exit'), width)
		styles[bodyEnd] = state.message ? '33' : '2'
		styles[bodyEnd + 1] = '36'
		lines[bodyEnd + 1] = '─'.repeat(width)
		const composer = composerView(state.draft, state.caret, Math.max(1, width - 3), inputHeight - 1)
		for (let row = 0; row < inputHeight - 1; row++) lines[bodyEnd + 2 + row] = crop(`${row ? '  ' : '❯ '}${composer.rows[row] ?? ''}`, width)
		let cursor = { x: Math.min(width - 1, 2 + cells(composer.column)), y: Math.min(height - 1, bodyEnd + 2 + composer.row) }
		if (state.popup) {
			const popupWidth = Math.min(width - 2, 68)
			const left = Math.max(0, Math.floor((width - popupWidth) / 2))
			const top = Math.max(2, Math.floor((height - 12) / 2))
			const items = filtered()
			const shown = Math.min(8, height - top - 3)
			state.popupIndex = Math.max(0, Math.min(state.popupIndex, items.length - 1))
			state.popupScroll = Math.max(0, Math.min(state.popupScroll, Math.max(0, items.length - shown)))
			if (state.popupIndex < state.popupScroll) state.popupScroll = state.popupIndex
			if (state.popupIndex >= state.popupScroll + shown) state.popupScroll = state.popupIndex - shown + 1
			const overlay = (y, text) => { styles[y] = '36'; lines[y] = replaceCells(lines[y], left, popupWidth, text, width) }
			overlay(top, `╭${'─'.repeat(popupWidth - 2)}╮`)
			overlay(top + 1, `│${pad(`${translate(state.popup, state.popup)}  /  ${state.popupQuery}`, popupWidth - 2)}│`)
			for (let row = 0; row < shown; row++) {
				const item = items[state.popupScroll + row]
				const label = item ? `${state.popupIndex === state.popupScroll + row ? '›' : ' '} ${item.label} ${item.detail}` : row === 0 ? translate('pickerEmpty', 'No matches') : ''
				overlay(top + 2 + row, `│${pad(label, popupWidth - 2)}│`)
				if (item) hit(left, top + 2 + row, popupWidth, 'pick', item)
			}
			overlay(top + 2 + shown, `╰${'─'.repeat(popupWidth - 2)}╯`)
			state.hits = state.hits.filter(value => value.action === 'pick')
			cursor = { x: Math.min(width - 1, left + 2 + cells(state.popupQuery)), y: top + 1 }
		}
		state.lastLines = lines
		screen.paint(lines, state.focused && !state.popup ? null : cursor, styles)
	}
	const insert = text => { state.historyIndex = -1; state.draft = state.draft.slice(0, state.caret) + text + state.draft.slice(state.caret); state.caret += text.length; draftRevision++; scheduleDraft(); invalidate() }
	const toggleDisclosure = id => {
		// Keep the title under the pointer when a long block grows below it.
		state.follow = false
		if (state.tools.has(id)) state.tools.delete(id); else state.tools.add(id)
		invalidate()
	}
	const key = event => {
		if (event.type === 'text' || event.type === 'paste') state.focused = null
		if (event.key === 'ctrl-c') { ctrlC(); invalidate(); return }
		if (state.popup) {
			if (event.type === 'text') state.popupQuery += event.text
			else if (event.key === 'backspace') state.popupQuery = state.popupQuery.slice(0, -1)
			else if (event.key === 'escape') state.popup = null
			else if (event.key === 'up') state.popupIndex = Math.max(0, state.popupIndex - 1)
			else if (event.key === 'down') state.popupIndex = Math.min(filtered().length - 1, state.popupIndex + 1)
			else if (event.key === 'enter') { void choose(filtered()[state.popupIndex]); return }
			invalidate(); return
		}
		if (event.type === 'paste') insert(event.text)
		else if (event.type === 'text') insert(event.text)
		else if (event.key === 'newline') insert('\n')
		else if (event.key === 'enter' && state.focused) { toggleDisclosure(state.focused); return }
		else if (event.key === 'enter') { if (state.draft.trim()) void execute(state.draft); return }
		else if (event.key === 'backspace' && state.caret) { const prior = Array.from(state.draft.slice(0, state.caret)).at(-1); state.draft = state.draft.slice(0, state.caret - prior.length) + state.draft.slice(state.caret); state.caret -= prior.length; draftRevision++; scheduleDraft() }
		else if (event.key === 'delete') { state.draft = state.draft.slice(0, state.caret) + state.draft.slice(state.caret + (Array.from(state.draft.slice(state.caret))[0]?.length ?? 0)); draftRevision++; scheduleDraft() }
		else if (event.key === 'left') state.caret -= Array.from(state.draft.slice(0, state.caret)).at(-1)?.length ?? 0
		else if (event.key === 'right') state.caret += Array.from(state.draft.slice(state.caret))[0]?.length ?? 0
		else if (event.key === 'home') state.caret = state.draft.lastIndexOf('\n', state.caret - 1) + 1
		else if (event.key === 'end') { const end = state.draft.indexOf('\n', state.caret); state.caret = end < 0 ? state.draft.length : end }
		else if ((event.key === 'up' || event.key === 'down') && state.focused) {
			const index = state.controls.findIndex(control => control.key === state.focused)
			const target = state.controls[Math.max(0, Math.min(state.controls.length - 1, index + (event.key === 'down' ? 1 : -1)))]
			if (target) { state.focused = target.key; Object.assign(state, scrollViewport(target.line - Math.floor(state.visible / 2), state.maxScroll)) }
		}
		else if (event.key === 'up' && state.history.length && !state.draft.includes('\n')) {
			if (state.historyIndex < 0) state.historyDraft = state.draft
			state.historyIndex = Math.min(state.history.length - 1, state.historyIndex + 1)
			state.draft = state.history.at(-1 - state.historyIndex); state.caret = state.draft.length; draftRevision++; scheduleDraft()
		}
		else if (event.key === 'down' && state.historyIndex >= 0) {
			state.historyIndex--; state.draft = state.historyIndex < 0 ? state.historyDraft : state.history.at(-1 - state.historyIndex)
			state.caret = state.draft.length; draftRevision++; scheduleDraft()
		}
		else if (event.key === 'up' || event.key === 'down') {
			const start = state.draft.lastIndexOf('\n', state.caret - 1) + 1
			const column = state.caret - start
			const end = state.draft.indexOf('\n', state.caret)
			if (event.key === 'up' && start > 0) { const prior = state.draft.lastIndexOf('\n', start - 2) + 1; state.caret = Math.min(start - 1, prior + column) }
			else if (event.key === 'down' && end >= 0) { const next = state.draft.indexOf('\n', end + 1); state.caret = Math.min(next < 0 ? state.draft.length : next, end + 1 + column) }
		}
		else if (event.key === 'page-up') Object.assign(state, scrollViewport(state.scroll, state.maxScroll, -Math.max(1, state.visible - 1)))
		else if (event.key === 'page-down') Object.assign(state, scrollViewport(state.scroll, state.maxScroll, Math.max(1, state.visible - 1)))
		else if (event.key === 'ctrl-end') { state.follow = true; state.focused = null }
		else if (event.key === 'ctrl-home') Object.assign(state, scrollViewport(0, state.maxScroll))
		else if (event.key === 'escape') state.focused = null
		else if (event.key === 'shift-tab' && state.controls.length) {
			const current = state.controls.findIndex(control => control.key === state.focused)
			const target = state.controls[(current + 1) % state.controls.length]
			state.focused = target.key
			Object.assign(state, scrollViewport(target.line - Math.floor(state.visible / 2), state.maxScroll))
		}
		else if (event.key === 'ctrl-d' && !state.draft) close(0)
		else if (event.key === 'tab') void openPopup(state.draft.startsWith('/') && !state.draft.includes(' ') ? 'command' : 'model')
		invalidate()
	}
	/** 第一次 Ctrl+C 停止当前运行，空闲时清空输入，空输入时退出。 */
	function ctrlC() {
		if (state.stopping) { close(130); return }
		if (state.busy) {
			state.stopping = true
			operationController?.abort()
			void client.abort()
			state.message = translate('stopping', 'Stopping…')
		}
		else if (state.draft) { state.draft = ''; state.caret = 0; draftRevision++; scheduleDraft() }
		else close(0)
	}
	const mouse = event => {
		if (event.action === 'wheel-up' || event.action === 'wheel-down') {
			if (state.popup) state.popupIndex = Math.max(0, Math.min(filtered().length - 1, state.popupIndex + (event.action === 'wheel-down' ? 1 : -1)))
			else if (event.y >= 2 && event.y < state.bodyEnd) Object.assign(state, scrollViewport(state.scroll, state.maxScroll, event.action === 'wheel-down' ? 3 : -3))
			invalidate(); return
		}
		const target = [...state.hits].reverse().find(item => item.y === event.y && event.x >= item.x && event.x < item.x + item.w)
		if (event.action === 'press') {
			if (event.y >= state.bodyEnd) { state.focused = null; invalidate() }
			state.pressed = target
			if (target?.action === 'title') gesture.press()
			else if (!state.popup && event.y >= 2 && event.y < state.bodyEnd) state.selectStart = { x: event.x, y: event.y }
		} else if (event.action === 'move') {
			if (state.pressed?.action === 'title' && target?.action !== 'title') gesture.cancel()
			if (state.selectStart) { state.selection = { start: state.selectStart, end: { x: event.x, y: event.y } }; invalidate() }
		} else if (event.action === 'release') {
			if (state.pressed?.action === 'title') gesture.release(target?.action === 'title')
			else if (state.selection) {
				const rows = state.selection
				const top = Math.min(rows.start.y, rows.end.y)
				const bottom = Math.max(rows.start.y, rows.end.y)
				const forward = rows.start.y < rows.end.y || rows.start.y === rows.end.y && rows.start.x <= rows.end.x
				const first = forward ? rows.start : rows.end
				const last = forward ? rows.end : rows.start
				const text = state.lastLines.slice(top, bottom + 1).map((line, index) =>
					sliceCells(clean(line), index === 0 ? first.x : 0, index === bottom - top ? last.x + 1 : Infinity).trimEnd()).join('\n')
				if (text) stdout.write(`\x1b]52;c;${Buffer.from(text).toString('base64')}\x07`)
				state.selection = null
				state.message = translate('copied', 'Selection copied')
			} else if (target && target.action === state.pressed?.action && target.data === state.pressed?.data)
				if (target.action === 'picker') void openPopup(target.data)
				else if (target.action === 'pick') void choose(target.data)
				else if (target.action === 'disclosure') { state.focused = target.data; toggleDisclosure(target.data) }
				else if (target.action === 'bottom') { state.follow = true; invalidate() }

			state.pressed = null
			state.selectStart = null
		}
	}
	const dispatchInput = event => {
		if (event.type === 'mouse') mouse(event)
		else if (event.type === 'focus') { if (!event.focused) gesture.cancel() }
		else key(event)
	}
	const onData = bytes => {
		if (escapeTimer) clearTimeout(escapeTimer)
		for (const event of decoder.push(bytes)) dispatchInput(event)
		if (decoder.needsEscapeTimeout) escapeTimer = setTimeout(() => {
			escapeTimer = null
			for (const event of decoder.flushEscape()) dispatchInput(event)
		}, 35)
	}
	const onResize = () => { gesture.cancel(); invalidate() }
	const onAbort = () => close(130)
	/**
	 * 订阅服务端事件：接入后台运行、合并追加条目并提示完成。
	 * @returns {Promise<void>} 订阅结束。
	 */
	const subscribeEvents = async () => {
		try { await client.subscribeServerEvents({ signal: runSignal, onEvent }) }
		catch (error) { if (!state.quitting) onEvent({ type: 'error', error }) }
	}
	try {
		screen.enter()
		stdin.on('data', onData)
		stdout.on?.('resize', onResize)
		runSignal.addEventListener('abort', onAbort, { once: true })
		for (const entry of client.state.session?.entries ?? []) addEntry(entry)
		render()
		if (!argv.prompt) {
			const revision = draftRevision
			await loadDraft()
			if (draftRevision !== revision) { state.draft = ''; state.caret = 0 }
			invalidate()
		}
		void subscribeEvents()
		if (argv.prompt) void execute(argv.prompt)
		else if (argv.attach || client.state.status === 'running') attachCurrent()
		await done
		return closing
	} finally {
		if (escapeTimer) clearTimeout(escapeTimer)
		await flushDraft(state.draft)
		gesture.cancel()
		localController.abort()
		stdin.off('data', onData)
		stdout.off?.('resize', onResize)
		runSignal.removeEventListener('abort', onAbort)
		screen.leave()
	}
}
