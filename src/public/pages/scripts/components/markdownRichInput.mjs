/**
 * 【组件】fount 富文本输入框（contenteditable）。
 *
 * 把普通 `contenteditable` div 变成聊天/动态输入框：
 * - 行内 token（`@[entity:…]` / `@[role:…]` / `#[channel:…]` / `#[group:…]` / `#[message:…]` / `:[emoji:pack/id]:`）
 *   渲染为不可编辑的原子 chip（@ 美化 / 表情包内联），往返序列化为原始 fount 文本。
 * - 对外暴露 textarea 兼容 API（`value` / `selectionStart` / `selectionEnd` / `setSelectionRange` /
 *   `setRangeText` / `focus` / `disabled`），使既有 composer 接线可无痛迁移。
 * - 选中文字后浮动格式工具栏 + 右键菜单（加粗 / 斜体 / 删除线 / 行内代码 / 引用 / 链接 / 提及）。
 * - IME 组合期间不重建 DOM，避免破坏拼音/输入法候选。
 */
import { INLINE_TOKEN_RE } from '/parts/shells:chat/shared/inlineTokenSyntax.mjs'

import { bindDismissOnDocumentInteraction } from '/scripts/components/contextMenuDismiss.mjs'
import { positionContextMenu } from '/scripts/components/positionContextMenu.mjs'
import { resolvePackEmojiUrl } from '/scripts/features/emoji/packIndex.mjs'
import { promptText } from '/scripts/features/promptDialog.mjs'
import { setElementI18n } from '/scripts/i18n/index.mjs'

/** 块级标签（Firefox/浏览器 Enter 可能产生 `<div>` 等，序列化时视为换行）。 */
const BLOCK_TAGS = /^(?:DIV|P|LI|H[1-6]|PRE|BLOCKQUOTE|TR|TD)$/

/** markdown 行内包裹语法：前缀 → 后缀。 */
const WRAP_SYNTAX = {
	bold: ['**', '**'],
	italic: ['*', '*'],
	strike: ['~~', '~~'],
	code: ['`', '`'],
}

/** 浮动工具栏 / 右键菜单项（i18n 键 → 动作）。 */
const ACTION_I18N = {
	bold: 'util.markdownRichInput.bold',
	italic: 'util.markdownRichInput.italic',
	strike: 'util.markdownRichInput.strike',
	code: 'util.markdownRichInput.code',
	quote: 'util.markdownRichInput.quote',
	link: 'util.markdownRichInput.link',
	mention: 'util.markdownRichInput.mention',
	copy: 'util.markdownRichInput.copy',
	cut: 'util.markdownRichInput.cut',
	paste: 'util.markdownRichInput.paste',
}

/** 动作对应的 iconify（mdi）图标。 */
const ACTION_ICON = {
	bold: 'https://api.iconify.design/mdi/format-bold.svg',
	italic: 'https://api.iconify.design/mdi/format-italic.svg',
	strike: 'https://api.iconify.design/mdi/format-strikethrough-variant.svg',
	code: 'https://api.iconify.design/mdi/code-tags.svg',
	quote: 'https://api.iconify.design/mdi/format-quote-open.svg',
	link: 'https://api.iconify.design/mdi/link-variant.svg',
	mention: 'https://api.iconify.design/mdi/at.svg',
	copy: 'https://api.iconify.design/mdi/content-copy.svg',
	cut: 'https://api.iconify.design/mdi/content-cut.svg',
	paste: 'https://api.iconify.design/mdi/content-paste.svg',
}

/**
 * 动作对应的图标元素。
 * @param {string} action 动作名
 * @returns {HTMLImageElement} 图标元素
 */
function makeActionIcon(action) {
	const img = document.createElement('img')
	img.className = 'text-icon'
	img.src = ACTION_ICON[action]
	img.alt = ''
	img.setAttribute('aria-hidden', 'true')
	return img
}

/**
 * @param {HTMLElement} element 输入框根元素
 * @param {object} [options] 选项
 * @param {(token: { kind: string, body?: string, entityHash?: string, roleId?: string, id?: string }) => Promise<string | null>} [options.resolveTokenLabel]
 *   chip 显示名解析（mention / link）；返回 null 走内置兜底
 * @param {boolean} [options.enableToolbar=true] 是否启用选中文字浮动工具栏
 * @param {boolean} [options.enableContextMenu=true] 是否启用右键菜单
 * @returns {object} 组件控制句柄
 */
