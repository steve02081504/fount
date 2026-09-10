/**
 * 多行字符串构建风格检测：源码里用 `[a, b, c].join('\n')` 或
 * `'a\n' + 'b\n' + 'c'` 拼接静态多行文本时应改用多行模板字符串；
 * 只为插值一次而存在的 `const` 字符串（`const a = xxx; return `\${a}``）
 * 应把表达式内联进模板。统一后多行文本的缩进、转义、空行一眼可读，
 * 也避免手写换行符拼接漏掉分隔符。
 * 判定：
 * - `array-join`：`[...]` 字面量（不含展开元素）直接 `.join('\n')`；
 * - `literal-concat`：仅由字符串/模板字面量组成的 `+` 连加，且含换行；
 * - `inline-const`：`const NAME = <表达式>` 后紧跟 `return` 多行模板，
 *   模板除 `\${NAME}` 外没有其它内容，且 NAME 全文件只出现两次。
 * 作用域：`*.test.mjs` / `*.spec.mjs` 及本文件自身不纳入（测试常故意拼输入文本）。
 */
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

import { listRepoFiles } from './walk.mjs'

/** 扫描的源码后缀。 */
export const BUILD_STRING_SUFFIXES = ['.mjs', '.js', '.ts']

/** 单行字符串/模板字面量在掩码文本里的占位标记。 */
const TOKEN_MARK = '\u0001'

/** 可后接表达式数组字面量的关键字（`return [` 等，避免误判为取下标）。 */
const EXPR_PREFIX_KEYWORDS = new Set([
	'await', 'case', 'const', 'default', 'delete', 'do', 'else', 'extends',
	'in', 'instanceof', 'let', 'new', 'of', 'return', 'throw', 'typeof', 'var', 'void', 'yield',
])

/**
 * 该路径是否属于多行字符串构建风格扫描范围。
 * @param {string} relativePath 相对仓库根
 * @returns {boolean} 应跳过则为 true
 */
export function isBuildStringScanned(relativePath) {
	if (relativePath === 'src/scripts/checks/build_string.mjs') return false
	if (/\.(?:test|spec)\.(?:mjs|js|ts)$/u.test(relativePath)) return false
	return true
}

/**
 * 计算某个匹配偏移量对应的行号（1 起）。
 * @param {string} content 文件文本
 * @param {number} index 匹配起始偏移
 * @returns {number} 行号
 */
function lineNumberAt(content, index) {
	let line = 1
	for (let offset = 0; offset < index; offset++) if (content[offset] === '\n') line++
	return line
}

/**
 * 跳过单引号/双引号字符串字面量（含转义）。
 * @param {string} content 文件文本
 * @param {number} index 起始引号偏移
 * @returns {number} 字符串结束后的偏移
 */
function readSimpleString(content, index) {
	const quote = content[index]
	const len = content.length
	let end = index + 1
	while (end < len) {
		if (content[end] === '\\') { end += 2; continue }
		if (content[end] === quote) { end++; break }
		end++
	}
	return end
}

/**
 * 扫描模板插值 `${...}` 直到匹配的 `}`，正确处理嵌套 `{}`、注释、
 * 字符串字面量与嵌套模板。
 * @param {string} content 文件文本
 * @param {number} index `${` 之后的偏移
 * @returns {number} 结束 `}` 之后的偏移
 */
function readTemplateInterpolation(content, index) {
	const len = content.length
	let depth = 1
	let i = index
	while (i < len && depth > 0) {
		const c = content[i]
		if (c === '/' && content[i + 1] === '/') {
			const end = content.indexOf('\n', i)
			i = end === -1 ? len : end
		}
		else if (c === '/' && content[i + 1] === '*') {
			const end = content.indexOf('*/', i + 2)
			i = end === -1 ? len : end + 2
		}
		else if (c === '{') { depth++; i++ }
		else if (c === '}') { depth--; i++ }
		else if (c === '\'' || c === '"') i = readSimpleString(content, i)
		else if (c === '`') i = readTemplate(content, i)
		else i++
	}
	return i
}

/**
 * 跳过模板字符串（含 `${...}` 插值与嵌套模板）。
 * @param {string} content 文件文本
 * @param {number} index 起始反引号偏移
 * @returns {number} 结束反引号之后的偏移
 */
function readTemplate(content, index) {
	const len = content.length
	let i = index + 1
	while (i < len) {
		const c = content[i]
		if (c === '\\') { i += 2; continue }
		if (c === '`') return i + 1
		if (c === '$' && content[i + 1] === '{') { i = readTemplateInterpolation(content, i + 2); continue }
		i++
	}
	return i
}

/**
 * @typedef {{ path: string, line: number, kind: string, token: string }} BuildStringIssue 命中条目
 */

