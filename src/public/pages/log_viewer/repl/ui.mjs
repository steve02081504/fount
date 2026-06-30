import { createHighlighter } from 'https://esm.sh/shiki'
import { escapeHtml } from '/scripts/lib/escapeHtml.mjs'

/** 与 {@link module:markdownConvertor} 同源主题。 */
const SHIKI_THEMES = { light: 'github-light', dark: 'github-dark-dimmed' }

/** @type {import('https://esm.sh/shiki').Highlighter | null} */
let highlighter = null
/** @type {(() => void) | null} */
let resyncHighlight = null

createHighlighter({
	themes: Object.values(SHIKI_THEMES),
	langs: ['javascript'],
}).then(h => {
	highlighter = h
	resyncHighlight?.()
}).catch(() => { /* 降级为 escapeHtml */ })

/**
 * 单行 JavaScript 高亮（Shiki `structure: 'inline'`，适配 textarea 叠层）。
 * @param {string} line - 单行源码。
 * @returns {string} HTML 片段。
 */
function highlightLine(line) {
	if (!highlighter) return escapeHtml(line)
	try {
		return highlighter.codeToHtml(line || ' ', {
			lang: 'javascript',
			themes: SHIKI_THEMES,
			defaultColor: false,
			structure: 'inline',
		})
	} catch {
		return escapeHtml(line)
	}
}

/**
 * 在日志面板底部挂载 REPL 输入 UI（圆角框 + 提示符 + 高亮叠层）。
 * @param {HTMLElement} container - `#repl-panel` 容器。
 * @param {object} [opts] - 选项。
 * @param {string} [opts.placeholder] - 输入占位符。
 * @param {string} [opts.hint] - 底部按键提示。
 * @returns {{ inputEl: HTMLTextAreaElement, completionsEl: HTMLElement, syncInputView: () => void, setBusy: (busy: boolean) => void, focus: () => void }} REPL UI 句柄。
 */
export function mountReplPanel(container, { placeholder = '', hint = '' } = {}) {
	const frameTop = document.createElement('div')
	frameTop.className = 'repl-frame-top'
	frameTop.innerHTML = '<span class="repl-frame-corner">╭─</span>'
	const label = document.createElement('span')
	label.className = 'repl-frame-label'
	label.textContent = 'js'
	frameTop.appendChild(label)
	const frameLine = document.createElement('span')
	frameLine.className = 'repl-frame-line'
	frameTop.appendChild(frameLine)
	const busyEl = document.createElement('span')
	busyEl.className = 'repl-frame-busy'
	busyEl.textContent = '⋯'
	frameTop.appendChild(busyEl)
	const cornerEnd = document.createElement('span')
	cornerEnd.className = 'repl-frame-corner-end'
	cornerEnd.textContent = '╮'
	frameTop.appendChild(cornerEnd)

	const inputArea = document.createElement('div')
	inputArea.className = 'repl-input-area'

	const editorWrap = document.createElement('div')
	editorWrap.className = 'repl-editor-wrap'

	const editor = document.createElement('div')
	editor.className = 'repl-editor'

	const gutterEl = document.createElement('div')
	gutterEl.className = 'repl-gutter'

	const stackEl = document.createElement('div')
	stackEl.className = 'repl-stack'

	const highlightEl = document.createElement('pre')
	highlightEl.className = 'repl-highlight'
	highlightEl.setAttribute('aria-hidden', 'true')

	const inputEl = document.createElement('textarea')
	inputEl.id = 'repl-input'
	inputEl.className = 'repl-input-edit'
	inputEl.rows = 1
	inputEl.spellcheck = false
	inputEl.autocomplete = 'off'
	inputEl.autocapitalize = 'off'
	if (placeholder) inputEl.placeholder = placeholder

	stackEl.append(highlightEl, inputEl)
	editor.append(gutterEl, stackEl)
	editorWrap.appendChild(editor)
	inputArea.appendChild(editorWrap)

	const completionsEl = document.createElement('ul')
	completionsEl.id = 'repl-completions'
	completionsEl.className = 'repl-completions hidden'
	inputArea.appendChild(completionsEl)

	const frameBottom = document.createElement('div')
	frameBottom.className = 'repl-frame-bottom'
	frameBottom.innerHTML = '<span class="repl-frame-corner">╰</span>'
	const bottomLine = document.createElement('span')
	bottomLine.className = 'repl-frame-line'
	frameBottom.appendChild(bottomLine)
	const hintEl = document.createElement('span')
	hintEl.className = 'repl-frame-hint'
	hintEl.textContent = hint
	frameBottom.appendChild(hintEl)
	const bottomLine2 = document.createElement('span')
	bottomLine2.className = 'repl-frame-line'
	frameBottom.appendChild(bottomLine2)
	const cornerEndBottom = document.createElement('span')
	cornerEndBottom.className = 'repl-frame-corner-end'
	cornerEndBottom.textContent = '╯'
	frameBottom.appendChild(cornerEndBottom)

	container.replaceChildren(frameTop, inputArea, frameBottom)

	/**
	 * 更新左侧提示符列。
	 * @param {number} lineCount - 逻辑行数。
	 * @returns {void}
	 */
	function updateGutter(lineCount) {
		gutterEl.replaceChildren()
		const count = Math.max(1, lineCount)
		for (let i = 0; i < count; i++) {
			const line = document.createElement('div')
			line.className = `repl-gutter-line${i === 0 ? ' repl-gutter-prompt' : ' repl-gutter-cont'}`
			line.textContent = i === 0 ? '❯' : '…'
			gutterEl.appendChild(line)
		}
	}

	/**
	 * 同步高亮层、提示符与输入框高度。
	 * @returns {void}
	 */
	function syncInputView() {
		const text = inputEl.value
		const lines = text.split('\n')
		const lineCount = Math.max(1, lines.length)
		updateGutter(lineCount)
		highlightEl.innerHTML = lines.map(highlightLine).join('\n') || '&nbsp;'
		inputEl.style.height = '0'
		inputEl.style.height = `${Math.max(inputEl.scrollHeight, stackEl.offsetHeight)}px`
	}

	resyncHighlight = syncInputView
	syncInputView()

	/**
	 * 求值进行中指示。
	 * @param {boolean} busy - 是否忙碌。
	 * @returns {void}
	 */
	function setBusy(busy) {
		busyEl.classList.toggle('active', busy)
	}

	return {
		inputEl,
		completionsEl,
		syncInputView,
		setBusy,
		/**
		 * @returns {void}
		 */
		focus: () => inputEl.focus(),
	}
}
