/**
 * Chrome DevTools 风格的日志渲染器。
 * 提供可交互式展开的对象树、级别颜色编码、内联参数显示。
 */

import { AnsiUp } from 'https://esm.sh/ansi_up'
import ansiRegex from 'https://esm.sh/ansi-regex'

const STYLES = /* css */ `
.log-container {
	font-family: 'Cascadia Code', 'Fira Code', ui-monospace, 'Consolas', monospace;
	font-size: 12.5px;
}
.log-row {
	display: flex;
	align-items: flex-start;
	justify-content: space-between;
	padding: 1px 8px 1px 6px;
	min-height: 20px;
	border-bottom: 1px solid color-mix(in oklch, var(--color-base-content, currentColor) 7%, transparent);
	gap: 8px;
	line-height: 1.5;
	position: relative;
}
.log-row:hover {
	background-color: color-mix(in oklch, var(--color-base-content, currentColor) 5%, transparent);
}
.log-level-warn {
	background-color: color-mix(in oklch, var(--color-warning, #f59e0b) 8%, transparent);
	border-left: 3px solid var(--color-warning, #f59e0b);
}
.log-level-warn:hover {
	background-color: color-mix(in oklch, var(--color-warning, #f59e0b) 14%, transparent);
}
.log-level-error {
	background-color: color-mix(in oklch, var(--color-error, #ef4444) 8%, transparent);
	border-left: 3px solid var(--color-error, #ef4444);
}
.log-level-error:hover {
	background-color: color-mix(in oklch, var(--color-error, #ef4444) 14%, transparent);
}
.log-level-info {
	border-left: 3px solid var(--color-info, #3b82f6);
}
.log-level-debug {
	opacity: 0.6;
}
.log-row.log-level-log,
.log-row.log-level-stdout {
	border-left: 3px solid transparent;
}
.log-content {
	flex: 1;
	min-width: 0;
	word-break: break-word;
	overflow-wrap: anywhere;
}
.log-args {
	display: inline;
}
.log-meta {
	flex-shrink: 0;
	display: flex;
	align-items: center;
}
.log-source-btn {
	font-size: 11px;
	opacity: 0.5;
	white-space: nowrap;
	background: none;
	border: none;
	padding: 0;
	font-family: inherit;
	color: inherit;
	cursor: default;
}
.log-source-btn.clickable {
	cursor: pointer;
}
.log-source-btn.clickable:hover {
	opacity: 0.9;
	text-decoration: underline;
}

/* 值颜色 */
.log-val-string { color: var(--color-success, #16a34a); }
.log-val-number { color: var(--color-info, #2563eb); }
.log-val-boolean { color: var(--color-warning, #d97706); }
.log-val-null, .log-val-undefined { opacity: 0.45; font-style: italic; }
.log-val-function { color: var(--color-secondary, #7c3aed); }
.log-val-symbol { color: var(--color-secondary, #7c3aed); }
.log-val-circular { opacity: 0.5; font-style: italic; }
.log-val-date { color: var(--color-info, #2563eb); }
.log-val-regexp { color: var(--color-error, #dc2626); }
.log-val-error-text { color: var(--color-error, #dc2626); }

/* 所有字符串参数统一走终端文本语义：换行、tab、ANSI/OSC 一致处理 */
.log-str {
	display: inline-block;
	max-width: 100%;
	vertical-align: top;
	box-sizing: border-box;
	white-space: pre-wrap;
	tab-size: 4;
	word-break: break-word;
}

/* 可展开节点 */
.log-node {
	display: inline-flex;
	flex-direction: column;
	vertical-align: top;
}
.log-node-header {
	display: inline-flex;
	align-items: center;
	gap: 1px;
	cursor: default;
}
.log-node-header.expandable {
	cursor: pointer;
}
.log-node-header.expandable:hover .log-toggle {
	opacity: 1;
}
.log-toggle {
	display: inline-block;
	width: 14px;
	text-align: center;
	font-size: 9px;
	opacity: 0.55;
	user-select: none;
	flex-shrink: 0;
	transition: transform 0.1s;
}
.log-toggle.open {
	transform: rotate(90deg);
}
.log-node-preview {
	display: inline;
}
.log-node-children {
	padding-left: 18px;
	display: flex;
	flex-direction: column;
}
.log-node-prop {
	display: flex;
	align-items: flex-start;
	gap: 2px;
	line-height: 1.5;
}
.log-node-key {
	opacity: 0.65;
	flex-shrink: 0;
}
.log-node-colon {
	opacity: 0.4;
	flex-shrink: 0;
}
.log-error-stack {
	white-space: pre-wrap;
	word-break: break-all;
	font-size: 11px;
	opacity: 0.65;
	margin: 0;
	padding: 0;
	font-family: inherit;
}

/* 工具栏 */
.log-toolbar {
	display: flex;
	align-items: center;
	gap: 6px;
	padding: 4px 6px;
	border-bottom: 1px solid color-mix(in oklch, var(--color-base-content, currentColor) 10%, transparent);
	flex-wrap: wrap;
}
.log-filter-input {
	flex: 1;
	min-width: 100px;
	font-family: inherit;
	font-size: 12px;
	padding: 2px 6px;
	border-radius: 4px;
	border: 1px solid color-mix(in oklch, var(--color-base-content, currentColor) 20%, transparent);
	background: transparent;
	color: inherit;
	outline: none;
}
.log-filter-input:focus {
	border-color: var(--color-info, #3b82f6);
}
.log-level-btns {
	display: flex;
	gap: 2px;
}
.log-level-btn {
	font-size: 11px;
	padding: 1px 7px;
	border-radius: 3px;
	border: 1px solid color-mix(in oklch, var(--color-base-content, currentColor) 20%, transparent);
	background: transparent;
	cursor: pointer;
	opacity: 0.65;
	color: inherit;
	font-family: inherit;
}
.log-level-btn:hover { opacity: 0.9; }
.log-level-btn.active {
	opacity: 1;
	background: color-mix(in oklch, var(--color-base-content, currentColor) 12%, transparent);
	font-weight: 600;
}
.log-level-btn[data-lvl="warn"] { color: var(--color-warning, #d97706); }
.log-level-btn[data-lvl="error"] { color: var(--color-error, #dc2626); }
.log-clear-btn {
	font-size: 11px;
	padding: 1px 7px;
	border-radius: 3px;
	border: 1px solid color-mix(in oklch, var(--color-base-content, currentColor) 20%, transparent);
	background: transparent;
	cursor: pointer;
	opacity: 0.65;
	color: inherit;
	font-family: inherit;
}
.log-clear-btn:hover { opacity: 1; }
`

