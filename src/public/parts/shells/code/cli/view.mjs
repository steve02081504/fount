/* eslint jsdoc/require-jsdoc: off, jsdoc/require-param: off, jsdoc/require-param-description: off, jsdoc/require-param-type: off, jsdoc/require-returns: off */
import { Marked } from 'npm:marked@^13'

import { cells, crop, wrap } from '../../../../../scripts/terminal_ui/text.mjs'

import { clean, entryName, entryText, formatUsage } from './transcript.mjs'

const markdown = new Marked({ gfm: true })
const entities = { amp: '&', lt: '<', gt: '>', quot: '"', apos: '\'', nbsp: ' ' }
const decode = text => text.replace(/&(#x[\da-f]+|#\d+|amp|lt|gt|quot|apos|nbsp);/gi, (raw, key) => {
	if (key[0] !== '#') return entities[key.toLowerCase()] ?? raw
	const code = key[1].toLowerCase() === 'x' ? parseInt(key.slice(2), 16) : Number(key.slice(1))
	return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : raw
})
const plainHtml = text => decode(text.replace(/<br\s*\/?\s*>/gi, '\n').replace(/<\/?(?:span|div|p|strong|em|b|i)\b[^>]*>/gi, ''))
const inline = tokens => (tokens ?? []).map(token => {
	if (token.type === 'link') return `${inline(token.tokens)} (${clean(token.href)})`
	if (token.type === 'image') return `${token.text} (${clean(token.href)})`
	if (token.type === 'codespan') return token.text
	if (token.type === 'br') return '\n'
	if (token.tokens) return inline(token.tokens)
	return plainHtml(token.text ?? token.raw ?? '')
}).join('')

/** 把 Markdown 渲染成终端单元格；代码块绝不被当成 HTML 解释。 */
export function markdownLines(text, width) {
	const rows = []
	// 块级递归时用 indent 表示引用/列表的悬挂前缀，缩进宽度从可用宽度里扣掉。
	const render = (tokens, indent = '') => {
		const available = Math.max(1, width - indent.length)
		const push = value => rows.push(...wrap(value, available).map(line => indent + line))
		for (const token of tokens) {
			if (token.type === 'space') { if (rows.at(-1) !== '') rows.push(''); continue }
			if (token.type === 'code') {
				push(`┌─ ${token.lang || 'code'}`)
				for (const line of token.text.split('\n')) push(`│ ${line.replaceAll('\t', '    ')}`)
				push('└─')
			} else if (token.type === 'list')
				for (const [index, item] of token.items.entries()) {
					const start = rows.length
					const bullet = item.task ? item.checked ? '☑ ' : '☐ ' : token.ordered ? `${Number(token.start) + index}. ` : '• '
					render(item.tokens, indent + ' '.repeat(bullet.length))
					if (rows.length > start) rows[start] = indent + bullet + rows[start].slice(indent.length + bullet.length)
				}
			else if (token.type === 'blockquote') render(token.tokens, indent + '│ ')
			else if (token.type === 'table') {
				push(token.header.map(cell => inline(cell.tokens)).join(' │ '))
				push('─'.repeat(available))
				for (const row of token.rows) push(row.map(cell => inline(cell.tokens)).join(' │ '))
			} else if (token.type === 'hr') push('─'.repeat(available))
			else if (token.type === 'heading') { push(inline(token.tokens)); push('─'.repeat(Math.min(available, 24))) }
			else push(token.tokens ? inline(token.tokens) : plainHtml(token.text ?? token.raw ?? ''))
		}
	}
	render(markdown.lexer(clean(text)))
	return rows
}

