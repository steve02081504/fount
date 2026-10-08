/** Monaco 编辑器；每个打开的文件独占自己的模型、撤销历史与视图状态。 */
import { geti18n, offLanguageChange, onLanguageChange } from '/scripts/i18n/index.mjs'
import { loadCodeRuntime, resolveFileLanguage } from '/scripts/components/codeSyntax.mjs'
import { bindEditorLocale } from '/scripts/components/codeEditorLocale.mjs'
import { onThemeChange } from '/scripts/theme/index.mjs'

import { loadEditorExtensions } from './editorExtensions.mjs'

const LF = '\n'
const MAX_HIGHLIGHTED_CHARS = 1_000_000

/**
 * 读取文件中最先出现的换行符。
 * @param {string} text - Original file contents.
 * @returns {string} The file's first line ending.
 */
function lineEndingOf(text) { return text.match(/\r\n|\r|\n/)?.[0] || LF }

/**
 * 序列化当前 Monaco 文档。
 * @param {object} buffer - Editor buffer.
 * @returns {string} Current file contents.
 */
export function bufferContent(buffer) {
	if (!buffer.model) return buffer.content
	if (buffer.model.getAlternativeVersionId() === buffer.savedOriginalVersionId) return buffer.base
	const text = buffer.model.getValue()
	return buffer.lineEnding === LF ? text : text.replace(/\n/g, buffer.lineEnding)
}

/**
 * 比较模型版本与最近保存的检查点。
 * @param {object} buffer - Editor buffer.
 * @returns {boolean} Whether the buffer contains unsaved edits.
 */
export function bufferDirty(buffer) {
	return buffer.model
		? buffer.model.getAlternativeVersionId() !== buffer.savedAlternativeVersionId
		: buffer.content !== buffer.base
}

/**
 * 创建共享的 Monaco 编辑器实例。
 * @param {HTMLElement} host - 编辑器挂载点。
 * @param {{onChange: Function, onSave: Function, onSelection: Function}} callbacks - 壳层回调。
 * @returns {Promise<object>} 编辑器控制器。
 */