let stylesInjected = false
const ansiUp = new AnsiUp()
const ansiCtrlRegex = ansiRegex()
const OSC8_REGEX = /\u001B\]8;;([^\u0007\u001B]*)(?:\u0007|\u001B\\)([\s\S]*?)\u001B\]8;;(?:\u0007|\u001B\\)/g
const OSC8_C1_REGEX = /\u009D8;;([^\u0007\u001B]*)(?:\u0007|\u001B\\)([\s\S]*?)\u009D8;;(?:\u0007|\u001B\\)/g

/**
 * 仅剥离“设置标题”相关 OSC 序列（0/2）。
 * @param {string} text
 * @returns {string}
 */
function stripWindowTitleSequences(text) {
	return String(text || '')
		.replace(/\u001B\](?:0|2);[\s\S]*?(?:\u0007|\u001B\\)/g, '')
		.replace(/\u009D(?:0|2);[\s\S]*?(?:\u0007|\u001B\\)/g, '')
}

/**
 * 转义 HTML 属性文本。
 * @param {string} text
 * @returns {string}
 */
function escapeHtmlAttr(text) {
	return String(text || '')
		.replaceAll('&', '&amp;')
		.replaceAll('"', '&quot;')
		.replaceAll('<', '&lt;')
		.replaceAll('>', '&gt;')
}