/** 切出仅供显示的 disclosure 块，支持未写完的流式块与嵌套结构。 */
export function disclosureBlocks(text) {
	const root = { children: [] }
	const stack = [root]
	let fence = null
	let ordinal = 0
	const append = value => {
		if (!value) return
		const {children} = stack.at(-1)
		if (children.at(-1)?.type === 'text') children.at(-1).text += value
		else children.push({ type: 'text', text: value })
	}
	for (const line of text.split(/(?<=\n)/)) {
		const marker = /^ {0,3}(`{3,}|~{3,})/.exec(line)?.[1]
		// 围栏代码块整体照抄：里面的 <details> 是示例，不是折叠块。
		if (fence) {
			append(line)
			const closing = /^ {0,3}(`+|~+)\s*$/.exec(line)?.[1]
			if (closing && closing[0] === fence[0] && closing.length >= fence.length) fence = null
		} else if (marker) { fence = marker; append(line) }
		else for (const piece of line.split(/(`+[^`]*`+|<details\b[^>]*>|<\/details\s*>|<think\b[^>]*>|<\/think\s*>|<summary\b[^>]*>|<\/summary\s*>)/gi)) 
			// 行内代码与围栏代码同理，都是不透明内容。
			if (/^<(?:details|think)\b/i.test(piece)) {
				const block = { type: 'details', ordinal: ordinal++, title: '', children: [], summary: false }
				stack.at(-1).children.push(block); stack.push(block)
			} else if (/^<\/(?:details|think)\s*>$/i.test(piece)) { if (stack.length > 1) stack.pop() }
			else if (/^<summary\b/i.test(piece) && stack.length > 1) stack.at(-1).summary = true
			else if (/^<\/summary\s*>$/i.test(piece) && stack.length > 1) stack.at(-1).summary = false
			else if (stack.at(-1).summary) stack.at(-1).title += piece
			else append(piece)
		
	}
	return root.children
}

/** 产出有序的对话正文与折叠项的点击目标，不关心视口。 */
export function transcriptView(entries, { width, expanded = new Set(), focused, reasoning = 'Thinking', user = 'You', translateUsage }) {
	const lines = []
	const styles = []
	const controls = []
	const pushBody = (text, indent = '  ') => {
		for (const line of markdownLines(text, Math.max(1, width - indent.length))) lines.push(indent + line)
	}
	for (const [index, entry] of entries.entries()) {
		if (entry.is_generating) continue
		const identity = String(entry.id ?? `preview-${index}`)
		const tool = !!entry.extension?.toolCall || entry.role === 'tool' || entry.type === 'tool'
		const key = `${identity}:tool`
		const failed = entry.extension?.toolCall?.state === 'failed'
		styles[lines.length] = focused === key ? '7' : failed ? '1;31' : entry.role === 'user' ? '1;36' : tool ? '33' : '1;35'
		lines.push(` ${entry.role === 'user' ? '❯' : tool ? failed ? '✗' : '⚙' : '◆'} ${entry.role === 'user' ? clean(entry.name || user) : clean(entryName(entry))}${tool ? expanded.has(key) ? ' ▴' : ' ▾' : ''}`)
		if (tool) controls.push({ line: lines.length - 1, key })
		const renderBlocks = (blocks, indent = '  ') => {
			for (const block of blocks) {
				if (block.type === 'text') { if (block.text.trim()) pushBody(block.text.replace(/^\n+|\n+$/g, ''), indent); continue }
				const blockKey = `${identity}:details:${block.ordinal}`
				controls.push({ line: lines.length, key: blockKey })
				styles[lines.length] = focused === blockKey ? '7' : '2'
				lines.push(`${indent}${focused === blockKey ? '›' : ' '} ${expanded.has(blockKey) ? '▴' : '▾'} ${clean(plainHtml(block.title)).trim() || reasoning}`)
				if (expanded.has(blockKey)) renderBlocks(block.children, indent + '│ ')
			}
		}
		if (!tool || expanded.has(key)) renderBlocks(disclosureBlocks(entryText(entry)))
		for (const file of entry.files ?? []) lines.push(`  ↳ ${clean(file.name ?? 'file')}`)
		if (entry.extension?.usage) lines.push(`  ${formatUsage(entry.extension.usage, translateUsage)}`)
		lines.push('')
	}
	return { lines: lines.map(line => crop(clean(line), width)), controls, styles }
}

/** 按条目缓存已定型的排版并只保留当前对话；输入或流式输出时无需重排整屏。 */
export function createTranscriptRenderer() {
	const cache = new Map()
	return (entries, options) => {
		const result = { lines: [], controls: [], styles: [] }
		const retained = new Set()
		for (const [index, entry] of entries.entries()) {
			if (entry.is_generating) continue
			const id = String(entry.id ?? `preview-${index}`)
			retained.add(id)
			const prefix = `${id}:`
			const signature = JSON.stringify([options.width, options.reasoning, options.user, options.translateUsage,
				options.focused?.startsWith(prefix) ? options.focused : null,
				[...options.expanded ?? []].filter(key => key.startsWith(prefix))])
			let record = cache.get(id)
			if (record?.entry !== entry || record.signature !== signature) {
				record = { entry, signature, view: transcriptView([{ ...entry, id }], options) }
				cache.set(id, record)
			}
			const offset = result.lines.length
			result.controls.push(...record.view.controls.map(control => ({ ...control, line: control.line + offset })))
			result.lines.push(...record.view.lines)
			for (let row = 0; row < record.view.lines.length; row++) result.styles.push(record.view.styles[row] || '')
		}
		for (const id of cache.keys()) if (!retained.has(id)) cache.delete(id)
		return result
	}
}

/**
 * 夹住滚动位置；到底即视为跟随最新内容。
 * @param {number} scroll - 当前起始行。
 * @param {number} maxScroll - 最大起始行。
 * @param {number} [delta] - 本次位移。
 * @returns {{scroll: number, follow: boolean}} 新位置与是否跟随。
 */
export function scrollViewport(scroll, maxScroll, delta = 0) {
	const next = Math.max(0, Math.min(maxScroll, scroll + delta))
	return { scroll: next, follow: next === maxScroll }
}

/** 让光标所在的那一折行始终可见，草稿很长时也一样。 */
export function composerView(draft, caret, width, height) {
	const rows = wrap(draft, width)
	const before = wrap(draft.slice(0, caret), width)
	let row = before.length - 1
	let column = before.at(-1)
	// A full row's next character wraps; an explicit newline already starts a row.
	if (cells(column) >= width && draft[caret] && draft[caret] !== '\n') { row++; column = '' }
	const offset = Math.max(0, row - height + 1)
	return { rows: rows.slice(offset, offset + height), row: row - offset, column }
}
