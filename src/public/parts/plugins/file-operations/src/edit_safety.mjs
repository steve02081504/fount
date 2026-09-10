/**
 * 文件写操作防呆：EOL/BOM 保真、匹配计数与唯一性约束、模糊兜底、相似度与行级 diff。
 * 供 `handler.mjs` 的 `<replace-file>` / `<override-file>` 共用；纯函数、无 I/O、目标机器无关。
 */
import { escapeRegExp, parseRegexFromString } from '../../../../../scripts/regex.mjs'

const MAX_MATCHES = 1000
const FUZZY_MAX_SPAN_FACTOR = 4
const FUZZY_MAX_SPAN_EXTRA = 500
const SIMILARITY_LINE_CAP = 1200
const DIFF_CELL_CAP = 4_000_000

/**
 * 文本风格（行尾与 BOM）。
 * @typedef {object} textStyle_t
 * @property {'\r\n'|'\n'} eol - 主导行尾。
 * @property {boolean} bom - 是否以 UTF-8 BOM 起始。
 */

/**
 * 匹配摘要。
 * @typedef {object} matchSummary_t
 * @property {number} line - 1 起算的行号。
 * @property {string} snippet - 命中的首行片段（截断）。
 */

/**
 * 替换结果。
 * @typedef {object} replaceResult_t
 * @property {'applied'|'empty'|'invalid'|'multi'|'no-match'|'disproportionate'} status - 结果状态。
 * @property {string} content - 处理后的内容（LF 行尾）。
 * @property {number} matchCount - 命中数。
 * @property {string} [method] - 采用的匹配方式（exact / regex / fuzzy:…）。
 * @property {string} [error] - 编译失败等错误信息。
 * @property {matchSummary_t[]} [matches] - 多处命中的摘要（status 为 multi 时）。
 */

/**
 * 检测文本的主导行尾与 BOM。
 * @param {string} text - 文本。
 * @returns {textStyle_t} 文本风格。
 */
export function detectTextStyle(text) {
	const bom = text.charCodeAt(0) === 0xFEFF
	const body = bom ? text.slice(1) : text
	const totalLf = (body.match(/\n/g) || []).length
	const crlf = (body.match(/\r\n/g) || []).length
	return { eol: crlf > totalLf - crlf ? '\r\n' : '\n', bom }
}

/**
 * 将文本行尾统一为 LF。
 * @param {string} text - 文本。
 * @returns {string} LF 文本。
 */
export function toLf(text) {
	return String(text ?? '').replace(/\r\n/g, '\n').replace(/\r/g, '\n')
}

/**
 * 将 LF 文本转换为指定行尾。
 * @param {string} text - LF 文本。
 * @param {'\r\n'|'\n'} eol - 目标行尾。
 * @returns {string} 转换后的文本。
 */
export function applyEol(text, eol) {
	const lf = toLf(text)
	return eol === '\r\n' ? lf.replace(/\n/g, '\r\n') : lf
}

/**
 * 去掉起始 BOM。
 * @param {string} text - 文本。
 * @returns {string} 无 BOM 文本。
 */
export function stripBom(text) {
	return text.charCodeAt(0) === 0xFEFF ? text.slice(1) : text
}

/**
 * 按需还原起始 BOM。
 * @param {string} text - 文本。
 * @param {boolean} bom - 是否加 BOM。
 * @returns {string} 结果文本。
 */
export function restoreBom(text, bom) {
	return bom ? '\uFEFF' + text : text
}

/**
 * 构建搜索正则。
 * @param {string} search - 搜索内容（正则字面量或纯文本）。
 * @param {boolean} regex - 是否正则模式。
 * @returns {RegExp} 带 `g` 标志的正则。
 */
function buildSearchRegex(search, regex) {
	if (regex) {
		const parsed = parseRegexFromString(search)
		if (parsed.flags.includes('g')) return parsed
		return new RegExp(parsed.source, parsed.flags + 'g')
	}
	return new RegExp(escapeRegExp(toLf(search)), 'g')
}