/**
 * 将 OSC8 超链接序列替换为占位符，返回占位符映射用于后续回填。
 * @param {string} text
 * @returns {{ textWithPlaceholders: string, placeholders: Array<{token: string, html: string}> }}
 */
function extractOsc8Links(text) {
	let index = 0
	const placeholders = []
	const replaceLink = (_full, href, label) => {
		const token = `__OSC8_LINK_${index++}__`
		const labelHtml = ansiUp.ansi_to_html(String(label || ''))
		const hrefAttr = escapeHtmlAttr(href)
		placeholders.push({
			token,
			html: `<a href="${hrefAttr}" target="_blank" rel="noopener noreferrer" style="color:inherit">${labelHtml || hrefAttr}</a>`,
		})
		return token
	}
	const textWithPlaceholders = String(text || '')
		.replace(OSC8_REGEX, replaceLink)
		.replace(OSC8_C1_REGEX, replaceLink)
	return { textWithPlaceholders, placeholders }
}

/**
 * 提取 ANSI 日志的可见文本，用于“空行隐藏”判断。
 * @param {string} text
 * @returns {string}
 */
function extractVisibleText(text) {
	const noTitle = stripWindowTitleSequences(text)
	const noOsc8 = noTitle
		.replace(OSC8_REGEX, (_full, _href, label) => String(label || ''))
		.replace(OSC8_C1_REGEX, (_full, _href, label) => String(label || ''))
	const noAnsi = noOsc8.replace(ansiCtrlRegex, '')
	const noCtrl = noAnsi.replace(/[\u0000-\u0008\u000B-\u001F\u007F]/g, '')
	return noCtrl.trim()
}

/**
 * 将 ANSI 文本安全转换为 HTML。
 * @param {string} text
 * @returns {string}
 */
function ansiTextToHtml(text) {
	const cleaned = stripWindowTitleSequences(text)
	const { textWithPlaceholders, placeholders } = extractOsc8Links(cleaned)
	let html = ansiUp.ansi_to_html(textWithPlaceholders)
	for (const { token, html: linkHtml } of placeholders)
		html = html.replaceAll(token, linkHtml)
	return html
}

/**
 * 将任意字符串渲染为日志节点（纯文本与含 ANSI/OSC 走同一管道）。
 * @param {string} text
 * @param {object} [opts]
 * @param {boolean} [opts.quoted=false] - 是否在展示时包裹双引号。
 * @param {string} [opts.className='log-str'] - 额外类名（如 log-val-string）。
 * @returns {HTMLElement}
 */
function renderLogStringNode(text, { quoted = false, className = 'log-str' } = {}) {
	const wrapper = document.createElement('span')
	wrapper.className = className
	const html = ansiTextToHtml(String(text || ''))
	if (quoted)
		wrapper.innerHTML = `"${html}"`
	else
		wrapper.innerHTML = html
	return wrapper
}

function injectStyles() {
	if (stylesInjected) return
	stylesInjected = true
	const style = document.createElement('style')
	style.textContent = STYLES
	document.head.appendChild(style)
}

/**
 * 获取节点的单行预览文本。
 * @param {object} node - 序列化节点。
 * @param {number} [maxLen=50] - 最大预览长度。
 * @returns {string}
 */
