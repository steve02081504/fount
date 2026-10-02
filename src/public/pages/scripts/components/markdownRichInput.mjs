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
import { getRegisteredInlineTokens, loadRegisteredMarkdownExtensions } from '/scripts/features/markdown/extensions.mjs'

import { bindDismissOnDocumentInteraction } from '/scripts/components/contextMenuDismiss.mjs'
import { positionContextMenu } from '/scripts/components/positionContextMenu.mjs'
import { svgInliner } from '/scripts/lib/svgInliner.mjs'
import { promptText } from '/scripts/features/promptDialog.mjs'
import { setElementI18n } from '/scripts/i18n/index.mjs'

/** 块级标签（Firefox/浏览器 Enter 可能产生 `<div>` 等，序列化时视为换行）。 */
const BLOCK_TAGS = /^(?:DIV|P|LI|H[1-6]|PRE|BLOCKQUOTE|TR|TD)$/

/** 高亮器按需加载，语言与主题由 Shiki 的单例缓存。 */
let shikiModule

/**
 * 扫描闭合的反引号围栏；短围栏留在外层代码正文中。
 * @param {string} text 原始文本
 * @param {boolean} [nested=false] 是否包含正文中的内层围栏
 * @returns {Array<{ start: number, body: number, close: number, end: number, size: number }>} 围栏范围
 */
function codeBlocks(text, nested = false) {
	const lines = /^[\t ]{0,3}(`{3,})([^\n]*)$/gm
	const blocks = []
	let opening = null
	for (const match of text.matchAll(lines))
		if (!opening) {
			if (!match[2].includes('`')) opening = { start: match.index, body: match.index + match[0].length + 1, size: match[1].length }
		}
		else if (!match[2].trim() && match[1].length >= opening.size) {
			const block = { ...opening, close: match.index, end: match.index + match[0].length }
			blocks.push(block)
			if (nested)
				for (const inner of codeBlocks(text.slice(block.body, block.close), true))
					blocks.push({ ...inner, start: inner.start + block.body, body: inner.body + block.body, close: inner.close + block.body, end: inner.end + block.body })
			opening = null
		}

	return blocks
}

/** markdown 行内包裹语法：前缀 → 后缀。 */
const WRAP_SYNTAX = {
	bold: ['**', '**'],
	italic: ['*', '*'],
	strike: ['~~', '~~'],
	code: ['`', '`'],
}

/** 浮动工具栏 / 右键菜单项（i18n 键 → 动作）。 */
const ACTION_I18N = {
	headingLarge: 'util.markdownRichInput.headingLarge',
	headingMedium: 'util.markdownRichInput.headingMedium',
	headingSmall: 'util.markdownRichInput.headingSmall',
	bold: 'util.markdownRichInput.bold',
	italic: 'util.markdownRichInput.italic',
	strike: 'util.markdownRichInput.strike',
	code: 'util.markdownRichInput.code',
	quote: 'util.markdownRichInput.quote',
	listUl: 'util.markdownRichInput.listUl',
	listOl: 'util.markdownRichInput.listOl',
	link: 'util.markdownRichInput.link',
	mention: 'util.markdownRichInput.mention',
	copy: 'util.markdownRichInput.copy',
	cut: 'util.markdownRichInput.cut',
	paste: 'util.markdownRichInput.paste',
}

/** 动作对应的 iconify（mdi）图标。 */
const ACTION_ICON = {
	foldCode: 'https://api.iconify.design/mdi/chevron-down.svg',
	expandCode: 'https://api.iconify.design/mdi/chevron-right.svg',
	headingLarge: 'https://api.iconify.design/mdi/format-header-1.svg',
	headingMedium: 'https://api.iconify.design/mdi/format-header-2.svg',
	headingSmall: 'https://api.iconify.design/mdi/format-header-3.svg',
	bold: 'https://api.iconify.design/mdi/format-bold.svg',
	italic: 'https://api.iconify.design/mdi/format-italic.svg',
	strike: 'https://api.iconify.design/mdi/format-strikethrough-variant.svg',
	code: 'https://api.iconify.design/mdi/code-tags.svg',
	quote: 'https://api.iconify.design/mdi/format-quote-open.svg',
	listUl: 'https://api.iconify.design/mdi/format-list-bulleted.svg',
	listOl: 'https://api.iconify.design/mdi/format-list-numbered.svg',
	link: 'https://api.iconify.design/mdi/link-variant.svg',
	mention: 'https://api.iconify.design/mdi/at.svg',
	copy: 'https://api.iconify.design/mdi/content-copy.svg',
	cut: 'https://api.iconify.design/mdi/content-cut.svg',
	paste: 'https://api.iconify.design/mdi/content-paste.svg',
}