/**
 * 收集全部非零宽命中。
 * @param {RegExp} regex - 带 `g` 标志的正则。
 * @param {string} content - 内容。
 * @returns {{index: number, text: string}[]} 命中列表。
 */
function collectMatches(regex, content) {
	const matches = []
	regex.lastIndex = 0
	let match
	while ((match = regex.exec(content)) !== null) {
		if (match[0] === '') {
			regex.lastIndex++
			continue
		}
		matches.push({ index: match.index, text: match[0] })
		if (matches.length >= MAX_MATCHES) break
	}
	return matches
}

/**
 * 计算 `index` 处的 1 起算行号。
 * @param {string} content - 内容。
 * @param {number} index - 字符下标。
 * @returns {number} 行号。
 */
function lineNumberAt(content, index) {
	let line = 1
	for (let i = 0; i < index; i++)
		if (content.charCodeAt(i) === 10) line++
	return line
}

/**
 * 将命中列表压缩为可读摘要。
 * @param {string} content - 内容。
 * @param {{index: number, text: string}[]} matches - 命中列表。
 * @returns {matchSummary_t[]} 摘要列表（最多 5 条）。
 */
function summarizeMatches(content, matches) {
	return matches.slice(0, 5).map(match => ({
		line: lineNumberAt(content, match.index),
		snippet: match.text.split('\n')[0].trim().slice(0, 80),
	}))
}

/**
 * 行尾空白容忍的搜索模式（逐行 trim 后拼接）。
 * @param {string} search - 纯文本搜索内容。
 * @returns {string|null} 正则源码（不适用时 null）。
 */
function lineTrimPattern(search) {
	const lines = toLf(search).split('\n')
	if (!lines.length) return null
	return lines
		.map(line => '[ \\t]*' + escapeRegExp(line.trim()) + '[ \\t]*')
		.join('\\r?\\n') || null
}

/**
 * 空白归一的搜索模式（任意空白折叠为 `\s+`）。
 * @param {string} search - 纯文本搜索内容。
 * @returns {string|null} 正则源码（不适用时 null）。
 */
function whitespaceNormalizedPattern(search) {
	const tokens = toLf(search).split(/\s+/).filter(Boolean)
	if (!tokens.length) return null
	return tokens.map(escapeRegExp).join('\\s+')
}

/**
 * 对唯一命中做一次替换（正则模式下支持 `$1` 反向引用）。
 * @param {string} content - 内容。
 * @param {RegExp} regex - 带 `g` 标志的正则。
 * @param {string} replace - 替换内容。
 * @param {boolean} useBackrefs - 是否解释替换串中的 `$` 反向引用。
 * @returns {string} 结果。
 */
function applyFirst(content, regex, replace, useBackrefs) {
	const single = new RegExp(regex.source, regex.flags.replace('g', ''))
	return content.replace(single, useBackrefs ? replace : () => replace)
}

/**
 * 对所有命中做替换。
 * @param {string} content - 内容。
 * @param {RegExp} regex - 带 `g` 标志的正则。
 * @param {string} replace - 替换内容。
 * @param {boolean} useBackrefs - 是否解释替换串中的 `$` 反向引用。
 * @returns {string} 结果。
 */
function applyEvery(content, regex, replace, useBackrefs) {
	return content.replace(regex, useBackrefs ? replace : () => replace)
}

/**
 * 对内容执行一次防呆替换。
 *
 * 顺序：空搜索拒绝 → 精确匹配 → （纯文本且精确为 0）行尾空白容忍 → 空白归一。
 * 命中多处且未显式 `replaceAll` 时拒绝并回报摘要；模糊兜底仅接受唯一命中且跨度不得异常膨胀。
 *
 * @param {string} content - 原始内容（内部统一为 LF）。
 * @param {object} operation - 替换操作。
 * @param {string} operation.search - 搜索内容。
 * @param {string} [operation.replace] - 替换内容。
 * @param {boolean} [operation.regex] - 是否正则模式。
 * @param {boolean} [operation.replaceAll] - 是否允许替换全部命中。
 * @returns {replaceResult_t} 替换结果（content 为 LF 行尾）。
 */