function getNodePreview(node, maxLen = 50) {
	if (!node) return 'undefined'
	switch (node.kind) {
		case 'string': {
			const s = String(node.value)
			const truncated = s.length > maxLen ? s.slice(0, maxLen) + '…' : s
			return `"${truncated}"`
		}
		case 'number':
		case 'boolean': return String(node.value)
		case 'bigint': return `${node.value}n`
		case 'null': return 'null'
		case 'undefined': return 'undefined'
		case 'function': return `ƒ ${node.value}()`
		case 'symbol': return String(node.value)
		case 'circular': return '[Circular ↑]'
		case 'Date': return node.value
		case 'RegExp': return node.value
		case 'Error': return `${node.name || 'Error'}: ${node.message || ''}`
		case 'array': {
			const count = node.items?.length || 0
			if (count === 0) return '[]'
			const preview = (node.items || []).slice(0, 4).map(i => getNodePreview(i, 15)).join(', ')
			return `(${count})\u00a0[${preview}${count > 4 ? ', …' : ''}]`
		}
		case 'Map': {
			const count = node.items?.length || 0
			return `Map(${count})\u00a0{${count > 0 ? '…' : ''}}`
		}
		case 'Set': {
			const count = node.items?.length || 0
			return `Set(${count})\u00a0{${count > 0 ? '…' : ''}}`
		}
		default: {
			const entries = node.entries || []
			const prefix = node.kind && node.kind !== 'object' ? `${node.kind}\u00a0` : ''
			if (entries.length === 0) return `${prefix}{}`
			const preview = entries.slice(0, 4).map(e => `${e.key}:\u00a0${getNodePreview(e.value, 12)}`).join(',\u00a0')
			return `${prefix}{${preview}${entries.length > 4 ? ',\u00a0…' : ''}}`
		}
	}
}

/**
 * 构建属性子列表 DOM。
 * @param {object} node - 序列化节点。
 * @param {number} depth - 当前深度。
 * @returns {HTMLElement}
 */
function buildChildren(node, depth) {
	const container = document.createElement('div')
	container.className = 'log-node-children'

	if (node.kind === 'array') {
		for (let i = 0; i < (node.items || []).length; i++) {
			const prop = makeProp(String(i), buildArgNode(node.items[i], depth))
			container.appendChild(prop)
		}
	}
	else if (node.kind === 'Set') {
		for (let i = 0; i < (node.items || []).length; i++)
			container.appendChild(makeProp(String(i), buildArgNode(node.items[i], depth)))
	}
	else if (node.kind === 'Map') {
		for (const item of (node.items || [])) {
			const prop = document.createElement('div')
			prop.className = 'log-node-prop'
			prop.appendChild(buildArgNode(item.key, depth))
			const arrow = document.createElement('span')
			arrow.className = 'log-node-colon'
			arrow.textContent = '\u00a0=>\u00a0'
			prop.appendChild(arrow)
			prop.appendChild(buildArgNode(item.value, depth))
			container.appendChild(prop)
		}
	}
	else {
		// object / Error / custom class
		for (const entry of (node.entries || []))
			container.appendChild(makeProp(String(entry.key), buildArgNode(entry.value, depth)))
		// Error: also show stack
		if (node.kind === 'Error' && node.stack) {
			const stackRow = document.createElement('div')
			stackRow.className = 'log-node-prop'
			const pre = document.createElement('pre')
			pre.className = 'log-error-stack'
			pre.textContent = node.stack
			stackRow.appendChild(pre)
			container.appendChild(stackRow)
		}
	}

	return container
}

/**
 * 创建属性行（key: value）。
 * @param {string} key
 * @param {HTMLElement} valueEl
 * @returns {HTMLElement}
 */
function makeProp(key, valueEl) {
	const prop = document.createElement('div')
	prop.className = 'log-node-prop'
	const keyEl = document.createElement('span')
	keyEl.className = 'log-node-key'
	keyEl.textContent = key
	const colon = document.createElement('span')
	colon.className = 'log-node-colon'
	colon.textContent = ':\u00a0'
	prop.appendChild(keyEl)
	prop.appendChild(colon)
	prop.appendChild(valueEl)
	return prop
}

/**
 * 构建可展开节点。
 * @param {object} node
 * @param {number} depth
 * @returns {HTMLElement}
 */