/**
 * 词法扫描：跳过注释，收集字符串/模板字面量、注释区间与方括号配对。
 * @param {string} content 文件文本
 * @returns {{ tokens: { start: number, end: number, kind: string }[], arrays: { start: number, end: number }[], comments: { start: number, end: number }[], coverage: Uint8Array }} 扫描结果
 */
function lex(content) {
	/** @type {{ start: number, end: number, kind: string }[]} */
	const tokens = []
	/** @type {{ start: number, end: number }[]} */
	const arrays = []
	/** @type {{ start: number, end: number }[]} */
	const comments = []
	/** @type {{ start: number, literal: boolean }[]} */
	const stack = []
	const coverage = new Uint8Array(content.length)
	const len = content.length
	let i = 0
	while (i < len) {
		const c = content[i]
		if (c === '/' && content[i + 1] === '/') {
			const end = content.indexOf('\n', i)
			const stop = end === -1 ? len : end
			comments.push({ start: i, end: stop })
			i = stop
			continue
		}
		if (c === '/' && content[i + 1] === '*') {
			const end = content.indexOf('*/', i + 2)
			const stop = end === -1 ? len : end + 2
			comments.push({ start: i, end: stop })
			i = stop
			continue
		}
		if (c === '\'' || c === '"') {
			const start = i
			i = readSimpleString(content, i)
			tokens.push({ start, end: i, kind: 'string' })
			continue
		}
		if (c === '`') {
			const start = i
			i = readTemplate(content, i)
			tokens.push({ start, end: i, kind: 'template' })
			continue
		}
		if (c === '[') {
			stack.push({ start: i, literal: !isSubscriptStart(content, i) })
			i++
			continue
		}
		if (c === ']') {
			const top = stack.pop()
			if (top?.literal) arrays.push({ start: top.start, end: i })
			i++
			continue
		}
		i++
	}
	for (const token of tokens) for (let k = token.start; k < token.end; k++) coverage[k] = 1
	return { tokens, arrays, comments, coverage }
}

/**
 * 判断 `[` 是取下标（`arr[i]` / `arr?.[i]`）还是数组字面量。
 * @param {string} content 文件文本
 * @param {number} index `[` 偏移
 * @returns {boolean} 是取下标则为 true
 */
function isSubscriptStart(content, index) {
	let i = index - 1
	while (i >= 0 && /\s/u.test(content[i])) i--
	if (i < 0) return false
	const ch = content[i]
	if (ch === ')' || ch === ']' || ch === '\'' || ch === '"' || ch === '`') return true
	if (!/[\w$]/u.test(ch)) return false
	let start = i
	while (start >= 0 && /[\w$]/u.test(content[start])) start--
	return !EXPR_PREFIX_KEYWORDS.has(content.slice(start + 1, i + 1))
}

/**
 * 判断数组字面量是否含顶层展开元素（`...x`）。
 * @param {string} content 文件文本
 * @param {number} start `[` 偏移
 * @param {number} end `]` 偏移
 * @param {Uint8Array} coverage 字面量覆盖标记
 * @returns {boolean} 含展开则为 true
 */
function hasSpreadElement(content, start, end, coverage) {
	let depth = 0
	for (let i = start + 1; i < end; i++) {
		if (coverage[i]) continue
		const c = content[i]
		if (c === '(' || c === '[' || c === '{') depth++
		else if (c === ')' || c === ']' || c === '}') depth--
		else if (c === '.' && depth === 0 && content[i + 1] === '.' && content[i + 2] === '.') return true
	}
	return false
}

/**
 * 判断数组字面量是否为空（`[]`）。
 * @param {string} content 文件文本
 * @param {number} start `[` 偏移
 * @param {number} end `]` 偏移
 * @returns {boolean} 空数组则为 true
 */
function isEmptyArray(content, start, end) {
	return content.slice(start + 1, end).trim() === ''
}

/**
 * 扫描直接 `[...].join('\n')` 形式的数组构建。
 * @param {string} content 文件文本
 * @param {{ start: number, end: number }[]} arrays 数组字面量区间
 * @param {Uint8Array} coverage 字面量覆盖标记
 * @returns {{ line: number, kind: string, token: string }[]} 命中条目
 */