export async function createFileEditor(host, { onChange, onSave, onSelection }) {
	const monaco = await loadCodeRuntime()
	let buffer = null, revision = 0, disposed = false
	const view = monaco.editor.create(host, {
		model: null,
		detectIndentation: false,
		tabSize: 4,
		insertSpaces: false,
		automaticLayout: true,
		ariaLabel: geti18n('code.explorer.editorLabel'),
		contextmenu: true,
		fontFamily: codeFontFamily(),
		fontSize: 12,
		lineHeight: 23,
		lineNumbers: 'on',
		autoClosingBrackets: 'always',
		autoClosingQuotes: 'always',
		bracketPairColorization: { enabled: true },
		matchBrackets: 'always',
		minimap: { enabled: false },
		scrollBeyondLastLine: false,
		wordWrap: 'off',
		glyphMargin: true,
		folding: true,
		padding: { top: 8, bottom: 8 },
		renderLineHighlight: 'line',
		selectionHighlight: true,
		// TextMate supplies syntax; no semantic document-highlight provider is installed.
		occurrencesHighlight: 'off',
	})
	view.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyMod.Shift | monaco.KeyCode.US_OPEN_SQUARE_BRACKET, () => void view.getAction('editor.foldAll')?.run())
	view.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyMod.Shift | monaco.KeyCode.US_CLOSE_SQUARE_BRACKET, () => void view.getAction('editor.unfoldAll')?.run())
	view.getDomNode()?.setAttribute('user-content', '')
	// Monaco 的光标按 `cursorBlinking`（默认 500ms）用内联 `visibility` 画闪烁，与 page watch
	// `[test:flicker]` 判「显隐来回抖」的规则同量级——那是刻意的脉冲，标记整棵编辑器子树跳过。
	host.setAttribute('flicker-ignore', '')
	/**
	 * 阻止 Escape 冒泡到页面级快捷键。
	 * @param {KeyboardEvent} event - 编辑器按键事件。
	 * @returns {void}
	 */
	const stopEscape = event => {
		if (event.key === 'Escape') { event.stopPropagation(); view.focus() }
	}
	host.addEventListener('keydown', stopEscape)
	const actions = []
	/** @returns {void} 在 Monaco 原生菜单里刷新壳层专用动作。 */
	function translateActions() {
		view.updateOptions({ ariaLabel: geti18n('code.explorer.editorLabel') })
		for (const action of actions.splice(0)) action.dispose()
		// 键位由壳层的 document 级监听独占，这里只保留菜单项。
		actions.push(view.addAction({ id: 'fount.save', label: geti18n('code.explorer.save'), contextMenuGroupId: '9_fount',
			/** @returns {void} 保存当前缓冲区。 */
			run: () => void onSave() }))
	}
	onLanguageChange(translateActions)
	const unbindLocale = await bindEditorLocale(view, host)
	// 收敛上游菜单语义，同时保留原生菜单项与键盘导航。
	const menuRoots = new Set([host])
	const menuObserver = new MutationObserver(fixMenuAria)
	menuObserver.observe(host, { childList: true, subtree: true })
	fixMenuAria()
	/** @returns {void} 修复原生菜单语义，含 Monaco 的菜单 shadow root。 */
	function fixMenuAria() {
		for (const node of host.querySelectorAll('.shadow-root-host'))
			if (node.shadowRoot && !menuRoots.has(node.shadowRoot)) {
				menuRoots.add(node.shadowRoot)
				menuObserver.observe(node.shadowRoot, { childList: true, subtree: true, attributes: true, attributeFilter: ['tabindex'] })
			}

		for (const root of menuRoots) for (const menu of root.querySelectorAll('.monaco-menu')) {
			for (const item of menu.querySelectorAll('li.action-item')) {
				const separator = item.querySelector('.separator')
				item.setAttribute('role', separator ? 'separator' : 'presentation')
				item.removeAttribute('tabindex')
				if (separator) {
					separator.setAttribute('role', 'none')
					for (const attr of ['aria-checked', 'aria-disabled', 'aria-label', 'tabindex']) separator.removeAttribute(attr)
				}
			}
			for (const item of menu.querySelectorAll('[role="menuitem"][aria-checked=""]')) item.removeAttribute('aria-checked')
		}
	}
	const extensions = await loadEditorExtensions(monaco)
	const selectionListener = view.onDidChangeCursorSelection(reportSelection)
	const positionListener = view.onDidChangeCursorPosition(reportSelection)
	const contentListener = view.onDidChangeModelContent(() => {
		if (!buffer) return
		onChange(buffer)
		reportSelection()
	})
	onThemeChange(refreshFont)
	document.fonts.addEventListener('loadingdone', refreshFont)
	void document.fonts.ready.then(refreshFont)

	/** @returns {string} 当前主题的代码字体栈，已适配 Monaco。 */
	function codeFontFamily() {
		return getComputedStyle(host).getPropertyValue('--font-code').trim() || 'Consolas, monospace'
	}

	/** @returns {void} 字体或主题变化后重新测量字符宽度。 */
	function refreshFont() {
		if (disposed) return
		view.updateOptions({ fontFamily: codeFontFamily() })
		monaco.editor.remeasureFonts()
		view.layout()
	}

	/** @returns {void} 上报当前从 1 开始的光标位置。 */
	function reportSelection() {
		if (!buffer) return
		const { lineNumber, column } = view.getPosition() || { lineNumber: 1, column: 1 }
		onSelection({ line: lineNumber, column })
	}

	return {
		view,
		/**
		 * 挂载文件模型并恢复其保存的编辑器视图。
		 * @param {object} next - 文件缓冲区。
		 * @param {string} filePath - 工作区相对文件路径。
		 * @returns {Promise<void>} 模型挂载完成。
		 */
		async show(next, filePath) {
			next.model?.updateOptions({ tabSize: 4, indentSize: 4, insertSpaces: false })
			if (buffer === next && view.getModel() === next.model) return
			if (buffer) buffer.viewState = view.saveViewState()
			buffer = null
			view.setModel(null)
			const ticket = ++revision
			if (!next.model) {
				const language = next.content.length > MAX_HIGHLIGHTED_CHARS ? 'plaintext' : await extensions.languageFor(filePath) || await resolveFileLanguage(filePath)
				if (disposed || ticket !== revision) return
				next.lineEnding ||= lineEndingOf(next.content)
				next.model = monaco.editor.createModel(next.content.replace(/\r\n|\r/g, LF), language, monaco.Uri.from({ scheme: 'fount-file', authority: crypto.randomUUID(), path: '/' + filePath }))
				next.model.updateOptions({ tabSize: 4, indentSize: 4, insertSpaces: false })
				next.savedAlternativeVersionId = next.model.getAlternativeVersionId()
				next.savedOriginalVersionId = next.savedAlternativeVersionId
			}
			if (disposed || ticket !== revision) return
			buffer = next
			view.setModel(next.model)
			if (next.viewState) view.restoreViewState(next.viewState)
			view.layout()
			reportSelection()
		},
		/** @returns {void} Detaches the current file model. */
		clear() {
			++revision
			if (buffer) buffer.viewState = view.saveViewState()
			buffer = null
			view.setModel(null)
		},
		/**
		 * 释放标签对应的 Monaco 模型。
		 * @param {object} target - 要释放模型的缓冲区。
		 * @returns {void}
		 */
		disposeBuffer(target) {
			if (!target?.model) return
			if (!disposed && view.getModel() === target.model) { ++revision; buffer = null; view.setModel(null) }
			target.model.dispose()
			target.model = null
			target.viewState = null
		},
		/** @returns {void} 聚焦编辑器。 */
		focus() { view.focus() },
		/**
		 * 隐藏编辑器时保留模型布局，重新显示时重新测量。
		 * @param {boolean} hidden - 编辑器宿主是否隐藏。
		 * @returns {void}
		 */
		setHidden(hidden) {
			if (host.hidden === hidden) return
			host.hidden = hidden
			if (!hidden) view.layout()
		},
		/** @returns {void} 刷新编辑器的本地化文案。 */
		translate() {
			translateActions()
			const node = view.getDomNode()
			if (node) node.setAttribute('aria-label', geti18n('code.explorer.editorLabel'))
		},
		/** @returns {void} 释放编辑器与全部监听。 */
		dispose() {
			disposed = true
			++revision
			buffer = null
			host.removeEventListener('keydown', stopEscape)
			document.fonts.removeEventListener('loadingdone', refreshFont)
			offLanguageChange(translateActions)
			unbindLocale()
			menuObserver.disconnect()
			for (const action of actions) action.dispose()
			selectionListener.dispose(); positionListener.dispose(); contentListener.dispose()
			view.dispose()
		},
	}
}