function buildExpandableNode(node, depth) {
	const hasChildren = (() => {
		switch (node.kind) {
			case 'array': return (node.items?.length || 0) > 0
			case 'Map':
			case 'Set': return (node.items?.length || 0) > 0
			case 'Error': return true
			default: return (node.entries?.length || 0) > 0
		}
	})()

	const el = document.createElement('span')
	el.className = 'log-node'

	const header = document.createElement('span')
	header.className = `log-node-header${hasChildren && depth < 8 ? ' expandable' : ''}`

	const toggle = document.createElement('span')
	toggle.className = 'log-toggle'
	toggle.textContent = hasChildren ? '▶' : ''

	const preview = document.createElement('span')
	preview.className = node.kind === 'Error' ? 'log-node-preview log-val-error-text' : 'log-node-preview'
	preview.textContent = getNodePreview(node)

	header.appendChild(toggle)
	header.appendChild(preview)
	el.appendChild(header)

	if (hasChildren && depth < 8) {
		let expanded = false
		let childrenEl = null

		const toggleExpand = (e) => {
			e?.stopPropagation()
			expanded = !expanded
			toggle.classList.toggle('open', expanded)
			if (expanded) {
				if (!childrenEl) childrenEl = buildChildren(node, depth + 1)
				el.appendChild(childrenEl)
			} else if (childrenEl) {
				el.removeChild(childrenEl)
			}
		}

		header.addEventListener('click', toggleExpand)
	}

	return el
}

/**
 * 从序列化节点构建交互式 DOM 元素。
 * @param {object} node - 序列化节点。
 * @param {number} [depth=0] - 嵌套深度。
 * @param {boolean} [topLevel=false] - 顶层字符串不加引号。
 * @returns {HTMLElement}
 */
function buildArgNode(node, depth = 0, topLevel = false) {
	if (!node) return span('undefined', 'log-val-undefined')

	switch (node.kind) {
		case 'string': {
			const value = String(node.value)
			return renderLogStringNode(value, {
				quoted: !topLevel,
				className: topLevel ? 'log-str' : 'log-str log-val-string',
			})
		}
		case 'number': return span(String(node.value), 'log-val-number')
		case 'boolean': return span(String(node.value), 'log-val-boolean')
		case 'bigint': return span(`${node.value}n`, 'log-val-number')
		case 'symbol': return span(String(node.value), 'log-val-symbol')
		case 'function': return span(`ƒ\u00a0${node.value}()`, 'log-val-function')
		case 'null': return span('null', 'log-val-null')
		case 'undefined': return span('undefined', 'log-val-undefined')
		case 'circular': return span('[Circular\u00a0↑]', 'log-val-circular')
		case 'Date': return span(node.value, 'log-val-date')
		case 'RegExp': return span(node.value, 'log-val-regexp')
		default: return buildExpandableNode(node, depth)
	}
}

/**
 * 创建带类名的 span。
 * @param {string} text
 * @param {string} className
 * @returns {HTMLSpanElement}
 */
function span(text, className) {
	const el = document.createElement('span')
	el.className = className
	el.textContent = text
	return el
}

/**
 * 处理 printf 风格的格式字符串，返回 fragment 和剩余未消费参数。
 * @param {string} format - 格式字符串。
 * @param {object[]} rest - 后续参数节点。
 * @returns {{ fragment: DocumentFragment, remaining: object[] }}
 */
function buildFormatString(format, rest) {
	const frag = document.createDocumentFragment()
	let argIdx = 0
	let lastIdx = 0
	const re = /%(s|d|i|f|o|O|c|%)/g
	let m

	while ((m = re.exec(format)) !== null) {
		const before = format.slice(lastIdx, m.index)
		if (before) frag.appendChild(renderLogStringNode(before, { quoted: false, className: 'log-str' }))
		lastIdx = re.lastIndex

		if (m[0] === '%%') { frag.appendChild(document.createTextNode('%')); continue }
		if (argIdx >= rest.length) { frag.appendChild(document.createTextNode(m[0])); continue }

		const arg = rest[argIdx++]
		switch (m[1]) {
			case 'c': break  // CSS style directive — ignored
			case 's':
				if (arg?.kind === 'string')
					frag.appendChild(renderLogStringNode(String(arg.value), { quoted: false, className: 'log-str' }))
				else
					frag.appendChild(document.createTextNode(getNodePreview(arg)))
				break
			case 'd':
			case 'i': {
				const n = arg?.kind === 'number' ? parseInt(arg.value) : NaN
				frag.appendChild(document.createTextNode(String(isNaN(n) ? 'NaN' : n)))
				break
			}
			case 'f': {
				const n = arg?.kind === 'number' ? parseFloat(arg.value) : NaN
				frag.appendChild(document.createTextNode(String(isNaN(n) ? 'NaN' : n)))
				break
			}
			case 'o':
			case 'O': frag.appendChild(buildArgNode(arg, 0)); break
		}
	}

	const after = format.slice(lastIdx)
	if (after) frag.appendChild(renderLogStringNode(after, { quoted: false, className: 'log-str' }))

	return { fragment: frag, remaining: rest.slice(argIdx) }
}