function scanArrayJoin(content, arrays, coverage) {
	/** @type {{ line: number, kind: string, token: string }[]} */
	const issues = []
	for (const array of arrays) {
		const after = content.slice(array.end + 1)
		if (!/^\s*\.\s*join\s*\(\s*(["'])\\n\1\s*\)/u.test(after)) continue
		if (isEmptyArray(content, array.start, array.end)) continue
		if (hasSpreadElement(content, array.start, array.end, coverage)) continue
		issues.push({
			line: lineNumberAt(content, array.start),
			kind: 'array-join',
			token: content.slice(array.start, array.end + 1).replace(/\s+/gu, ' ').slice(0, 60),
		})
	}
	return issues
}

/**
 * 扫描仅由字符串/模板字面量组成、且含换行的 `+` 连加。
 * @param {string} content 文件文本
 * @param {{ start: number, end: number, kind: string }[]} tokens 字面量区间
 * @param {{ start: number, end: number }[]} comments 注释区间
 * @returns {{ line: number, kind: string, token: string }[]} 命中条目
 */
function scanLiteralConcat(content, tokens, comments) {
	const masked = new Array(content.length)
	for (let i = 0; i < content.length; i++) masked[i] = content[i]
	for (const comment of comments) for (let i = comment.start; i < comment.end; i++) masked[i] = ' '
	for (const token of tokens) {
		masked[token.start] = TOKEN_MARK
		for (let i = token.start + 1; i < token.end; i++) masked[i] = ' '
	}
	const text = masked.join('')
	const chainRe = new RegExp(`${TOKEN_MARK}(?:\\s*\\+\\s*${TOKEN_MARK})+`, 'gu')
	const tokenByStart = new Map(tokens.map(token => [token.start, token]))
	/** @type {{ line: number, kind: string, token: string }[]} */
	const issues = []
	for (const match of text.matchAll(chainRe)) {
		const index = match.index
		let before = index - 1
		while (before >= 0 && /\s/u.test(text[before])) before--
		if (before >= 0 && text[before] === '+') continue
		const afterIndex = index + match[0].length
		let after = afterIndex
		while (after < text.length && /\s/u.test(text[after])) after++
		if (after < text.length && text[after] === '+') continue
		const operands = []
		for (let i = index; i < afterIndex; i++) if (text[i] === TOKEN_MARK) operands.push(tokenByStart.get(i))
		if (operands.length < 2) continue
		if (!operands.some(operand => /\n|\\n/u.test(content.slice(operand.start, operand.end)))) continue
		issues.push({
			line: lineNumberAt(content, index),
			kind: 'literal-concat',
			token: match[0].replace(/\s+/gu, ' ').slice(0, 60),
		})
	}
	return issues
}

/**
 * 扫描只为插值一次而存在的 `const` 字符串。
 * @param {string} content 文件文本
 * @param {{ start: number, end: number, kind: string }[]} tokens 字面量区间
 * @returns {{ line: number, kind: string, token: string }[]} 命中条目
 */
function scanInlineConst(content, tokens) {
	/** @type {{ line: number, kind: string, token: string }[]} */
	const issues = []
	const declRe = /\bconst\s+([$A-Z_a-z][\w$]*)\s*=\s*([^\n;]+)/gu
	for (const match of content.matchAll(declRe)) {
		const name = match[1]
		const wordRe = new RegExp(`(?<![\\w$])${name.replace(/\$/gu, '\\$')}(?![\\w$])`, 'gu')
		if ([...content.matchAll(wordRe)].length !== 2) continue
		const rest = content.slice(match.index + match[0].length)
		const returnMatch = rest.match(/^[\s;]*return\s*/u)
		if (!returnMatch) continue
		const templateStart = match.index + match[0].length + returnMatch[0].length
		if (content[templateStart] !== '`') continue
		const template = tokens.find(token => token.start === templateStart && token.kind === 'template')
		if (!template) continue
		const body = content.slice(template.start + 1, template.end - 1)
		if (body.replace(/\\\r?\n/gu, '').replace(/\s/gu, '') !== '${' + name + '}') continue
		issues.push({
			line: lineNumberAt(content, match.index),
			kind: 'inline-const',
			token: `const ${name}`,
		})
	}
	return issues
}

/**
 * 扫描单文件内容中的多行字符串构建风格问题。
 * @param {string} relativePath 相对仓库根
 * @param {string} content 文件文本
 * @returns {BuildStringIssue[]} 命中条目
 */
export function scanFileBuildString(relativePath, content) {
	const { tokens, arrays, comments, coverage } = lex(content)
	return [
		...scanArrayJoin(content, arrays, coverage),
		...scanLiteralConcat(content, tokens, comments),
		...scanInlineConst(content, tokens),
	].map(issue => ({ path: relativePath, ...issue }))
}

/**
 * 扫描仓库源码中的多行字符串构建风格问题（全量）。
 * @param {string} repoRoot 仓库根
 * @returns {Promise<{ files: string[], issues: BuildStringIssue[] }>} 命中文件与问题列表
 */
export async function scanBuildString(repoRoot) {
	/** @type {BuildStringIssue[]} */
	const issues = []
	for (const relativePath of await listRepoFiles(repoRoot, BUILD_STRING_SUFFIXES)) {
		if (!isBuildStringScanned(relativePath)) continue
		let content
		try {
			content = await readFile(join(repoRoot, relativePath), 'utf8')
		}
		catch (error) {
			if (error?.code === 'ENOENT') continue
			throw error
		}
		issues.push(...scanFileBuildString(relativePath, content))
	}
	return { files: [...new Set(issues.map(issue => issue.path))].sort(), issues }
}