export function applyReplacement(content, { search, replace = '', regex = false, replaceAll = false }) {
	const lfContent = toLf(content)
	const lfReplace = toLf(replace)
	if (!search || !search.trim())
		return { status: 'empty', content: lfContent, matchCount: 0 }

	let baseRegex
	try {
		baseRegex = buildSearchRegex(search, regex)
	}
	catch (error) {
		return { status: 'invalid', content: lfContent, matchCount: 0, error: String(error?.message || error) }
	}

	const exact = collectMatches(baseRegex, lfContent)
	if (exact.length && (exact.length === 1 || replaceAll))
		return {
			status: 'applied',
			content: replaceAll ? applyEvery(lfContent, baseRegex, lfReplace, regex) : applyFirst(lfContent, baseRegex, lfReplace, regex),
			method: regex ? 'regex' : 'exact',
			matchCount: exact.length,
		}

	if (regex || exact.length > 1)
		return exact.length === 0
			? { status: 'no-match', content: lfContent, matchCount: 0 }
			: { status: 'multi', content: lfContent, matchCount: exact.length, matches: summarizeMatches(lfContent, exact) }

	for (const [method, pattern] of [['line-trim', lineTrimPattern(search)], ['whitespace-normalized', whitespaceNormalizedPattern(search)]]) {
		if (!pattern) continue
		const fuzzyRegex = new RegExp(pattern, 'g')
		const found = collectMatches(fuzzyRegex, lfContent)
		if (found.length !== 1) continue
		if (found[0].text.length > Math.max(search.length * FUZZY_MAX_SPAN_FACTOR, search.length + FUZZY_MAX_SPAN_EXTRA))
			return { status: 'disproportionate', content: lfContent, method: `fuzzy:${method}`, matchCount: 1 }
		return {
			status: 'applied',
			content: applyFirst(lfContent, fuzzyRegex, lfReplace, false),
			method: `fuzzy:${method}`,
			matchCount: 1,
		}
	}

	return { status: 'no-match', content: lfContent, matchCount: 0 }
}

/**
 * 计算两组行的最长公共子序列长度。
 * @param {string[]} a - 行数组 A。
 * @param {string[]} b - 行数组 B。
 * @returns {number} LCS 长度。
 */
function lcsLength(a, b) {
	let prev = new Uint32Array(b.length + 1)
	let cur = new Uint32Array(b.length + 1)
	for (let i = 1; i <= a.length; i++) {
		for (let j = 1; j <= b.length; j++)
			cur[j] = a[i - 1] === b[j - 1] ? prev[j - 1] + 1 : Math.max(prev[j], cur[j - 1])
		const swap = prev
		prev = cur
		cur = swap
		cur.fill(0)
	}
	return prev[b.length]
}

/**
 * 计算两段文本的相似度（0–1，基于行 LCS；超大文件退化为行集合 Jaccard）。
 * @param {string} oldText - 旧文本。
 * @param {string} newText - 新文本。
 * @returns {number} 相似度。
 */
export function similarityRatio(oldText, newText) {
	const a = toLf(oldText).split('\n')
	const b = toLf(newText).split('\n')
	if (a.length > SIMILARITY_LINE_CAP || b.length > SIMILARITY_LINE_CAP) {
		const setA = new Set(a)
		const setB = new Set(b)
		let inter = 0
		for (const line of setA)
			if (setB.has(line)) inter++
		const union = new Set([...a, ...b]).size
		return union ? inter / union : 1
	}
	const total = a.length + b.length
	return total ? (2 * lcsLength(a, b)) / total : 1
}

/**
 * 行级差异操作。
 * @typedef {object} lineOp_t
 * @property {'equal'|'del'|'add'} type - 操作类型。
 * @property {string} text - 行内容。
 */

