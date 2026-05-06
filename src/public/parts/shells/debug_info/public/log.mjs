/**
 * Chrome DevTools 风格的日志渲染器。
 * 提供可交互式展开的对象树、级别颜色编码、内联参数显示。
 */

import { ansiToHtml } from 'https://esm.sh/@steve02081504/ansi2html'

/** 折叠行「单行预览」中复合类型最多再向下展开几层 */
const SNAPSHOT_PREVIEW_NEST_MAX = 5

/**
 * 惰性截断节点在摘要/行内的占位文本；普通 Object 与「预览嵌套达上限」时的 `{…}` 一致，避免首层 `[Object]`、内层 `{…}` 混用。
 * @param {{ label?: string }} node - 序列化节点（至少含可选 `label`）。
 * @returns {string} 用于折叠预览的占位字符串。
 */
function truncatedPlaceholderText(node) {
	const label = node.label || ''
	if (label === 'Object') return '{…}'
	return label ? `[${label}]` : '{…}'
}

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
.log-expandable-truncated {
	cursor: pointer;
	text-decoration: underline dotted;
	opacity: 0.9;
}
.log-expandable-truncated:hover { opacity: 1; }
.log-val-date { color: var(--color-info, #2563eb); }
.log-val-regexp { color: var(--color-error, #dc2626); }
.log-val-error-text { color: var(--color-error, #dc2626); }

/* 所有字符串参数统一走终端文本语义：换行、tab、ANSI/OSC 一致处理 */
.log-str {
	display: inline-block;
	max-width: 100%;
	vertical-align: top;
	box-sizing: border-box;
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
.log-level-btn[data-lvl="log"] { color: color-mix(in oklch, var(--color-base-content, currentColor) 88%, transparent); }
.log-level-btn[data-lvl="info"] { color: var(--color-info, #3b82f6); }
.log-level-btn[data-lvl="warn"] { color: var(--color-warning, #d97706); }
.log-level-btn[data-lvl="error"] { color: var(--color-error, #dc2626); }
.log-level-btn[data-lvl="debug"] { color: color-mix(in oklch, var(--color-base-content, currentColor) 55%, transparent); }
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

/**
 * 将当前快照树中所有 `truncated` 节点并行拉取并就地替换（非递归，新产生的 truncated 留待下次点击）。
 * @param {object} node - 序列化树根节点。
 * @param {(ref: string) => Promise<unknown>} requestExpandRef - 按引用 ID 向服务端请求展开的异步函数。
 */
async function resolveAllTruncated(node, requestExpandRef) {
	/** @type {Map<string, object[]>} */
	const refToNodes = new Map()
	/**
	 * 递归遍历快照树，收集所有待展开的 `truncated` 节点。
	 * @param {unknown} n - 当前子节点。
	 * @returns {void}
	 */
	function collect(n) {
		if (!n || typeof n !== 'object') return
		const o = /** @type {Record<string, unknown>} */ n
		if (o.kind === 'truncated' && o.ref) {
			const r = String(o.ref)
			let list = refToNodes.get(r)
			if (!list) {
				list = []
				refToNodes.set(r, list)
			}
			list.push(o)
			return
		}
		if (Array.isArray(o.entries))
			for (const e of o.entries)
				collect(e?.value)
		if (Array.isArray(o.items)) 
			for (const i of o.items) {
				collect(i?.key)
				collect(i?.value ?? i)
			}
		
	}
	collect(node)
	if (refToNodes.size === 0) return

	await Promise.all([...refToNodes.entries()].map(async ([ref, nodes]) => {
		try {
			const result = await requestExpandRef(ref)
			for (const n of nodes) {
				for (const k of Object.keys(n))
					delete n[k]
				Object.assign(n, result)
			}
		} catch {
			for (const n of nodes)
				n.ref = ''
		}
	}))
}

/**
 * 将任意字符串渲染为日志节点（纯文本与含 ANSI/OSC 走同一管道）。
 * @param {string} text - 原始文本。
 * @param {object} [opts] - 展示样式选项。
 * @param {boolean} [opts.quoted=false] - 是否在展示时包裹双引号。
 * @param {string} [opts.className='log-str'] - 额外类名（如 log-val-string）。
 * @returns {HTMLElement} 包裹 ANSI 转 HTML 后的 span。
 */
function renderLogStringNode(text, { quoted = false, className = 'log-str' } = {}) {
	const wrapper = document.createElement('span')
	wrapper.className = className
	const html = ansiToHtml(String(text || ''))
	if (quoted)
		wrapper.innerHTML = `"${html}"`
	else
		wrapper.innerHTML = html
	return wrapper
}

/**
 * 注入日志面板样式（幂等，仅首次插入 `<style>`）。
 * @returns {void}
 */
function injectStyles() {
	if (stylesInjected) return
	stylesInjected = true
	const style = document.createElement('style')
	style.textContent = STYLES
	document.head.appendChild(style)
}

/**
 * 获取节点的单行预览文本（嵌套层数有上限，与序列化深度一致，避免某一行摘要比其它行「多出几层」）。
 * @param {object} node - 序列化节点。
 * @param {number} [maxLen=50] - 最大预览长度。
 * @param {number} [nestDepth=0] - 当前在摘要树中的嵌套深度。
 * @returns {string} 单行预览字符串。
 */
function getNodePreview(node, maxLen = 50, nestDepth = 0) {
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
		case 'truncated': return truncatedPlaceholderText(node)
		case 'Date': return node.value
		case 'RegExp': return node.value
		case 'Error': return `${node.name || 'Error'}: ${node.message || ''}`
		case 'array': {
			const count = node.items?.length || 0
			if (count === 0) return '[]'
			if (nestDepth >= SNAPSHOT_PREVIEW_NEST_MAX)
				return `(${count})\u00a0[…]`
			const preview = (node.items || []).slice(0, 4).map(i => getNodePreview(i, 15, nestDepth + 1)).join(', ')
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
			if (nestDepth >= SNAPSHOT_PREVIEW_NEST_MAX)
				return `${prefix}{…}`
			const preview = entries.slice(0, 4).map(e => `${e.key}:\u00a0${getNodePreview(e.value, 12, nestDepth + 1)}`).join(',\u00a0')
			return `${prefix}{${preview}${entries.length > 4 ? ',\u00a0…' : ''}}`
		}
	}
}

/**
 * 构建复合类型（数组 / Map / Set / 对象 / Error）展开后的子列表 DOM。
 * @param {object} node - 序列化节点。
 * @param {number} depth - 当前嵌套深度。
 * @param {{ requestExpandRef?: (ref: string) => Promise<unknown> }} [renderOpts] - 渲染选项（懒加载展开引用）。
 * @returns {HTMLDivElement} 子节点容器。
 */
function buildChildren(node, depth, renderOpts = {}) {
	const container = document.createElement('div')
	container.className = 'log-node-children'

	if (node.kind === 'array') 
		for (let i = 0; i < (node.items || []).length; i++) {
			const prop = makeProp(String(i), buildArgNode(node.items[i], depth, false, renderOpts))
			container.appendChild(prop)
		}
	
	else if (node.kind === 'Set') 
		for (let i = 0; i < (node.items || []).length; i++)
			container.appendChild(makeProp(String(i), buildArgNode(node.items[i], depth, false, renderOpts)))
	
	else if (node.kind === 'Map') 
		for (const item of node.items || []) {
			const prop = document.createElement('div')
			prop.className = 'log-node-prop'
			prop.appendChild(buildArgNode(item.key, depth, false, renderOpts))
			const arrow = document.createElement('span')
			arrow.className = 'log-node-colon'
			arrow.textContent = '\u00a0=>\u00a0'
			prop.appendChild(arrow)
			prop.appendChild(buildArgNode(item.value, depth, false, renderOpts))
			container.appendChild(prop)
		}
	
	else {
		// object / Error / custom class
		for (const entry of node.entries || [])
			container.appendChild(makeProp(String(entry.key), buildArgNode(entry.value, depth, false, renderOpts)))
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
 * @param {string} key - 属性名或索引。
 * @param {HTMLElement} valueEl - 值所在的 DOM 节点。
 * @returns {HTMLDivElement} 一整行 prop。
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
 * @param {object} node - 序列化复合节点。
 * @param {number} depth - 当前嵌套深度。
 * @param {{ requestExpandRef?: (ref: string) => Promise<unknown> }} [renderOpts] - 首次展开时解析 truncated 用。
 * @returns {HTMLSpanElement} 含预览与可选子树的节点包装。
 */
function buildExpandableNode(node, depth, renderOpts = {}) {
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
	header.className = `log-node-header${hasChildren ? ' expandable' : ''}`

	const toggle = document.createElement('span')
	toggle.className = 'log-toggle'
	toggle.textContent = hasChildren ? '▶' : ''

	const preview = document.createElement('span')
	preview.className = node.kind === 'Error' ? 'log-node-preview log-val-error-text' : 'log-node-preview'
	preview.textContent = getNodePreview(node)

	header.appendChild(toggle)
	header.appendChild(preview)
	el.appendChild(header)

	if (hasChildren) {
		let expanded = false
		let childrenEl = null
		let loading = false

		/**
		 * 展开或收起子树；首次展开时按需拉取 truncated。
		 * @param {MouseEvent} [e] - 头部点击事件。
		 * @returns {Promise<void>}
		 */
		const toggleExpand = async (e) => {
			e?.stopPropagation()
			if (loading) return
			if (childrenEl) {
				expanded = !expanded
				toggle.classList.toggle('open', expanded)
				if (expanded) el.appendChild(childrenEl)
				else el.removeChild(childrenEl)
				return
			}
			expanded = true
			toggle.classList.add('open')
			const expandRef = renderOpts.requestExpandRef
			if (typeof expandRef === 'function') {
				loading = true
				const loadingEl = document.createElement('span')
				loadingEl.className = 'log-node-children'
				loadingEl.textContent = '…'
				el.appendChild(loadingEl)
				try {
					await resolveAllTruncated(node, expandRef)
				} finally {
					loading = false
					if (loadingEl.parentNode) el.removeChild(loadingEl)
				}
			}
			childrenEl = buildChildren(node, depth + 1, renderOpts)
			el.appendChild(childrenEl)
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
 * @param {{ requestExpandRef?: (ref: string) => Promise<unknown> }} [renderOpts] - truncated 点击展开等选项。
 * @returns {HTMLElement} 对应类型的展示节点。
 */
function buildArgNode(node, depth = 0, topLevel = false, renderOpts = {}) {
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
		case 'truncated': {
			const wrap = document.createElement('span')
			wrap.className = 'log-val-truncated'
			wrap.textContent = truncatedPlaceholderText(node)
			if (node.ref) wrap.title = String(node.ref)
			const fn = renderOpts.requestExpandRef
			if (node.ref && typeof fn === 'function') {
				wrap.classList.add('log-expandable-truncated')
				wrap.addEventListener('click', async (e) => {
					e.stopPropagation()
					if (wrap.dataset.loading === '1') return
					wrap.dataset.loading = '1'
					const prev = wrap.textContent
					wrap.textContent = '…'
					try {
						const result = await fn(String(node.ref))
						for (const k of Object.keys(node)) delete node[k]
						Object.assign(node, result)
						wrap.replaceWith(buildArgNode(node, depth, topLevel, renderOpts))
					} catch {
						wrap.textContent = prev
						wrap.dataset.loading = '0'
					}
				})
			}
			return wrap
		}
		default: return buildExpandableNode(node, depth, renderOpts)
	}
}

/**
 * 创建带类名的 span。
 * @param {string} text - 文本内容。
 * @param {string} className - CSS 类名。
 * @returns {HTMLSpanElement} 仅含文本的 span。
 */
function span(text, className) {
	const el = document.createElement('span')
	el.className = className
	el.textContent = text
	return el
}

/**
 * 根据 `@steve02081504/virtual-console` 下发的结构化片段构建 DOM（含 `%c` 样式）。
 * @param {object[]} segments - `console.log` 等方法的结构化片段序列。
 * @param {{ requestExpandRef?: (ref: string) => Promise<unknown> }} [renderOpts] - 值节点渲染选项。
 * @returns {DocumentFragment} 拼接后的片段。
 */
function buildFragmentFromSegments(segments, renderOpts = {}) {
	const frag = document.createDocumentFragment()
	for (const seg of segments) 
		switch (seg.kind) {
			case 'text': {
				const inner = renderLogStringNode(seg.text, { quoted: false, className: 'log-str' })
				if (seg.css) {
					const wrap = document.createElement('span')
					wrap.style.cssText = seg.css
					wrap.appendChild(inner)
					frag.appendChild(wrap)
				}
				else frag.appendChild(inner)
				break
			}
			case 'value':
				if (seg.css) {
					const wrap = document.createElement('span')
					wrap.style.cssText = seg.css
					wrap.appendChild(buildArgNode(seg.snapshot, 0, false, renderOpts))
					frag.appendChild(wrap)
				}
				else frag.appendChild(buildArgNode(seg.snapshot, 0, false, renderOpts))
				break
			case 'values':
				for (let i = 0; i < (seg.items?.length || 0); i++) {
					if (i > 0) frag.appendChild(document.createTextNode(' '))
					const item = seg.items[i]
					frag.appendChild(buildArgNode(item.snapshot, 0, true, renderOpts))
				}
				break
			case 'ansi':
				frag.appendChild(renderLogStringNode(seg.text, { quoted: false, className: 'log-str' }))
				break
			case 'link': {
				const a = document.createElement('a')
				a.href = seg.href || '#'
				a.target = '_blank'
				a.rel = 'noopener noreferrer'
				a.style.color = 'inherit'
				a.appendChild(renderLogStringNode(seg.label, { quoted: false, className: 'log-str' }))
				frag.appendChild(a)
				break
			}
			case 'dir':
				frag.appendChild(buildArgNode(seg.snapshot, 0, true, renderOpts))
				break
			case 'traceStack': {
				const wrap = document.createElement('span')
				wrap.style.cssText = 'color:gray;font-size:0.9em;display:block'
				for (const f of seg.frames || []) {
					const line = document.createElement('span')
					line.style.display = 'block'
					line.textContent = f.raw
					wrap.appendChild(line)
				}
				frag.appendChild(wrap)
				break
			}
			default:
				break
		}
	
	return frag
}

/**
 * 构建参数内容容器（统一由 `segments` 渲染；stdout/stderr 由库的 `streamToSegments` 拆成 link/ansi）。
 * @param {object} entry - WebSocket / 初始载荷中的条目。
 * @param {{ requestExpandRef?: (ref: string) => Promise<unknown> }} [renderOpts] - 嵌套值展开选项。
 * @returns {HTMLElement} `log-args` 容器（可能标记空流）。
 */
function buildArgsContent(entry, renderOpts = {}) {
	const container = document.createElement('span')
	container.className = 'log-args'
	const { method, segments, plainText } = entry

	if ((method === 'stdout' || method === 'stderr') && !plainText?.trim()) {
		container.dataset.emptyStream = '1'
		return container
	}

	if (!segments?.length) {
		container.dataset.emptyStream = method === 'dir' ? '1' : undefined
		return container
	}

	container.appendChild(buildFragmentFromSegments(segments, renderOpts))
	return container
}

/** virtual-console `LogEntry.level`（methodNameToLevel）→ 行样式 */
const LEVEL_CLASS = {
	log: 'log-level-log',
	info: 'log-level-info',
	warn: 'log-level-warn',
	error: 'log-level-error',
	debug: 'log-level-debug',
}

/**
 * 渲染单条日志条目（Chrome DevTools 风格）。
 * @param {object} entry - 日志条目。
 * @param {object} [opts] - 交互与懒加载选项。
 * @param {boolean} [opts.canOpenEditor=false] - 是否允许点击源码跳转编辑器。
 * @param {(callsite: object) => void | Promise<void>} [opts.onOpenSource] - 点击源码时的回调。
 * @param {(ref: string) => Promise<unknown>} [opts.requestExpandRef] - 展开 truncated 引用。
 * @returns {HTMLElement} 日志行；空 stdout/stderr 可能返回隐藏的占位节点。
 */
export function renderLogItem(entry, { canOpenEditor = false, onOpenSource, requestExpandRef } = {}) {
	injectStyles()

	const levelClass = LEVEL_CLASS[entry.level] || 'log-level-log'

	const row = document.createElement('div')
	row.className = `log-row ${levelClass}`

	// 内容区
	const content = document.createElement('div')
	content.className = 'log-content'
	const argsContent = buildArgsContent(entry, { requestExpandRef })
	const m = entry.method
	if ((m === 'stdout' || m === 'stderr' || m === 'dir') && argsContent.dataset.emptyStream === '1') {
		const emptyRow = document.createElement('div')
		emptyRow.style.display = 'none'
		return emptyRow
	}
	content.appendChild(argsContent)
	row.appendChild(content)

	// 元信息区（来源位置）
	const callsite = entry.primaryCallsite
	if (callsite) {
		const meta = document.createElement('div')
		meta.className = 'log-meta'
		const btn = document.createElement('button')
		const canClick = Boolean(canOpenEditor && onOpenSource)
		btn.className = `log-source-btn${canClick ? ' clickable' : ''}`
		const fileName = callsite.filePath.split(/[/\\]/).pop()
		btn.textContent = `${fileName}:${callsite.line}`
		btn.title = `${callsite.filePath}:${callsite.line}:${callsite.column}`
		if (canClick)
			btn.addEventListener('click', () => onOpenSource(callsite))
		meta.appendChild(btn)
		row.appendChild(meta)
	}

	return row
}

/**
 * 创建日志工具栏并绑定过滤逻辑。
 * @param {object} opts - 工具栏配置。
 * @param {HTMLElement} opts.container - 日志列表容器（当前实现未直接使用，保留接口）。
 * @param {() => void} opts.onClear - 用户点击清空时调用。
 * @param {(filterText: string, levelFilter: string) => void} opts.onFilter - 文本或级别变更时调用。
 * @returns {HTMLElement} 工具栏根元素。
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
		{ id: 'log', label: 'Log' },
		{ id: 'info', label: 'Info' },
		{ id: 'warn', label: 'Warn' },
		{ id: 'error', label: 'Err' },
		{ id: 'debug', label: 'Dbg' },
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
 * @param {object} entry - 日志条目。
 * @param {string} filterText - 大小写不敏感的子串过滤（空则跳过）。
 * @param {string} levelFilter - `all` 或具体 `entry.level`。
 * @returns {boolean} 是否应显示。
 */
export function entryMatchesFilter(entry, filterText, levelFilter) {
	if ((entry.method === 'stdout' || entry.method === 'stderr') && !entry.plainText?.trim())
		return false

	if (levelFilter !== 'all' && entry.level !== levelFilter)
		return false

	if (filterText) {
		const needle = filterText.toLowerCase()
		const haystack = (entry.plainText || '').toLowerCase()
		if (!haystack.includes(needle)) return false
	}

	return true
}