/**
 * 构建参数内容容器。
 * @param {object[]} args - 序列化参数数组。
 * @param {string} html - 预格式化 HTML（备用/流输出）。
 * @param {string} text - 纯文本日志。
 * @param {string} level - 日志级别。
 * @returns {HTMLElement}
 */
function buildArgsContent(args, html, text, level) {
	const container = document.createElement('span')
	container.className = 'log-args'

	// 流输出：优先使用 text 重新做 ANSI 解析，避免后端未覆盖的控制码污染 UI
	if (level === 'stdout' || level === 'stderr') {
		const sourceText = text || ''
		const visibleText = extractVisibleText(sourceText)
		if (!visibleText) {
			container.dataset.emptyStream = '1'
			return container
		}
		if (sourceText)
			container.appendChild(renderLogStringNode(sourceText, { quoted: false, className: 'log-str' }))
		else {
			const wrap = document.createElement('span')
			wrap.className = 'log-str'
			wrap.innerHTML = html || ''
			container.appendChild(wrap)
		}
		return container
	}

	if (!args?.length) {
		if (html) {
			const wrap = document.createElement('span')
			wrap.className = 'log-str'
			wrap.innerHTML = html
			container.appendChild(wrap)
		}
		return container
	}

	const first = args[0]
	const isFormatStr = first?.kind === 'string' && /%(s|d|i|f|o|O|c|%)/.test(first.value)

	if (isFormatStr && args.length > 1) {
		const { fragment, remaining } = buildFormatString(String(first.value), args.slice(1))
		container.appendChild(fragment)
		for (const arg of remaining) {
			container.appendChild(document.createTextNode(' '))
			container.appendChild(buildArgNode(arg, 0))
		}
	} else {
		for (let i = 0; i < args.length; i++) {
			if (i > 0) container.appendChild(document.createTextNode(' '))
			container.appendChild(buildArgNode(args[i], 0, true))
		}
	}

	return container
}

/** 级别 → CSS 类名映射 */
const LEVEL_CLASS = {
	log: 'log-level-log',
	info: 'log-level-info',
	warn: 'log-level-warn',
	error: 'log-level-error',
	debug: 'log-level-debug',
	trace: 'log-level-debug',
	stdout: 'log-level-stdout',
	stderr: 'log-level-error',
}

/**
 * 渲染单条日志条目（Chrome DevTools 风格）。
 * @param {object} entry - 日志条目。
 * @param {object} [opts]
 * @param {boolean} [opts.canOpenEditor]
 * @param {function} [opts.onOpenSource]
 * @returns {HTMLElement}
 */