/**
 * 计算行级差异操作（先裁剪公共前后缀，再对中段做 LCS；过大时退化为整段删加）。
 * @param {string[]} a - 旧行数组。
 * @param {string[]} b - 新行数组。
 * @returns {lineOp_t[]} 操作序列。
 */
function computeLineOps(a, b) {
	let start = 0
	while (start < a.length && start < b.length && a[start] === b[start]) start++
	let endA = a.length
	let endB = b.length
	while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) { endA--; endB-- }

	const ops = []
	for (let i = 0; i < start; i++) ops.push({ type: 'equal', text: a[i] })
	const midA = a.slice(start, endA)
	const midB = b.slice(start, endB)
	if (midA.length * midB.length > DIFF_CELL_CAP) {
		for (const text of midA) ops.push({ type: 'del', text })
		for (const text of midB) ops.push({ type: 'add', text })
	}
	else {
		const width = midB.length + 1
		const dp = new Uint32Array((midA.length + 1) * width)
		/**
		 * 计算扁平 DP 数组中 (i, j) 的下标。
		 * @param {number} i - 行下标。
		 * @param {number} j - 列下标。
		 * @returns {number} 扁平下标。
		 */
		const at = (i, j) => i * width + j
		for (let i = midA.length - 1; i >= 0; i--)
			for (let j = midB.length - 1; j >= 0; j--)
				dp[at(i, j)] = midA[i] === midB[j] ? dp[at(i + 1, j + 1)] + 1 : Math.max(dp[at(i + 1, j)], dp[at(i, j + 1)])
		let i = 0
		let j = 0
		while (i < midA.length && j < midB.length) 
			if (midA[i] === midB[j]) { ops.push({ type: 'equal', text: midA[i] }); i++; j++ }
			else if (dp[at(i + 1, j)] >= dp[at(i, j + 1)]) ops.push({ type: 'del', text: midA[i++] })
			else ops.push({ type: 'add', text: midB[j++] })
		
		while (i < midA.length) ops.push({ type: 'del', text: midA[i++] })
		while (j < midB.length) ops.push({ type: 'add', text: midB[j++] })
	}
	for (let i = endA; i < a.length; i++) ops.push({ type: 'equal', text: a[i] })
	return ops
}

/**
 * 渲染紧凑的行级 diff（带行号与上下文，超量截断）。
 * @param {string} oldText - 旧文本。
 * @param {string} newText - 新文本。
 * @param {object} [options] - 选项。
 * @param {number} [options.context] - 变更前后保留的上下文行数。
 * @param {number} [options.maxLines] - 输出行数上限（含 diff 标记）。
 * @returns {string} diff 文本（无差异时为空串）。
 */
export function renderLineDiff(oldText, newText, { context = 3, maxLines = 80 } = {}) {
	const a = toLf(oldText).split('\n')
	const b = toLf(newText).split('\n')
	if (a.join('\n') === b.join('\n')) return ''
	const ops = computeLineOps(a, b)

	const keep = new Array(ops.length).fill(false)
	for (let i = 0; i < ops.length; i++)
		if (ops[i].type !== 'equal')
			for (let k = Math.max(0, i - context); k <= Math.min(ops.length - 1, i + context); k++) keep[k] = true

	const out = []
	let oldLine = 1
	let newLine = 1
	let lastKept = -2
	for (let i = 0; i < ops.length; i++) {
		const op = ops[i]
		if (keep[i] && lastKept !== i - 1) out.push(`@@ ${op.type === 'add' ? newLine : oldLine} @@`)
		if (keep[i]) {
			const marker = op.type === 'del' ? '-' : op.type === 'add' ? '+' : ' '
			out.push(`${marker} ${op.text}`)
			lastKept = i
		}
		if (op.type !== 'add') oldLine++
		if (op.type !== 'del') newLine++
	}
	const omitted = Math.max(0, out.length - maxLines)
	const shown = omitted ? out.slice(0, maxLines) : out
	if (omitted) shown.push(`…（${omitted} 行未显示）`)
	return shown.join('\n')
}