export function createMarkdownRichInput(element, options = {}) {
	const {
		resolveTokenLabel,
		enableToolbar = true,
		enableContextMenu = true,
	} = options

	if (!(element instanceof HTMLElement) || element.classList.contains('fount-markdown-rich-input'))
		throw new Error('markdownRichInput requires a fresh HTMLElement')

	element.classList.add('fount-markdown-rich-input')
	element.setAttribute('role', 'textbox')
	element.setAttribute('aria-multiline', 'true')
	element.spellcheck = true

	let rawText = ''
	let composing = false
	let disabled = element.hasAttribute('disabled')
	/** @type {Array<{ node: Node, kind: 'text'|'br'|'chip', raw?: string, start: number, end: number }>} */
	let segments = []

	/**
	 * 应用禁用状态（contenteditable / inert / class）。
	 * @returns {void}
	 */
	function applyDisabled() {
		element.contentEditable = disabled ? 'false' : 'true'
		if (disabled) element.setAttribute('inert', '')
		else element.removeAttribute('inert')
		element.toggleAttribute('aria-disabled', disabled)
		element.classList.toggle('is-disabled', disabled)
		if (disabled) element.blur()
	}

	// ---- 段/偏移映射（DOM ↔ 原始文本） ----

	/**
	 * 序列化单个节点为原始 fount 文本。
	 * @param {Node} node 节点
	 * @returns {string} 原始文本
	 */
	function serializeNode(node) {
		if (node.nodeType === Node.TEXT_NODE) return node.nodeValue
		if (!(node instanceof HTMLElement)) return ''
		if (node.dataset.emptySlot != null) return ''
		if (node.dataset.raw != null) return node.dataset.raw
		if (node instanceof HTMLBRElement) return '\n'
		const block = BLOCK_TAGS.test(node.tagName)
		let out = block ? '\n' : ''
		for (const child of node.childNodes) out += serializeNode(child)
		return block ? out + '\n' : out
	}

	/**
	 * 将当前 DOM 序列化为原始文本。
	 * @returns {string} 原始文本
	 */
	function serializeDom() {
		let out = ''
		for (const child of element.childNodes) out += serializeNode(child)
		return out
	}

	/**
	 * 计算子节点在原始文本中的长度。
	 * @param {Node} child 子节点
	 * @returns {number} 长度
	 */
	function childNodeLength(child) {
		if (child.nodeType === Node.TEXT_NODE) return child.nodeValue.length
		if (child instanceof HTMLElement && child.dataset.emptySlot != null) return 0
		if (child instanceof HTMLElement && child.dataset.raw != null) return child.dataset.raw.length
		return serializeNode(child).length
	}

	/**
	 * 构造 chip 元素（label 随 `.fount-markdown-rich-input-chip-label` 子节点展示）。
	 * @param {string} raw 原始 token 文本
	 * @param {string} kind chip 种类（mention / link / emoji）
	 * @returns {HTMLSpanElement} chip 元素
	 */
	function makeChip(raw, kind) {
		const chip = document.createElement('span')
		chip.className = `fount-markdown-rich-input-chip fount-markdown-rich-input-${kind}`
		chip.setAttribute('contenteditable', 'false')
		chip.dataset.raw = raw
		const label = document.createElement('span')
		label.className = 'fount-markdown-rich-input-chip-label'
		chip.appendChild(label)
		return chip
	}

	/**
	 * 解析原始 token 为描述对象。
	 * @param {string} kind mention / link
	 * @param {string} raw 原始文本
	 * @returns {object} token 描述
	 */
	function parseRawToken(kind, raw) {
		/** @type {{ kind: string, body: string, entityHash?: string, roleId?: string, id?: string }} */
		const token = { kind, body: raw }
		if (kind === 'mention') {
			const body = raw.slice(2, -1)
			if (body.startsWith('entity:')) token.entityHash = body.slice(7)
			else if (body.startsWith('role:')) token.roleId = body.slice(5)
		}
		else {
			const channel = raw.match(/^#\[channel:([\w.-]+)\/([\w.-]+)]$/)
			const group = raw.match(/^#\[group:([\w.-]+)]$/)
			const message = raw.match(/^#\[message:([\w.-]+)\/([\w.-]+)\/([\w.-]+)]$/)
			if (channel) token.id = channel[2]
			else if (group) token.id = group[1]
			else if (message) token.id = message[3]
		}
		return token
	}

	/**
	 * 解析并回填 chip 标签。
	 * @param {HTMLSpanElement} chip chip 元素
	 * @param {string} kind mention / link
	 * @param {string} raw 原始 token
	 * @returns {Promise<string | null>} 标签（含 @ / # 前缀）
	 */
	async function resolveChipLabel(chip, kind, raw) {
		const token = parseRawToken(kind, raw)
		const label = await resolveTokenLabel?.(token)
		if (label) return kind === 'mention' ? `@${String(label).replace(/^@/, '')}` : `#${String(label).replace(/^#/, '')}`
		if (kind === 'mention') {
			if (token.entityHash) return `@${token.entityHash.slice(0, 8)}…`
			if (token.roleId) return `@${token.roleId}`
		}
		if (token.id) return `#${token.id}`
		return null
	}

	/**
	 * 构造占位 chip（标签异步解析后回填）。
	 * @param {string} raw 原始 token
	 * @param {string} kind mention / link
	 * @returns {HTMLSpanElement} chip
	 */
	function makePlaceholderChip(raw, kind) {
		const chip = makeChip(raw, kind)
		chip.dataset.pendingKind = kind
		return chip
	}

	/**
	 * 构造自定义表情 chip（异步补图；失败回退标签）。
	 * @param {RegExpExecArray} match INLINE_TOKEN_RE 匹配
	 * @returns {HTMLSpanElement} chip
	 */
	function buildEmojiChip(match) {
		const raw = match[0]
		const packId = match[8]
		const emojiId = match[9]
		const chip = makeChip(raw, 'emoji')
		const label = chip.firstElementChild
		label.textContent = `:${emojiId}:`
		label.hidden = true
		const img = document.createElement('img')
		img.className = 'fount-emoji'
		img.alt = emojiId
		img.setAttribute('loading', 'lazy')
		/**
		 * 表情图加载失败回退。
		 * @returns {void}
		 */
		const fallback = () => {
			if (img.src) {
				img.remove()
				chip.classList.add('fount-markdown-rich-input-emoji-fallback')
				label.hidden = false
			}
		}
		img.addEventListener('error', fallback)
		chip.appendChild(img)
		void resolvePackEmojiUrl(packId, emojiId).then(url => {
			if (!chip.isConnected) return
			if (url) img.src = url
			else fallback()
		})
		return chip
	}

	/**
	 * 将文本段追加为 DOM（文本节点 / `<br>`），并记录 segments。
	 * @param {string} text 文本段
	 * @param {number} offsetStart 本段起始偏移
	 * @returns {number} 本段结束偏移
	 */
	function appendTextRun(text, offsetStart) {
		let cursor = offsetStart
		const lines = text.split('\n')
		for (let i = 0; i < lines.length; i++) {
			if (i > 0) {
				const br = document.createElement('br')
				element.appendChild(br)
				segments.push({ node: br, kind: 'br', start: cursor, end: cursor + 1 })
				cursor += 1
			}
			const line = lines[i]
			if (line) {
				const textNode = document.createTextNode(line)
				element.appendChild(textNode)
				segments.push({ node: textNode, kind: 'text', start: cursor, end: cursor + line.length })
				cursor += line.length
			}
		}
		return cursor
	}

	/**
	 * 根据 rawText 重建 DOM 与 segments。
	 * @returns {void}
	 */
	function rebuildDom() {
		segments = []
		element.replaceChildren()
		if (!rawText) {
			const placeholder = document.createElement('span')
			placeholder.className = 'fount-markdown-rich-input-placeholder'
			placeholder.setAttribute('contenteditable', 'false')
			placeholder.dataset.emptySlot = '1'
			placeholder.textContent = element.getAttribute('placeholder') ?? ''
			element.appendChild(placeholder)
			const br = document.createElement('br')
			br.dataset.emptySlot = '1'
			element.appendChild(br)
			segments = [
				{ node: placeholder, kind: 'br', start: 0, end: 0 },
				{ node: br, kind: 'br', start: 0, end: 1 },
			]
			return
		}
		INLINE_TOKEN_RE.lastIndex = 0
		let cursor = 0
		let match = null
		while ((match = INLINE_TOKEN_RE.exec(rawText)) != null) {
			if (match.index > cursor) cursor = appendTextRun(rawText.slice(cursor, match.index), cursor)
			const raw = match[0]
			const start = cursor
			const end = start + raw.length
			let chip
			if (match[8] != null) chip = buildEmojiChip(match)
			else if (match[1] != null) chip = makePlaceholderChip(raw, 'mention')
			else chip = makePlaceholderChip(raw, 'link')
			element.appendChild(chip)
			segments.push({ node: chip, kind: 'chip', raw, start, end })
			cursor = end
			INLINE_TOKEN_RE.lastIndex = match.index + raw.length
		}
		if (cursor < rawText.length) appendTextRun(rawText.slice(cursor), cursor)
		for (const seg of segments) {
			if (seg.kind !== 'chip') continue
			const chip = /** @type {HTMLSpanElement} */ seg.node
			const pendingKind = chip.dataset.pendingKind
			if (!pendingKind) continue
			void resolveChipLabel(chip, pendingKind, seg.raw).then(label => {
				if (!label || !chip.isConnected) return
				chip.firstElementChild.textContent = label
			})
		}
	}

	// ---- 选区 / 光标 ----

	/**
	 * DOM 位置 → 原始文本偏移（直接遍历子节点，不依赖可能过期的 segments）。
	 * @param {Node} node DOM 节点
	 * @param {number} offset 节点内偏移
	 * @returns {number} 原始文本偏移
	 */
	function domToOffset(node, offset) {
		if (node === element) {
			let len = 0
			let i = 0
			for (const child of element.childNodes) {
				if (i >= offset) break
				len += childNodeLength(child)
				i++
			}
			return len
		}
		let acc = 0
		for (const child of element.childNodes) {
			if (child === node) {
				if (node.nodeType === Node.TEXT_NODE) return acc + offset
				return offset > 0 ? acc + childNodeLength(child) : acc
			}
			acc += childNodeLength(child)
		}
		return rawText.length
	}

	/**
	 * 原始文本偏移 → DOM 位置。
	 * @param {number} offset 原始文本偏移
	 * @returns {{ node: Node, offset?: number, anchor?: 'before' | 'after' }} DOM 位置
	 */
	function offsetToDom(offset) {
		const clamped = Math.max(0, Math.min(rawText.length, offset))
		for (const seg of segments)
			if (clamped <= seg.end) {
				if (seg.kind === 'text') return { node: seg.node, offset: clamped - seg.start }
				return { node: seg.node, anchor: clamped > seg.start ? 'after' : 'before' }
			}
		const last = segments[segments.length - 1]
		if (!last) return { node: element, offset: 0 }
		if (last.kind === 'text') return { node: last.node, offset: last.end - last.start }
		return { node: last.node, anchor: 'after' }
	}

	/**
	 * 在 Range 上应用边界。
	 * @param {Range} range Range
	 * @param {'setStart' | 'setEnd'} method 方法名
	 * @param {{ node: Node, offset?: number, anchor?: 'before' | 'after' }} pos 位置
	 * @returns {void}
	 */
	function applyBoundary(range, method, pos) {
		const { node, offset = 0, anchor } = pos
		if (anchor === 'before') range[`${method}Before`](node)
		else if (anchor === 'after') range[`${method}After`](node)
		else range[method](node, offset)
	}

	/**
	 * 读取当前选区（原始文本偏移）。
	 * @returns {{ start: number, end: number }} 当前选区
	 */
	function getOffsets() {
		const sel = globalThis.getSelection()
		if (!sel || sel.rangeCount === 0) return { start: rawText.length, end: rawText.length }
		const range = sel.getRangeAt(0)
		if (!element.contains(range.startContainer) || !element.contains(range.endContainer))
			return { start: rawText.length, end: rawText.length }
		return {
			start: domToOffset(range.startContainer, range.startOffset),
			end: domToOffset(range.endContainer, range.endOffset),
		}
	}

	/**
	 * 设置选区（原始文本偏移）。
	 * @param {number} start 起始
	 * @param {number} end 结束
	 * @returns {void}
	 */
	function setSelection(start, end) {
		const range = document.createRange()
		applyBoundary(range, 'setStart', offsetToDom(start))
		applyBoundary(range, 'setEnd', offsetToDom(end))
		const sel = globalThis.getSelection()
		if (sel) {
			sel.removeAllRanges()
			sel.addRange(range)
		}
	}

	// ---- 渲染 ----

	/**
	 * 重建 DOM 并恢复选区。
	 * @returns {void}
	 */
	function render() {
		if (disabled) return
		const offsets = getOffsets()
		rebuildDom()
		setSelection(offsets.start, offsets.end)
	}

	// ---- 外部 API（textarea 兼容） ----

	/**
	 * 替换原始文本区间并设置选区。
	 * @param {string} replacement 替换文本
	 * @param {number} start 起始
	 * @param {number} end 结束
	 * @param {'end' | 'start' | 'select'} [selectionMode] 选区模式
	 * @returns {void}
	 */
	function setRangeText(replacement, start = getOffsets().start, end = start, selectionMode = 'end') {
		const text = String(replacement ?? '')
		const st = Math.max(0, Math.min(rawText.length, start))
		const en = Math.max(st, Math.min(rawText.length, end))
		rawText = rawText.slice(0, st) + text + rawText.slice(en)
		// 空 composer 里敲 Enter 会插入 `\n`，归一为空避免占位符被吃掉/落盘成空草稿
		if (!rawText.trim()) rawText = ''
		render()
		if (selectionMode === 'select') setSelection(st, st + text.length)
		else if (selectionMode === 'start') setSelection(st, st)
		else setSelection(st + text.length, st + text.length)
	}

	/**
	 * 设置原始文本（光标到末尾）。
	 * @param {string} value 原始文本
	 * @returns {void}
	 */
	function setRawText(value) {
		const text = value == null ? '' : String(value)
		rawText = text.trim() ? text : ''
		render()
		setSelection(rawText.length, rawText.length)
	}

	// ---- 事件 ----

	/**
	 * 输入事件：序列化 DOM 并重建。
	 * 纯空白结果（浏览器全选删除残留的 `<br>` 等）归一为空，让占位符恢复显示。
	 * @returns {void}
	 */
	function onInput() {
		if (disabled || composing) return
		const next = serializeDom()
		if (next === rawText) return
		rawText = next.trim() ? next : ''
		const offsets = getOffsets()
		rebuildDom()
		setSelection(offsets.start, offsets.end)
	}

	/**
	 * IME 组合结束：提交文本并重建。
	 * @returns {void}
	 */
	function onCompositionEnd() {
		composing = false
		const text = serializeDom()
		rawText = text.trim() ? text : ''
		const offsets = getOffsets()
		rebuildDom()
		setSelection(offsets.start, offsets.end)
	}

	/**
	 * beforeinput：将 Enter 段落统一转为 `\n`。
	 * @param {InputEvent} event beforeinput 事件
	 * @returns {void}
	 */
	function onBeforeInput(event) {
		if (disabled || composing) return
		if (event.inputType === 'insertParagraph') {
			event.preventDefault()
			const { start, end } = getOffsets()
			setRangeText('\n', start, end, 'end')
			element.dispatchEvent(new Event('input', { bubbles: true }))
		}
	}

	/**
	 * 粘贴：以纯文本插入。
	 * @param {ClipboardEvent} event 粘贴事件
	 * @returns {void}
	 */
	function onPaste(event) {
		if (disabled) return
		event.preventDefault()
		const text = event.clipboardData?.getData('text/plain') ?? ''
		if (!text) return
		const { start, end } = getOffsets()
		setRangeText(text, start, end, 'end')
		element.dispatchEvent(new Event('input', { bubbles: true }))
	}

	// ---- 浮动工具栏 ----

	/** @type {HTMLDivElement | null} */
	let toolbar = null

	/**
	 * 构造工具栏 / 菜单按钮（图标 + DaisyUI tooltip）。
	 * @param {string} action 动作名
	 * @param {string} className 按钮 class
	 * @param {() => void} onTrigger 触发回调
	 * @returns {HTMLButtonElement} 按钮元素
	 */
	function makeActionButton(action, className, onTrigger) {
		const button = document.createElement('button')
		button.type = 'button'
		button.className = `tooltip ${className}`
		button.dataset.action = action
		button.appendChild(makeActionIcon(action))
		setElementI18n(button, ACTION_I18N[action])
		button.addEventListener('mousedown', event => event.preventDefault())
		button.addEventListener('click', onTrigger)
		return button
	}

	/**
	 * 获取（惰性创建）工具栏元素。
	 * @returns {HTMLDivElement} 工具栏元素
	 */
	function getToolbar() {
		if (toolbar) return toolbar
		toolbar = document.createElement('div')
		toolbar.className = 'fount-markdown-rich-input-toolbar hidden'
		toolbar.setAttribute('role', 'toolbar')
		setElementI18n(toolbar, 'util.markdownRichInput.toolbar')
		for (const action of ['bold', 'italic', 'strike', 'code', 'quote', 'link', 'mention'])
			toolbar.appendChild(makeActionButton(action, 'fount-markdown-rich-input-toolbar-btn', () => {
				runAction(action)
				hideToolbar()
			}))
		document.body.appendChild(toolbar)
		return toolbar
	}

	/**
	 * 隐藏工具栏。
	 * @returns {void}
	 */
	function hideToolbar() {
		if (toolbar) toolbar.classList.add('hidden')
	}

	/**
	 * 更新工具栏可见性与位置。
	 * @returns {void}
	 */
	function updateToolbar() {
		if (disabled || !enableToolbar || composing) {
			hideToolbar()
			return
		}
		if (element !== document.activeElement) {
			hideToolbar()
			return
		}
		const sel = globalThis.getSelection()
		if (!sel || sel.rangeCount === 0) {
			hideToolbar()
			return
		}
		const range = sel.getRangeAt(0)
		if (range.collapsed) {
			hideToolbar()
			return
		}
		if (!element.contains(range.startContainer) || !element.contains(range.endContainer)) {
			hideToolbar()
			return
		}
		const rect = range.getBoundingClientRect()
		if (rect.width === 0 && rect.height === 0) {
			hideToolbar()
			return
		}
		const bar = getToolbar()
		bar.classList.remove('hidden')
		const barRect = bar.getBoundingClientRect()
		const x = Math.min(window.innerWidth - barRect.width - 8, Math.max(8, rect.left + rect.width / 2 - barRect.width / 2))
		const y = Math.max(8, rect.top - barRect.height - 8)
		bar.style.left = `${x}px`
		bar.style.top = `${y}px`
	}

	// ---- 动作 ----

	/**
	 * 包裹 / 切换 markdown 语法。
	 * @param {string} prefix 前缀
	 * @param {string} suffix 后缀
	 * @returns {void}
	 */
	function toggleWrap(prefix, suffix) {
		const { start, end } = getOffsets()
		const selected = rawText.slice(start, end)
		const wrapped = selected.length >= prefix.length + suffix.length
			&& selected.startsWith(prefix) && selected.endsWith(suffix)
		if (wrapped) {
			const inner = selected.slice(prefix.length, selected.length - suffix.length)
			rawText = rawText.slice(0, start) + inner + rawText.slice(end)
			render()
			setSelection(start, start + inner.length)
		}
		else {
			const inner = selected || 'text'
			const replacement = prefix + inner + suffix
			rawText = rawText.slice(0, start) + replacement + rawText.slice(end)
			render()
			setSelection(start + prefix.length, start + prefix.length + inner.length)
		}
	}

	/**
	 * 将选区转为引用块。
	 * @returns {void}
	 */
	function quoteSelection() {
		const { start, end } = getOffsets()
		const selected = rawText.slice(start, end) || 'quote'
		const quoted = selected.split('\n').map(line => `> ${line}`).join('\n')
		rawText = rawText.slice(0, start) + quoted + rawText.slice(end)
		render()
		setSelection(start, start + quoted.length)
	}

	/**
	 * 将选区包成 markdown 链接（弹窗填 URL）。
	 * @returns {Promise<void>} 完成
	 */
	async function linkSelection() {
		const { start, end } = getOffsets()
		const selected = rawText.slice(start, end) || ''
		const url = await promptText('util.markdownRichInput.linkUrl', '')
		if (url == null) return
		const replacement = `[${selected || url}](${url})`
		rawText = rawText.slice(0, start) + replacement + rawText.slice(end)
		render()
		setSelection(start + replacement.length, start + replacement.length)
	}

	/**
	 * 在光标处插入 @ 触发提及补全。
	 * @returns {void}
	 */
	function insertMentionTrigger() {
		const { start, end } = getOffsets()
		setRangeText('@', start, end, 'end')
		element.focus()
		element.dispatchEvent(new Event('input', { bubbles: true }))
	}

	/**
	 * 将当前选区复制到剪贴板。
	 * @returns {void}
	 */
	function copySelection() {
		const { start, end } = getOffsets()
		void navigator.clipboard?.writeText(rawText.slice(start, end))
	}

	/**
	 * 复制当前选区并删除。
	 * @returns {void}
	 */
	function cutSelection() {
		copySelection()
		const { start, end } = getOffsets()
		setRangeText('', start, end, 'end')
		element.dispatchEvent(new Event('input', { bubbles: true }))
	}

	/**
	 * 在光标处粘贴剪贴板文本。
	 * @returns {void}
	 */
	function pasteFromClipboard() {
		void navigator.clipboard?.readText().then(text => {
			if (!text) return
			const { start, end } = getOffsets()
			setRangeText(text, start, end, 'end')
			element.dispatchEvent(new Event('input', { bubbles: true }))
		})
	}

	/** 工具栏 / 右键菜单动作 → 执行器。 */
	const ACTION_RUNNERS = {
		/** @returns {void} 包裹/取消加粗语法。 */
		bold: () => toggleWrap(...WRAP_SYNTAX.bold),
		/** @returns {void} 包裹/取消斜体语法。 */
		italic: () => toggleWrap(...WRAP_SYNTAX.italic),
		/** @returns {void} 包裹/取消删除线语法。 */
		strike: () => toggleWrap(...WRAP_SYNTAX.strike),
		/** @returns {void} 包裹/取消行内代码语法。 */
		code: () => toggleWrap(...WRAP_SYNTAX.code),
		quote: quoteSelection,
		/** @returns {void} 将选区包成链接。 */
		link: () => void linkSelection(),
		mention: insertMentionTrigger,
		copy: copySelection,
		cut: cutSelection,
		paste: pasteFromClipboard,
	}

	/**
	 * 执行工具栏 / 右键菜单动作。
	 * @param {string} action 动作名
	 * @returns {void}
	 */
	function runAction(action) {
		ACTION_RUNNERS[action]?.()
	}

	// ---- 右键菜单 ----

	/** @type {HTMLDivElement | null} */
	let contextMenu = null

	/**
	 * 获取（惰性创建）右键菜单元素。
	 * @returns {HTMLDivElement} 菜单元素
	 */
	function getContextMenu() {
		if (contextMenu) return contextMenu
		contextMenu = document.createElement('div')
		contextMenu.className = 'fount-markdown-rich-input-context-menu hidden'
		contextMenu.setAttribute('role', 'menu')
		setElementI18n(contextMenu, 'util.markdownRichInput.contextMenu')
		for (const action of ['copy', 'cut', 'paste', 'bold', 'italic', 'strike', 'code', 'quote', 'link', 'mention']) {
			const button = makeActionButton(action, 'fount-markdown-rich-input-context-item', () => {
				runAction(action)
				closeContextMenu()
			})
			button.setAttribute('role', 'menuitem')
			contextMenu.appendChild(button)
		}
		document.body.appendChild(contextMenu)
		return contextMenu
	}

	/** @type {((() => void) & { unbind: () => void }) | null} */
	let contextMenuDismiss = null

	/**
	 * 关闭右键菜单并解绑文档监听。
	 * @returns {void}
	 */
	function closeContextMenu() {
		contextMenuDismiss?.()
		contextMenuDismiss = null
		if (contextMenu) contextMenu.classList.add('hidden')
	}

	/**
	 * 在指针处展示右键菜单。
	 * @param {MouseEvent} event 右键事件
	 * @returns {void}
	 */
	function showContextMenu(event) {
		if (disabled || !enableContextMenu) return
		event.preventDefault()
		const menu = getContextMenu()
		const sel = globalThis.getSelection()
		const hasSelection = !!sel && !sel.isCollapsed && element.contains(sel.anchorNode)
		for (const item of menu.children) {
			const action = /** @type {HTMLElement} */ item.dataset.action
			item.classList.toggle('hidden', !hasSelection && (action === 'copy' || action === 'cut'))
		}
		menu.classList.remove('hidden')
		positionContextMenu(menu, { x: event.clientX, y: event.clientY, minWidth: '9rem' })
		contextMenuDismiss = bindDismissOnDocumentInteraction(closeContextMenu)
	}

	/**
	 * 空态聚焦/点击时光标落到开头（而非占位符视觉结束处）。
	 * 先重建 DOM：浏览器编辑（select-all 删除等）可能已移除占位符节点，
	 * 而 segments 仍指向它，直接 setSelection 会因节点脱离文档抛 InvalidNodeTypeError。
	 * @returns {void}
	 */
	function placeCaretWhenEmpty() {
		if (disabled || rawText || composing) return
		rebuildDom()
		setSelection(0, 0)
	}

	// ---- 事件绑定 ----

	element.addEventListener('input', onInput)
	element.addEventListener('compositionstart', () => { composing = true })
	element.addEventListener('compositionend', onCompositionEnd)
	element.addEventListener('beforeinput', onBeforeInput)
	element.addEventListener('paste', onPaste)
	element.addEventListener('focus', placeCaretWhenEmpty)
	element.addEventListener('click', placeCaretWhenEmpty)
	document.addEventListener('selectionchange', updateToolbar)
	element.addEventListener('mouseup', updateToolbar)
	element.addEventListener('blur', () => {
		hideToolbar()
		setTimeout(closeContextMenu, 0)
	})
	element.addEventListener('contextmenu', showContextMenu)

	// i18n / 频道切换会改 `placeholder` 属性，同步到占位节点文本。
	const placeholderObserver = new MutationObserver(() => {
		const span = element.querySelector('[data-empty-slot="1"]')
		if (span instanceof HTMLSpanElement) span.textContent = element.getAttribute('placeholder') ?? ''
	})
	placeholderObserver.observe(element, { attributes: true, attributeFilter: ['placeholder'] })

	// ---- 对外接口 ----

	Object.defineProperties(element, {
		value: {
			/**
			 * 获取原始文本。
			 * @returns {string} 原始文本
			 */
			get: () => rawText,
			/**
			 * 设置原始文本。
			 * @param {string} value 原始文本
			 * @returns {void}
			 */
			set: setRawText,
			configurable: true,
		},
		selectionStart: {
			/**
			 * 获取选区起点。
			 * @returns {number} 起点偏移
			 */
			get: () => getOffsets().start,
			/**
			 * 设置选区起点。
			 * @param {number} value 起点偏移
			 * @returns {void}
			 */
			set: value => setSelection(Number(value), getOffsets().end),
			configurable: true,
		},
		selectionEnd: {
			/**
			 * 获取选区终点。
			 * @returns {number} 终点偏移
			 */
			get: () => getOffsets().end,
			/**
			 * 设置选区终点。
			 * @param {number} value 终点偏移
			 * @returns {void}
			 */
			set: value => setSelection(getOffsets().start, Number(value)),
			configurable: true,
		},
		disabled: {
			/**
			 * 获取禁用态。
			 * @returns {boolean} 是否禁用
			 */
			get: () => disabled,
			/**
			 * 设置禁用态。
			 * @param {boolean} value 是否禁用
			 * @returns {void}
			 */
			set: value => {
				disabled = Boolean(value)
				applyDisabled()
				if (!disabled) render()
			},
			configurable: true,
		},
	})
	/**
	 * 设置选区（textarea 兼容）。
	 * @param {number} start 起点
	 * @param {number} end 终点
	 * @returns {void}
	 */
	element.setSelectionRange = (start, end) => setSelection(Number(start), Number(end))
	element.setRangeText = setRangeText

	applyDisabled()
	setRawText(element.textContent || '')

	return {
		element,
		/**
		 * 获取原始文本。
		 * @returns {string} 原始文本
		 */
		get value() { return rawText },
		/**
		 * 设置原始文本。
		 * @param {string} value 原始文本
		 * @returns {void}
		 */
		set value(v) { setRawText(v) },
		/**
		 * 获取 IME 组合状态。
		 * @returns {boolean} 是否正在组合
		 */
		get composing() { return composing },
		/**
		 * 聚焦输入框。
		 * @returns {void}
		 */
		focus: () => element.focus(),
		setRangeText,
		setSelection,
		/**
		 * 销毁组件，恢复为纯文本节点。
		 * @returns {void}
		 */
		destroy: () => {
			placeholderObserver.disconnect()
			document.removeEventListener('selectionchange', updateToolbar)
			hideToolbar()
			closeContextMenu()
			element.replaceChildren(document.createTextNode(rawText))
			element.classList.remove('fount-markdown-rich-input')
		},
	}
}

/**
 * 判断元素是否为 fount 富文本输入框。
 * @param {HTMLElement} element 候选元素
 * @returns {boolean} 是否为富文本输入框
 */
export function isMarkdownRichInput(element) {
	return element instanceof HTMLElement && element.classList.contains('fount-markdown-rich-input')
}

/**
 * 判断元素是否承载 composer 文本（原生 textarea 或富文本输入框），
 * 供既有 textarea 接线统一判读 `.value` 类操作。
 * @param {Element | null} element 候选元素
 * @returns {boolean} 是否为文本承载元素
 */
export function isTextComposer(element) {
	return element instanceof HTMLTextAreaElement || isMarkdownRichInput(element)
}

// --- 全局样式注入 ---

document.head.prepend(Object.assign(document.createElement('style'), {
	textContent: /* css */ `
.fount-markdown-rich-input {
	min-width: 0;
	overflow-y: auto;
	white-space: pre-wrap;
	overflow-wrap: anywhere;
	word-break: break-word;
	cursor: text;
	outline: none;
}
.fount-markdown-rich-input.is-disabled {
	cursor: default;
}
.fount-markdown-rich-input-placeholder {
	opacity: .55;
	white-space: pre-wrap;
	user-select: none;
	pointer-events: none;
}
.fount-markdown-rich-input-chip {
	display: inline-flex;
	align-items: center;
	gap: .1em;
	max-width: 100%;
	border-radius: var(--radius-field);
	padding: 0 .3em;
	margin: 0 .05em;
	vertical-align: -0.08em;
	font-size: .92em;
	line-height: 1.3;
	user-select: none;
	cursor: default;
}
.fount-markdown-rich-input-chip[contenteditable="false"] {
	pointer-events: none;
}
.fount-markdown-rich-input-mention {
	background: color-mix(in srgb, var(--color-primary, oklch(0.7 0.16 250)) 22%, transparent);
	color: var(--color-primary, inherit);
	border: var(--border) solid color-mix(in srgb, var(--color-primary, oklch(0.7 0.16 250)) 35%, transparent);
}
.fount-markdown-rich-input-link {
	background: color-mix(in srgb, var(--color-info, oklch(0.7 0.14 230)) 18%, transparent);
	color: var(--color-info, inherit);
	border: var(--border) solid color-mix(in srgb, var(--color-info, oklch(0.7 0.14 230)) 30%, transparent);
}
.fount-markdown-rich-input-emoji {
	background: transparent;
	border: 0;
	padding: 0;
	margin: 0 .1em;
}
.fount-markdown-rich-input-emoji img.fount-emoji {
	height: 1.35em;
	width: 1.35em;
	vertical-align: -0.25em;
	object-fit: contain;
}
.fount-markdown-rich-input-emoji-fallback {
	font-size: .92em;
	opacity: .8;
}
.fount-markdown-rich-input-toolbar {
	position: fixed;
	z-index: 90;
	display: flex;
	gap: 2px;
	align-items: center;
	padding: 4px 6px;
	border-radius: var(--radius-box);
	background: var(--color-base-100, #fff);
	border: var(--border) solid var(--color-base-300, #d0d7de);
	box-shadow: 0 4px 16px rgb(0 0 0 / .18);
}
.fount-markdown-rich-input-toolbar.hidden {
	display: none;
}
.fount-markdown-rich-input-toolbar-btn {
	min-width: 1.75rem;
	height: 1.75rem;
	display: inline-flex;
	align-items: center;
	justify-content: center;
	border: 0;
	border-radius: var(--radius-field);
	background: transparent;
	color: inherit;
	padding: 0 .3rem;
	cursor: pointer;
}
.fount-markdown-rich-input-toolbar-btn:hover {
	background: var(--color-base-200, #eef1f4);
}
.fount-markdown-rich-input-context-menu {
	position: fixed;
	z-index: 90;
	min-width: 9rem;
	display: flex;
	flex-direction: column;
	padding: 4px;
	border-radius: var(--radius-box);
	background: var(--color-base-100, #fff);
	border: var(--border) solid var(--color-base-300, #d0d7de);
	box-shadow: 0 4px 16px rgb(0 0 0 / .18);
}
.fount-markdown-rich-input-context-menu.hidden {
	display: none;
}
.fount-markdown-rich-input-context-item {
	display: flex;
	align-items: center;
	gap: .4rem;
	width: 100%;
	text-align: left;
	border: 0;
	background: transparent;
	color: inherit;
	padding: .3rem .6rem;
	border-radius: var(--radius-field);
	font-size: .85rem;
	cursor: pointer;
}
.fount-markdown-rich-input-context-item:hover {
	background: var(--color-base-200, #eef1f4);
}
.fount-markdown-rich-input-toolbar-btn .text-icon,
.fount-markdown-rich-input-context-item .text-icon {
	width: 1.2em;
	height: 1.2em;
}
`,
}))