export function renderLogItem(entry, { canOpenEditor = false, onOpenSource } = {}) {
	injectStyles()

	const level = entry.level || 'log'
	const levelClass = LEVEL_CLASS[level] || 'log-level-log'

	const row = document.createElement('div')
	row.className = `log-row ${levelClass}`

	// 内容区
	const content = document.createElement('div')
	content.className = 'log-content'
	const argsContent = buildArgsContent(entry.args, entry.html, entry.text, level)
	if ((level === 'stdout' || level === 'stderr') && argsContent.dataset.emptyStream === '1') {
		const emptyRow = document.createElement('div')
		emptyRow.style.display = 'none'
		return emptyRow
	}
	content.appendChild(argsContent)
	row.appendChild(content)

	// 元信息区（来源位置）
	if (entry.callsite?.filePath) {
		const meta = document.createElement('div')
		meta.className = 'log-meta'
		const btn = document.createElement('button')
		const canClick = Boolean(canOpenEditor && onOpenSource)
		btn.className = `log-source-btn${canClick ? ' clickable' : ''}`
		const fileName = entry.callsite.filePath.split(/[/\\]/).pop()
		btn.textContent = `${fileName}:${entry.callsite.line}`
		btn.title = `${entry.callsite.filePath}:${entry.callsite.line}:${entry.callsite.column}`
		if (canClick)
			btn.addEventListener('click', () => onOpenSource(entry.callsite))
		meta.appendChild(btn)
		row.appendChild(meta)
	}

	return row
}

/**
 * 创建日志工具栏并绑定过滤逻辑。
 * @param {object} opts
 * @param {HTMLElement} opts.container - 日志列表容器。
 * @param {function} opts.onClear - 清空回调。
 * @param {function} opts.onFilter - 过滤回调 (filterText, levelFilter)。
 * @returns {HTMLElement} 工具栏元素。
 */
export function createLogToolbar({ container: _container, onClear, onFilter }) {
	injectStyles()

	const toolbar = document.createElement('div')
	toolbar.className = 'log-toolbar'

	// 清空按钮
	const clearBtn = document.createElement('button')
	clearBtn.className = 'log-clear-btn'
	clearBtn.textContent = '🚫 Clear'
	clearBtn.addEventListener('click', () => onClear?.())
	toolbar.appendChild(clearBtn)

	// 过滤输入框
	const filterInput = document.createElement('input')
	filterInput.type = 'text'
	filterInput.className = 'log-filter-input'
	filterInput.placeholder = 'Filter…'
	toolbar.appendChild(filterInput)

	// 级别过滤按钮
	const levelBtns = document.createElement('div')
	levelBtns.className = 'log-level-btns'

	let activeLevel = 'all'
	const levels = [
		{ id: 'all', label: 'All' },
		{ id: 'info', label: 'Info' },
		{ id: 'warn', label: 'Warn' },
		{ id: 'error', label: 'Err' },
	]

	const btnEls = {}
	for (const { id, label } of levels) {
		const btn = document.createElement('button')
		btn.className = `log-level-btn${id === 'all' ? ' active' : ''}`
		btn.dataset.lvl = id
		btn.textContent = label
		btn.addEventListener('click', () => {
			activeLevel = id
			for (const [k, el] of Object.entries(btnEls))
				el.classList.toggle('active', k === id)
			onFilter?.(filterInput.value, activeLevel)
		})
		btnEls[id] = btn
		levelBtns.appendChild(btn)
	}
	toolbar.appendChild(levelBtns)

	filterInput.addEventListener('input', () => onFilter?.(filterInput.value, activeLevel))

	return toolbar
}

/**
 * 判断条目是否通过过滤条件。
 * @param {object} entry
 * @param {string} filterText
 * @param {string} levelFilter
 * @returns {boolean}
 */
export function entryMatchesFilter(entry, filterText, levelFilter) {
	const level = entry.level || 'log'
	if ((level === 'stdout' || level === 'stderr') && !extractVisibleText(entry.text || ''))
		return false

	if (levelFilter !== 'all') {
		const levelGroup = {
			log: ['log', 'stdout', 'debug', 'trace'],
			info: ['info'],
			warn: ['warn'],
			error: ['error', 'stderr'],
		}
		const group = levelGroup[levelFilter] || [levelFilter]
		if (!group.includes(level)) return false
	}

	if (filterText) {
		const needle = filterText.toLowerCase()
		const haystack = (entry.text || '').toLowerCase()
		if (!haystack.includes(needle)) return false
	}

	return true
}