/** 块级前缀动作：前缀 → 光标所在行应用的前缀。 */
const BLOCK_PREFIX = {
	headingLarge: '# ',
	headingMedium: '## ',
	headingSmall: '### ',
	listUl: '- ',
	listOl: '1. ',
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
 * 在原始文本中从指定偏移起查找下一个 inline token 命中。
 * 遍历给定 token 定义，返回最早命中的项；并列时先出现的定义优先。
 * @param {string} rawText 原始文本
 * @param {number} fromIndex 起始偏移
 * @param {Array<object>} tokens inline token 定义列表
 * @returns {{ token: object, match: RegExpExecArray } | null} 命中结果
 */
function findNextToken(rawText, fromIndex, tokens) {
	/** @type {{ token: object, match: RegExpExecArray } | null} */
	let best = null
	for (const token of tokens) {
		const regex = new RegExp(token.regex.source, token.regex.flags.replace(/[gy]/g, '') + 'g')
		regex.lastIndex = fromIndex
		const match = regex.exec(rawText)
		if (match && (!best || match.index < best.match.index)) best = { token, match }
	}
	return best
}

/**
 * @param {HTMLElement} element 输入框根元素
 * @param {object} [options] 选项
 * @param {(token: { kind: string, body?: string, entityHash?: string, roleId?: string, id?: string }) => Promise<string | null>} [options.resolveTokenLabel]
 *   chip 显示名解析（mention / link）；返回 null 走内置兜底
 * @param {boolean} [options.enableToolbar=true] 是否启用选中文字浮动工具栏
 * @param {boolean} [options.enableContextMenu=true] 是否启用右键菜单
 * @param {boolean} [options.enableDockedToolbar=false] 是否启用停靠格式工具栏（插入到元素前，常显）
 * @param {Array<{ kind: string, regex: RegExp, parse?: Function, resolveLabel?: Function, buildChip?: Function }>} [options.inlineTokens]
 *   调用方直接提供的 inline token 定义（优先于注册表项；如 code shell 的 `@file:…` 文件引用）
 * @param {boolean} [options.useRegisteredInlineTokens=true] 是否合并注册表（markdown_extensions）的 inline token；false 时仅用 `inlineTokens`
 * @param {string|null} [options.placeholderI18n=null] 空态占位符 i18n 键（`data-i18n`）；设了则占位 span 走本地化，忽略 `placeholder` 属性
 * @returns {object} 组件控制句柄
 */
export function createMarkdownRichInput(element, options = {}) {
	const {
		resolveTokenLabel,
		enableToolbar = true,
		enableContextMenu = true,
		enableDockedToolbar = false,
		inlineTokens = [],
		useRegisteredInlineTokens = true,
		placeholderI18n = null,
	} = options

	if (!(element instanceof HTMLElement) || element.classList.contains('fount-markdown-rich-input'))
		throw new Error('markdownRichInput requires a fresh HTMLElement')

	/**
	 * 当前生效的 inline token 定义：调用方提供项优先，其后按需合并注册表项。
	 * @returns {Array<object>} token 定义列表
	 */
	function getTokens() {
		return useRegisteredInlineTokens
			? [...inlineTokens, ...getRegisteredInlineTokens()]
			: inlineTokens
	}

	element.classList.add('fount-markdown-rich-input')
	if (enableDockedToolbar) element.classList.add('fount-markdown-rich-input-resizable')
	element.setAttribute('role', 'textbox')
	element.setAttribute('aria-multiline', 'true')
	element.spellcheck = true

	let rawText = ''
	const foldedBlocks = new Set()
	const highlightedBlocks = new Map()
	let renderVersion = 0
	let composing = false
	let disabled = element.hasAttribute('disabled')
	/**
	 * 行尾提示（幽灵补全）：`forRaw === rawText` 时在尾随 `<br>` 前渲染 `text`。
	 * 内容一旦变化（forRaw 失去匹配）自动失效，不需外部清理。
	 * @type {{ text: string, forRaw: string }}
	 */
	let suffixHint = { text: '', forRaw: '' }
	/** 当前 DOM 中是否已渲染提示节点（供 `setSuffixHint` 判断清除时是否需要重建）。 */
	let hintRendered = false
	/** 空态占位符的 i18n 键；非空时占位 span 由 `data-i18n` 驱动（随语种自动重译，不受 `placeholder` 属性影响）。 */
	let placeholderI18nKey = placeholderI18n
	/** 空态光标锚点（可编辑零宽文本），让光标停在可编辑位置而非占位符边界。 */
	const caretAnchors = new WeakSet()
	/** @type {Array<{ node: Node, kind: 'text'|'br'|'chip', raw?: string, start: number, end: number, token?: object }>} */
	let segments = []
	/** 撤销/重做历史（rawText 快照）上限。 */
	const HISTORY_LIMIT = 100
	/** @type {string[]} 撤销/重做历史（rawText 快照）。 */
	let history = []
	/** @type {number} 当前历史索引。 */
	let historyIndex = -1

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
		if (dockedToolbar) dockedToolbar.toggleAttribute('hidden', disabled)
		if (disabled) element.blur()
	}

	// ---- 段/偏移映射（DOM ↔ 原始文本） ----

	/**
	 * 序列化单个节点为原始 fount 文本。
	 * @param {Node} node 节点
	 * @returns {string} 原始文本
	 */
	function serializeNode(node) {
		if (node.nodeType === Node.TEXT_NODE)
			return caretAnchors.has(node) ? node.nodeValue.replace(/\u200B/g, '') : node.nodeValue
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
	 * 计算子节点在原始文本中的长度（即其序列化文本长度）。
	 * @param {Node} child 子节点
	 * @returns {number} 长度
	 */
	function childNodeLength(child) {
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
	 * 按 token 定义解析原始 token 为描述对象。
	 * @param {object} token token 定义
	 * @param {string} raw 原始 token
	 * @returns {object} token 描述
	 */
	function parseRawTokenByDef(token, raw) {
		return token.parse ? token.parse(raw) : { kind: token.kind, body: raw }
	}

	/**
	 * 给标签加前缀（mention 加 @ / link 加 #）。
	 * @param {string} kind chip 种类
	 * @param {string} label 标签
	 * @returns {string} 带前缀标签
	 */
	function prefixTokenLabel(kind, label) {
		const text = String(label)
		if (kind === 'mention') return `@${text.replace(/^@/, '')}`
		if (kind === 'link') return `#${text.replace(/^#/, '')}`
		return text
	}

	/**
	 * 解析并回填 chip 标签。
	 * @param {HTMLSpanElement} chip chip 元素
	 * @param {object} token token 定义
	 * @param {string} raw 原始 token
	 * @returns {Promise<string | null>} 标签（含 @ / # 前缀）
	 */
	async function resolveChipLabel(chip, token, raw) {
		const parsed = parseRawTokenByDef(token, raw)
		const label = await resolveTokenLabel?.(parsed)
		if (label) return prefixTokenLabel(token.kind, String(label))
		const extLabel = await token.resolveLabel?.(parsed)
		if (extLabel) return prefixTokenLabel(token.kind, String(extLabel))
		if (token.kind === 'mention') {
			if (parsed.entityHash) return `@${parsed.entityHash.slice(0, 8)}…`
			if (parsed.roleId) return `@${parsed.roleId}`
		}
		if (token.kind === 'link' && parsed.id) return `#${parsed.id}`
		return null
	}

	/**
	 * 构造占位 chip（标签异步解析后回填）。
	 * @param {string} raw 原始 token
	 * @param {string} kind mention / link
	 * @returns {HTMLSpanElement} chip
	 */
	function makePlaceholderChip(raw, kind) {
		return makeChip(raw, kind)
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
	 * 追加可编辑的围栏行；换行单独追加，避免装饰跨到正文。
	 * @param {number} start 围栏起点
	 * @param {number} end 围栏终点（不含换行）
	 * @returns {void}
	 */
	function appendFence(start, end) {
		const span = document.createElement('span')
		span.className = 'fount-markdown-rich-input-fence'
		const node = document.createTextNode(rawText.slice(start, end))
		span.appendChild(node)
		element.appendChild(span)
		segments.push({ node, kind: 'text', start, end })
	}

	/**
	 * 取代码高亮 token（按围栏原文缓存，按需加载 Shiki）。
	 * @param {string} raw 围栏原文（缓存键）
	 * @param {string} code 代码正文
	 * @param {string} language 语言标识
	 * @returns {Array<Array<object>> | Promise<Array<Array<object>> | null> | null} token 行数组 / 加载中 Promise / null 表示不可高亮
	 */
	function highlightTokens(raw, code, language) {
		if (!highlightedBlocks.has(raw)) {
			shikiModule ??= import('https://esm.sh/shiki')
			const pending = shikiModule.then(async ({ bundledLanguages, codeToTokensWithThemes }) => {
				if (!Object.hasOwn(bundledLanguages, language)) return null
				const tokens = await codeToTokensWithThemes(code, {
					lang: language,
					themes: { light: 'github-light', dark: 'github-dark-dimmed' },
				})
				// 不让高亮器的换行规范化改变可编辑原文。
				return tokens.map(line => line.map(token => token.content).join('')).join('\n') === code ? tokens : null
			}).catch(() => null)
			highlightedBlocks.set(raw, pending)
			// 当前文档的块不能逐出，否则多个异步块会反复加载和重建。
			if (highlightedBlocks.size > 32)
				for (const key of highlightedBlocks.keys()) {
					if (!rawText.includes(key)) highlightedBlocks.delete(key)
					if (highlightedBlocks.size <= 32) break
				}
			void pending.then(tokens => {
				if (highlightedBlocks.get(raw) === pending) highlightedBlocks.set(raw, tokens)
			})
		}
		return highlightedBlocks.get(raw)
	}

	/**
	 * 构造代码块折叠/展开按钮。
	 * @param {string} raw 围栏原文
	 * @param {number} start 围栏起点
	 * @param {boolean} folded 当前是否折叠
	 * @returns {HTMLButtonElement} 按钮元素
	 */
	function makeFoldButton(raw, start, folded) {
		const button = document.createElement('button')
		button.type = 'button'
		button.className = 'fount-markdown-rich-input-fold'
		button.contentEditable = 'false'
		button.dataset.emptySlot = '1'
		button.setAttribute('aria-expanded', String(!folded))
		setElementI18n(button, folded ? 'util.markdownRichInput.expandCode' : 'util.markdownRichInput.foldCode')
		button.appendChild(makeActionIcon(folded ? 'expandCode' : 'foldCode'))
		void svgInliner(button)
		button.addEventListener('mousedown', event => event.preventDefault())
		button.addEventListener('click', () => {
			if (disabled) return
			if (folded) foldedBlocks.delete(raw)
			else foldedBlocks.add(raw)
			rebuildDom()
			setSelection(start, start)
		})
		return button
	}

	/**
	 * 渲染可编辑的高亮正文；围栏保留原文，span 不参与块级序列化。
	 * @param {{ start: number, body: number, close: number, end: number }} block 围栏范围
	 * @returns {void}
	 */
	function appendCodeBlock(block) {
		const raw = rawText.slice(block.start, block.end)
		const code = rawText.slice(block.body, block.close)
		const language = rawText.slice(block.start, block.body).match(/`{3,}\s*([^\s`]+)/)?.[1]?.toLowerCase()
		appendFence(block.start, block.body - 1)
		appendTextRun('\n', block.body - 1)
		const tokens = language && highlightTokens(raw, code, language)
		if (tokens instanceof Promise) {
			const version = renderVersion
			void tokens.then(() => {
				if (version !== renderVersion || composing) return
				const offsets = getOffsets()
				rebuildDom()
				if (document.activeElement === element) setSelection(offsets.start, offsets.end)
			})
		}
		if (!tokens || tokens instanceof Promise) {
			appendTextRun(code, block.body)
			appendFence(block.close, block.end)
			return
		}
		let cursor = block.body
		for (let i = 0; i < tokens.length; i++) {
			if (i) cursor = appendTextRun('\n', cursor)
			for (const token of tokens[i]) {
				if (!token.content) continue
				const span = document.createElement('span')
				span.className = 'fount-markdown-rich-input-code-token'
				span.style.setProperty('--shiki-light', token.variants.light.color)
				span.style.setProperty('--shiki-dark', token.variants.dark.color)
				const node = document.createTextNode(token.content)
				span.appendChild(node)
				element.appendChild(span)
				segments.push({ node, kind: 'text', start: cursor, end: cursor + token.content.length })
				cursor += token.content.length
			}
		}
		appendFence(block.close, block.end)
	}

	/**
	 * 根据 rawText 重建 DOM 与 segments。
	 * @returns {void}
	 */
	function rebuildDom() {
		renderVersion++
		segments = []
		hintRendered = false
		element.replaceChildren()
		if (!rawText) {
			// 空态结构：可编辑零宽锚点 + 不可编辑占位符 + `<br>`。
			// 锚点让光标停在可编辑文本位置（Linux 浏览器渲染稳定，避免闪烁），视觉上仍在占位符之前；
			// 占位符留在文档流中，随内容撑高输入框。
			const anchor = document.createTextNode('\u200B')
			caretAnchors.add(anchor)
			const placeholder = document.createElement('span')
			placeholder.className = 'fount-markdown-rich-input-placeholder'
			placeholder.setAttribute('contenteditable', 'false')
			placeholder.dataset.emptySlot = '1'
			if (placeholderI18nKey) setElementI18n(placeholder, placeholderI18nKey)
			else placeholder.textContent = element.getAttribute('placeholder') ?? ''
			const br = document.createElement('br')
			br.dataset.emptySlot = '1'
			element.append(anchor, placeholder, br)
			segments = [
				{ node: anchor, kind: 'text', start: 0, end: 0 },
				{ node: placeholder, kind: 'br', start: 0, end: 0 },
				{ node: br, kind: 'br', start: 0, end: 1 },
			]
			return
		}
		let cursor = 0
		const blocks = codeBlocks(rawText)
		while (cursor < rawText.length) {
			const block = blocks.find(item => item.start >= cursor)
			const hit = findNextToken(rawText, cursor, getTokens())
			if (block && (!hit || block.start <= hit.match.index)) {
				if (block.start > cursor) appendTextRun(rawText.slice(cursor, block.start), cursor)
				const raw = rawText.slice(block.start, block.end)
				const folded = foldedBlocks.has(raw)
				element.appendChild(makeFoldButton(raw, block.start, folded))
				if (folded) {
					const chip = makeChip(raw, 'code-block')
					chip.firstElementChild.textContent = raw.split('\n')[0] + ' …'
					element.appendChild(chip)
					segments.push({ node: chip, kind: 'chip', raw, start: block.start, end: block.end })
				}
				else appendCodeBlock(block)
				cursor = block.end
				continue
			}
			if (!hit) break
			const { token, match } = hit
			if (match.index > cursor) cursor = appendTextRun(rawText.slice(cursor, match.index), cursor)
			const raw = match[0]
			const start = cursor
			const end = start + raw.length
			const chip = token.buildChip?.(match, { makeChip }) ?? makePlaceholderChip(raw, token.kind)
			element.appendChild(chip)
			segments.push({ node: chip, kind: 'chip', raw, start, end, token })
			cursor = end
		}
		if (cursor < rawText.length) appendTextRun(rawText.slice(cursor), cursor)
		// 行尾提示紧随已输入文本（内容未变且 hint 有效时），插在尾随 `<br>` 之前，避免显示到下一行。
		// 标记 emptySlot，不参与序列化与偏移映射，也不进 segments。
		if (suffixHint.text && suffixHint.forRaw === rawText) {
			const hint = document.createElement('span')
			hint.className = 'fount-markdown-rich-input-suffix-hint'
			hint.setAttribute('contenteditable', 'false')
			hint.dataset.emptySlot = '1'
			hint.textContent = suffixHint.text
			element.appendChild(hint)
			hintRendered = true
		}
		// contenteditable 块末尾的 `<br>` 不渲染空行：rawText 末尾的 `\n` 需再跟一个尾随 br 才能撑出光标可停的空行，
		// 否则按一次回车视觉上不换行（必须按两次）。尾随 br 标记 emptySlot，不参与序列化与偏移映射。
		const padding = document.createElement('br')
		padding.dataset.emptySlot = '1'
		element.appendChild(padding)
		segments.push({ node: padding, kind: 'br', start: rawText.length, end: rawText.length })
		for (const seg of segments) {
			if (seg.kind !== 'chip' || !seg.token) continue
			const chip = /** @type {HTMLSpanElement} */ seg.node
			void resolveChipLabel(chip, seg.token, seg.raw).then(label => {
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
			if (child instanceof HTMLElement && child.contains(node) && child.dataset.raw == null && child.dataset.emptySlot == null) {
				const range = document.createRange()
				range.setStart(child, 0)
				range.setEnd(node, offset)
				let text = ''
				for (const part of range.cloneContents().childNodes) text += serializeNode(part)
				return acc + text.length
			}
			if (child === node) {
				if (node.nodeType === Node.TEXT_NODE) return acc + Math.min(offset, childNodeLength(node))
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
		const edit = editCodeText(text, st, en)
		rawText = edit.text
		// 空 composer 里敲 Enter 会插入 `\n`，归一为空避免占位符被吃掉/落盘成空草稿
		if (!rawText.trim()) rawText = ''
		render()
		if (selectionMode === 'select') setSelection(edit.start, edit.caret)
		else if (selectionMode === 'start') setSelection(edit.start, edit.start)
		else setSelection(edit.caret, edit.caret)
	}

	/**
	 * 删除围栏时同步配对边界；加长开头或插入正文围栏时加长配对边界；逐字输入时补全闭合部分。
	 * @param {string} text 插入文本
	 * @param {number} start 替换起点
	 * @param {number} end 替换终点
	 * @param {boolean} [complete=false] 是否补全新开头
	 * @returns {{ text: string, start: number, caret: number }} 编辑结果
	 */
	function editCodeText(text, start, end, complete = false) {
		let next = rawText.slice(0, start) + text + rawText.slice(end)
		let caret = start + text.length
		const lineStart = next.lastIndexOf('\n', caret - 1) + 1
		const lineEnd = next.indexOf('\n', caret)
		const line = next.slice(lineStart, lineEnd < 0 ? next.length : lineEnd)
		const newOpening = complete && text === '`' && /^[\t ]{0,3}`{3}$/.test(line) && caret === lineStart + line.length
		const blocks = codeBlocks(rawText, true)
		if (!text && end > start && /^`+$/.test(rawText.slice(start, end)))
			for (const block of blocks) {
				const opening = block.start + /^[\t ]*/.exec(rawText.slice(block.start))[0].length
				const closingMatch = /^[\t ]*(`+)/.exec(rawText.slice(block.close))
				const closing = block.close + closingMatch[0].length - closingMatch[1].length
				const inOpening = start >= opening && end <= opening + block.size
				const inClosing = start >= closing && end <= closing + closingMatch[1].length
				if (!inOpening && !inClosing) continue
				const size = (inOpening ? block.size : closingMatch[1].length) - (end - start)
				let pairStart = inOpening ? closing : opening
				let pairEnd = pairStart + (inOpening ? closingMatch[1].length : block.size)
				let replacement = '`'.repeat(Math.max(0, size))
				if (size < 3) {
					replacement = ''
					if (!rawText.slice(opening + block.size, closing).trim()) {
						pairStart = inOpening ? opening + block.size : block.start
						pairEnd = inOpening ? block.end : closing
					}
					else if (inOpening) {
						pairStart = block.close - 1
						pairEnd = block.end
					}
				}
				const delta = text.length - (end - start)
				if (pairStart >= end) { pairStart += delta; pairEnd += delta }
				next = next.slice(0, pairStart) + replacement + next.slice(pairEnd)
				if (pairEnd <= start) {
					start += replacement.length - (pairEnd - pairStart)
					caret += replacement.length - (pairEnd - pairStart)
				}
				return { text: next, start, caret }
			}
		const outers = blocks.filter(block => start >= block.body && end <= block.close && start < block.close).sort((a, b) => b.start - a.start)
		if (/^`+$/.test(text) && text.length > end - start) {
			const block = blocks.find(item => {
				const opening = item.start + /^[\t ]*/.exec(rawText.slice(item.start))[0].length
				return start >= opening && end <= opening + item.size
			})
			if (block) {
				const close = block.close + text.length - (end - start)
				const closing = /^[\t ]*(`+)/.exec(next.slice(close))
				const extra = Math.max(0, block.size + text.length - (end - start) - closing[1].length)
				const position = close + closing[0].length
				next = next.slice(0, position) + '`'.repeat(extra) + next.slice(position)
			}
		}
		if (newOpening) next = next.slice(0, caret) + '\n\n```' + next.slice(caret)
		for (const outer of outers) {
			const delta = next.length - rawText.length
			const body = next.slice(outer.body, outer.close + delta)
			let longest = 0
			for (const match of body.matchAll(/^[\t ]{0,3}(`{3,})/gm)) longest = Math.max(longest, match[1].length)
			const extra = Math.max(0, longest + 1 - outer.size)
			if (extra) {
				const ticks = '`'.repeat(extra)
				const close = outer.close + delta + /^[\t ]*/.exec(next.slice(outer.close + delta))[0].length
				next = next.slice(0, close) + ticks + next.slice(close)
				const opening = outer.start + /^[\t ]*/.exec(next.slice(outer.start))[0].length
				next = next.slice(0, opening) + ticks + next.slice(opening)
				start += extra
				caret += extra
			}
		}
		return { text: next, start, caret }
	}

	/**
	 * 设置原始文本（光标到末尾）。重设后清空撤销/重做历史。
	 * @param {string} value 原始文本
	 * @returns {void}
	 */
	function setRawText(value) {
		const text = value == null ? '' : String(value)
		rawText = text.trim() ? text : ''
		history = [rawText]
		historyIndex = 0
		render()
		setSelection(rawText.length, rawText.length)
	}

	/**
	 * 设置行尾提示（幽灵补全的剩余文本），渲染在已输入文本之后、尾随 `<br>` 之前。
	 * 内容改变后自动失效；传空串清除。
	 * @param {string|null} text 提示文本
	 * @returns {void}
	 */
	function setSuffixHint(text) {
		const next = text == null ? '' : String(text)
		if (suffixHint.text === next && suffixHint.forRaw === rawText) return
		const shouldRender = next ? true : hintRendered
		suffixHint = { text: next, forRaw: rawText }
		if (disabled || !shouldRender) return
		const offsets = getOffsets()
		rebuildDom()
		// 仅在焦点位于输入框内时恢复选区：清除提示常由 selectionchange/失焦触发，此时抢走文档选区会打断别处的输入
		if (document.activeElement === element) setSelection(offsets.start, offsets.end)
	}

	// ---- 撤销 / 重做 ----

	/**
	 * 提交一次内容变更：写入撤销历史并派发 input 事件（供草稿保存 / 预览等接线使用）。
	 * 内容未变化时仅派发事件，不新增历史记录。
	 * @returns {void}
	 */
	function commitChange() {
		if (rawText !== history[historyIndex]) {
			history = history.slice(0, historyIndex + 1)
			history.push(rawText)
			if (history.length > HISTORY_LIMIT) history.shift()
			historyIndex = history.length - 1
		}
		element.dispatchEvent(new Event('input', { bubbles: true }))
	}

	/**
	 * 恢复当前 historyIndex 对应的状态并派发 input。
	 * @returns {void}
	 */
	function applyHistoryState() {
		rawText = history[historyIndex]
		rebuildDom()
		setSelection(rawText.length, rawText.length)
		element.dispatchEvent(new Event('input', { bubbles: true }))
	}

	/**
	 * 撤销到上一历史状态。
	 * @returns {void}
	 */
	function undo() {
		if (disabled || composing || historyIndex <= 0) return
		historyIndex--
		applyHistoryState()
	}

	/**
	 * 重做到下一历史状态。
	 * @returns {void}
	 */
	function redo() {
		if (disabled || composing || historyIndex >= history.length - 1) return
		historyIndex++
		applyHistoryState()
	}

	/**
	 * Ctrl+Z / Ctrl+Shift+Z / Ctrl+Y：撤销 / 重做。
	 * @param {KeyboardEvent} event 键盘事件
	 * @returns {void}
	 */
	function onKeyDown(event) {
		if (disabled || composing) return
		const mod = event.ctrlKey || event.metaKey
		if (!mod) return
		const key = event.key.toLowerCase()
		if (key === 'z') {
			event.preventDefault()
			if (event.shiftKey) redo()
			else undo()
		}
		else if (key === 'y') {
			event.preventDefault()
			redo()
		}
	}

	// ---- 事件 ----

	/**
	 * 输入事件：序列化 DOM 并重建，随后提交变更（撤销历史 + input 事件）。
	 * 纯空白结果（浏览器全选删除残留的 `<br>` 等）归一为空，让占位符恢复显示。
	 * @returns {void}
	 */
	function onInput() {
		if (disabled || composing) return
		const next = serializeDom()
		if (next === rawText) return
		const offsets = getOffsets()
		let start = 0
		while (start < rawText.length && start < next.length && rawText[start] === next[start]) start++
		let end = rawText.length
		let nextEnd = next.length
		while (end > start && nextEnd > start && rawText[end - 1] === next[nextEnd - 1]) { end--; nextEnd-- }
		const edit = editCodeText(next.slice(start, nextEnd), start, end, true)
		rawText = edit.text.trim() ? edit.text : ''
		rebuildDom()
		if (offsets.start === offsets.end && offsets.start === nextEnd) setSelection(edit.caret, edit.caret)
		else setSelection(offsets.start, offsets.end)
		commitChange()
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
		commitChange()
	}

	/**
	 * beforeinput：将 Enter 段落统一转为 `\n`。
	 * @param {InputEvent} event beforeinput 事件
	 * @returns {void}
	 */
	function onBeforeInput(event) {
		if (disabled || composing) return
		if (event.inputType === 'deleteContentBackward' || event.inputType === 'deleteContentForward') {
			let { start, end } = getOffsets()
			if (start === end)
				if (event.inputType === 'deleteContentBackward') start = Math.max(0, start - 1)
				else end = Math.min(rawText.length, end + 1)
			const edit = editCodeText('', start, end)
			if (edit.text !== rawText.slice(0, start) + rawText.slice(end)) {
				event.preventDefault()
				rawText = edit.text
				rebuildDom()
				setSelection(edit.caret, edit.caret)
				commitChange()
				return
			}
		}
		if (event.inputType === 'insertParagraph' || event.inputType === 'insertLineBreak') {
			event.preventDefault()
			const { start, end } = getOffsets()
			const block = codeBlocks(rawText).find(item => item.body === start + 1 && rawText[item.body] === '\n')
			if (start === end && block) {
				setSelection(start + 1, start + 1)
				return
			}
			setRangeText('\n', start, end, 'end')
			commitChange()
		}
	}

	/**
	 * 在光标/选区处插入粘贴文本：选中内容时粘贴 http(s) 链接自动转成 markdown 链接。
	 * @param {string} text 剪贴板纯文本
	 * @returns {void}
	 */
	function insertPastedText(text) {
		if (!text) return
		const { start, end } = getOffsets()
		const selected = rawText.slice(start, end)
		const url = text.trim()
		const isHttpUrl = /^https?:\/\/\S+$/i.test(url)
		const replacement = selected && start < end && isHttpUrl
			? `[${selected}](${/[\s()]/.test(url) ? `<${url}>` : url})`
			: text
		setRangeText(replacement, start, end, 'end')
		commitChange()
	}

	/**
	 * 粘贴：以纯文本插入（选中内容 + http(s) 链接 → markdown 链接）。
	 * @param {ClipboardEvent} event 粘贴事件
	 * @returns {void}
	 */
	function onPaste(event) {
		if (disabled) return
		event.preventDefault()
		insertPastedText(event.clipboardData?.getData('text/plain') ?? '')
	}

	/**
	 * 复制/剪切使用原始 Markdown（折叠正文与 chip 也保持原样）。
	 * @param {ClipboardEvent} event 剪贴板事件
	 * @returns {void}
	 */
	function onCopyOrCut(event) {
		const { start, end } = getOffsets()
		if (start === end || !event.clipboardData || (event.type === 'cut' && disabled)) return
		event.preventDefault()
		event.clipboardData.setData('text/plain', rawText.slice(start, end))
		if (event.type === 'cut') {
			setRangeText('', start, end)
			commitChange()
		}
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
	 * 获取（惰性创建）工具栏元素。浮动工具栏是 `position: fixed` 覆盖层，
	 * 用 `<nav>` 地标包裹，避免 axe `region` 规则判定「内容不在地标内」。
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
		void svgInliner(toolbar)
		const wrapper = document.createElement('nav')
		setElementI18n(wrapper, 'util.markdownRichInput.toolbar')
		wrapper.appendChild(toolbar)
		document.body.appendChild(wrapper)
		return toolbar
	}

	/**
	 * 隐藏工具栏。
	 * @returns {void}
	 */
	function hideToolbar() {
		if (toolbar) toolbar.classList.add('hidden')
	}

	/** 停靠工具栏动作列表（常显，比浮动工具栏更全）。 */
	const DOCKED_TOOLBAR_ACTIONS = ['headingLarge', 'headingMedium', 'headingSmall', 'bold', 'italic', 'strike', 'code', 'quote', 'listUl', 'listOl', 'link']

	/** @type {HTMLDivElement | null} */
	let dockedToolbar = null

	/**
	 * 获取（惰性创建）停靠工具栏，插入到输入元素之前。
	 * @returns {HTMLDivElement} 工具栏元素
	 */
	function getDockedToolbar() {
		if (dockedToolbar) return dockedToolbar
		dockedToolbar = document.createElement('div')
		dockedToolbar.className = 'fount-markdown-rich-input-docked-toolbar'
		dockedToolbar.setAttribute('role', 'toolbar')
		setElementI18n(dockedToolbar, 'util.markdownRichInput.dockedToolbar')
		for (const action of DOCKED_TOOLBAR_ACTIONS)
			dockedToolbar.appendChild(makeActionButton(action, 'fount-markdown-rich-input-toolbar-btn', () => {
				runAction(action)
				element.focus()
			}))
		void svgInliner(dockedToolbar)
		if (element.parentNode)
			element.parentNode.insertBefore(dockedToolbar, element)
		return dockedToolbar
	}

	/**
	 * 启用停靠工具栏（幂等）。
	 * @returns {void}
	 */
	function mountDockedToolbar() {
		getDockedToolbar().toggleAttribute('hidden', disabled)
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
	 * 光标所在行已有的 markdown 块级前缀（heading / 列表）。
	 * @param {string} line 行文本
	 * @returns {string | null} 前缀标记（如 `##` / `-`），无则为 null
	 */
	function matchLinePrefix(line) {
		const match = line.match(/^(#{1,6})\s+/) || line.match(/^([-*+])\s+/) || line.match(/^(\d+\.)\s+/)
		return match ? match[1] : null
	}

	/**
	 * 光标所在行切换 / 替换块级前缀（heading / 列表）。
	 * @param {string} prefix 要应用的前缀（含尾随空格，如 `## ` / `- `）
	 * @returns {void}
	 */
	function toggleBlockPrefix(prefix) {
		const { start, end } = getOffsets()
		const lineStart = rawText.lastIndexOf('\n', start - 1) + 1
		const lineEndRaw = rawText.indexOf('\n', end)
		const lineEnd = lineEndRaw === -1 ? rawText.length : lineEndRaw
		const line = rawText.slice(lineStart, lineEnd)
		const existing = matchLinePrefix(line)
		const inner = existing ? line.slice(existing.length).replace(/^\s+/, '') : line
		const replacement = existing === prefix.trim() ? inner : prefix + inner
		rawText = rawText.slice(0, lineStart) + replacement + rawText.slice(lineEnd)
		render()
		setSelection(lineStart, lineStart + replacement.length)
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
	}

	/**
	 * 在光标处粘贴剪贴板文本。
	 * @returns {void}
	 */
	function pasteFromClipboard() {
		void navigator.clipboard?.readText().then(insertPastedText)
	}

	/** 工具栏 / 右键菜单动作 → 执行器。 */
	const ACTION_RUNNERS = {
		/** @returns {void} 光标行切到一级标题。 */
		headingLarge: () => toggleBlockPrefix(BLOCK_PREFIX.headingLarge),
		/** @returns {void} 光标行切到二级标题。 */
		headingMedium: () => toggleBlockPrefix(BLOCK_PREFIX.headingMedium),
		/** @returns {void} 光标行切到三级标题。 */
		headingSmall: () => toggleBlockPrefix(BLOCK_PREFIX.headingSmall),
		/** @returns {void} 包裹/取消加粗语法。 */
		bold: () => toggleWrap(...WRAP_SYNTAX.bold),
		/** @returns {void} 包裹/取消斜体语法。 */
		italic: () => toggleWrap(...WRAP_SYNTAX.italic),
		/** @returns {void} 包裹/取消删除线语法。 */
		strike: () => toggleWrap(...WRAP_SYNTAX.strike),
		/** @returns {void} 包裹/取消行内代码语法。 */
		code: () => toggleWrap(...WRAP_SYNTAX.code),
		quote: quoteSelection,
		/** @returns {void} 光标行切到无序列表。 */
		listUl: () => toggleBlockPrefix(BLOCK_PREFIX.listUl),
		/** @returns {void} 光标行切到有序列表。 */
		listOl: () => toggleBlockPrefix(BLOCK_PREFIX.listOl),
		/** @returns {Promise<void>} 将选区包成链接。 */
		link: linkSelection,
		mention: insertMentionTrigger,
		copy: copySelection,
		cut: cutSelection,
		paste: pasteFromClipboard,
	}

	/**
	 * 执行工具栏 / 右键菜单动作，完成后提交内容变更（撤销历史 + input 事件）。
	 * @param {string} action 动作名
	 * @returns {Promise<void>} 完成
	 */
	async function runAction(action) {
		const runner = ACTION_RUNNERS[action]
		if (!runner) return
		await runner()
		commitChange()
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
		void svgInliner(contextMenu)
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
	 * 空态聚焦/点击时光标落到占位符前（可编辑零宽锚点上）。
	 * 先重建 DOM：浏览器编辑（select-all 删除等）可能已移除锚点/占位节点，
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
	element.addEventListener('keydown', onKeyDown)
	element.addEventListener('paste', onPaste)
	element.addEventListener('copy', onCopyOrCut)
	element.addEventListener('cut', onCopyOrCut)
	element.addEventListener('focus', placeCaretWhenEmpty)
	element.addEventListener('click', placeCaretWhenEmpty)
	document.addEventListener('selectionchange', updateToolbar)
	element.addEventListener('mouseup', updateToolbar)
	element.addEventListener('blur', () => {
		hideToolbar()
		setTimeout(closeContextMenu, 0)
	})
	element.addEventListener('contextmenu', showContextMenu)

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
	if (enableDockedToolbar) mountDockedToolbar()
	if (useRegisteredInlineTokens && !getRegisteredInlineTokens().length)
		void loadRegisteredMarkdownExtensions().then(() => {
			if (element.isConnected && getRegisteredInlineTokens().length) render()
		})

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
		 * 获取选区起点（原始文本偏移）。
		 * @returns {number} 起点偏移
		 */
		get selectionStart() { return getOffsets().start },
		/**
		 * 获取选区终点（原始文本偏移）。
		 * @returns {number} 终点偏移
		 */
		get selectionEnd() { return getOffsets().end },
		/**
		 * 设置行尾提示（幽灵补全）。
		 * @param {string|null} text 提示文本
		 * @returns {void}
		 */
		setSuffixHint,
		/**
		 * 当前有效的行尾提示文本。
		 * @returns {string} 提示文本
		 */
		get suffixHint() { return suffixHint.forRaw === rawText ? suffixHint.text : '' },
		/**
		 * 提交一次内容变更（写撤销历史并派发 input 事件），供外部程序化改写后复用。
		 * @returns {void}
		 */
		commit: commitChange,
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
		 * 切换空态占位符 i18n 键（模式相关文案随模式切换）。
		 * 空态占位 span 会立即重译；重建时按新键生成。
		 * @param {string|null} key i18n 键；null 回退到 `placeholder` 属性
		 * @returns {void}
		 */
		setPlaceholderI18n: key => {
			placeholderI18nKey = key
			const node = element.querySelector('.fount-markdown-rich-input-placeholder')
			if (!node) return
			if (key) setElementI18n(node, key)
			else {
				delete node.dataset.i18n
				node.textContent = element.getAttribute('placeholder') ?? ''
			}
		},
		/**
		 * 执行格式动作（heading/bold/italic/quote/code/list/link 等），供外部停靠工具栏复用。
		 * @param {string} action 动作名
		 * @returns {void}
		 */
		runAction,
		/**
		 * 销毁组件，恢复为纯文本节点。
		 * @returns {void}
		 */
		destroy: () => {
			renderVersion++
			highlightedBlocks.clear()
			element.removeEventListener('copy', onCopyOrCut)
			element.removeEventListener('cut', onCopyOrCut)
			document.removeEventListener('selectionchange', updateToolbar)
			hideToolbar()
			closeContextMenu()
			dockedToolbar?.remove()
			dockedToolbar = null
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
.fount-markdown-rich-input-fold {
	display: inline-flex;
	align-items: center;
	justify-content: center;
	width: 1.45em;
	height: 1.45em;
	vertical-align: -.2em;
	color: var(--text-muted);
	background: var(--surface);
	border: var(--border) solid var(--border-color);
	border-radius: var(--radius-selector);
	padding: 0;
	margin-inline-end: .4em;
	font: inherit;
	line-height: 1;
	cursor: pointer;
	transition: color var(--duration-hover) var(--ease-standard), background-color var(--duration-hover) var(--ease-standard), border-color var(--duration-hover) var(--ease-standard);
}
.fount-markdown-rich-input-fold .text-icon {
	width: 1em;
	height: 1em;
}
.fount-markdown-rich-input-fold:hover {
	color: var(--color-primary);
	background: var(--surface-hover);
	border-color: var(--border-strong);
}
.fount-markdown-rich-input-fold:focus-visible {
	outline: var(--border) solid var(--color-primary);
	outline-offset: .15em;
}
.fount-markdown-rich-input-fold[aria-expanded="false"] {
	color: var(--color-primary);
	background: color-mix(in srgb, var(--color-primary) 10%, var(--surface));
}
.fount-markdown-rich-input-fence {
	font-family: var(--font-code);
	font-size: .9em;
	color: var(--text-muted);
	background: var(--surface-sunken);
	border: var(--border) solid var(--border-color);
	border-radius: var(--radius-selector);
	padding: .08em .35em;
	box-decoration-break: clone;
	-webkit-box-decoration-break: clone;
}
.fount-markdown-rich-input-code-block {
	font-family: var(--font-code);
	color: var(--text-muted);
	background: var(--surface-sunken);
	border: var(--border) solid var(--border-color);
	padding: .12em .5em;
}
.fount-markdown-rich-input-code-token {
	color: var(--shiki-light);
}
[color-scheme*="dark"] .fount-markdown-rich-input-code-token {
	color: var(--shiki-dark);
}
.fount-markdown-rich-input.is-disabled {
	cursor: default;
}
.fount-markdown-rich-input-resizable {
	resize: vertical;
}
.fount-markdown-rich-input-placeholder {
	opacity: .55;
	white-space: pre-wrap;
	user-select: none;
	pointer-events: none;
}
.fount-markdown-rich-input-suffix-hint {
	opacity: .45;
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
.fount-markdown-rich-input-docked-toolbar {
	display: flex;
	flex-wrap: wrap;
	gap: 2px;
	align-items: center;
	padding: 4px 6px;
	border-radius: var(--radius-box);
	background: var(--color-base-100, #fff);
	border: var(--border) solid var(--color-base-300, #d0d7de);
}
.fount-markdown-rich-input-docked-toolbar[hidden] {
	display: none;
}
.fount-markdown-rich-input-docked-toolbar .fount-markdown-rich-input-toolbar-btn:hover {
	background: var(--color-base-200, #eef1f4);
}
`,
}))
