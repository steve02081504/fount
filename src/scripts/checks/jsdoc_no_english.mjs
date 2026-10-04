/**
 * 扫描源码中违反「JSDoc 摘要禁用纯英文」的块（含拉丁字母、无 CJK，或缺摘要）。
 */
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

import { CJK_RE } from './agents_md_english.mjs'
import { listRepoFiles } from './walk.mjs'

/** 源码后缀。 */
export const JSDOC_SCAN_SUFFIXES = ['.mjs', '.js', '.ts']

/** 摘要行视为「无描述」的 @ 标签前缀。 */
const TAG_ONLY_PREFIX = /^@(typedef|type|template|property|augments|extends|implements|memberof|see|link|example|default|deprecated|ignore|internal|private|protected|public|readonly|override|inheritdoc|satisfies|import)\b/

const ASCII_LETTER_RE = /[A-Za-z]/

/**
 * 扫描 `${...}` 插值：括号深度 + 嵌套字符串 / 嵌套模板。
 * @param {string} text 源码
 * @param {number} start `{` 之后的起点
 * @param {number} pos 扫描上限
 * @returns {number} 闭合 `}` 之后的位置，或 `pos`
 */
function scanTemplateInterpolation(text, start, pos) {
	let i = start
	let depth = 1
	while (i < pos && depth) {
		const ch = text[i]
		if (ch === '"' || ch === '\'') {
			const quote = ch
			i++
			while (i < pos) {
				if (text[i] === '\\') { i += 2; continue }
				if (text[i] === quote) { i++; break }
				i++
			}
			continue
		}
		if (ch === '`') {
			i = skipTemplateLiteral(text, i + 1, pos)
			continue
		}
		if (ch === '{') { depth++; i++; continue }
		if (ch === '}') { depth--; i++; continue }
		i++
	}
	return i
}

/**
 * 判断 `pos` 是否落在字符串、模板字面量或未闭合的行/块注释内。
 * @param {string} text 源码
 * @param {number} pos 字节偏移
 * @returns {boolean} 在引号/模板/注释内则为 true
 */
function isInsideStringOrTemplate(text, pos) {
	let i = 0
	while (i < pos) {
		const c = text[i]
		if (c === '"' || c === '\'') {
			const quote = c
			i++
			while (i < pos) {
				if (text[i] === '\\') { i += 2; continue }
				if (text[i] === quote) { i++; break }
				i++
			}
			if (i >= pos) return true
			continue
		}
		if (c === '`') {
			i++
			while (i < pos) {
				if (text[i] === '\\') { i += 2; continue }
				if (text[i] === '`') { i++; break }
				if (text[i] === '$' && text[i + 1] === '{') {
					i = scanTemplateInterpolation(text, i + 2, pos)
					continue
				}
				i++
			}
			if (i >= pos) return true
			continue
		}
		if (c === '/' && text[i + 1] === '/') {
			i += 2
			while (i < pos && text[i] !== '\n') i++
			if (i >= pos) return true
			continue
		}
		if (c === '/' && text[i + 1] === '*') {
			i += 2
			let closed = false
			while (i < pos) {
				if (text[i] === '*' && text[i + 1] === '/') { i += 2; closed = true; break }
				i++
			}
			if (!closed) return true
			continue
		}
		i++
	}
	return false
}

/**
 * 从模板字面量内容起点扫到闭合 `` ` `` 或 `pos`。
 * @param {string} text 源码
 * @param {number} start 内容起点（开 `` ` `` 之后）
 * @param {number} pos 扫描上限
 * @returns {number} 闭合后的下一位置，或 `pos`
 */
function skipTemplateLiteral(text, start, pos) {
	let i = start
	while (i < pos) {
		if (text[i] === '\\') { i += 2; continue }
		if (text[i] === '`') return i + 1
		if (text[i] === '$' && text[i + 1] === '{') {
			i = scanTemplateInterpolation(text, i + 2, pos)
			continue
		}
		i++
	}
	return pos
}

/**
 * 从源码文本中提取 JSDoc 块（含起止行号与行内前缀）。
 * 匹配任意位置的 `/**`（含行内对象字面量前的注释），并跳过字符串/模板/普通注释内的伪 JSDoc。
 * @param {string} text 源码
 * @returns {{ text: string, startLine: number, endLine: number, linePrefix: string }[]} 块列表
 */
export function extractJsdocBlocks(text) {
	/** @type {{ text: string, startLine: number, endLine: number, linePrefix: string }[]} */
	const blocks = []
	const jsdocStartPattern = /\/\*\*/g
	let match
	while ((match = jsdocStartPattern.exec(text)) !== null) {
		const start = match.index
		if (isInsideStringOrTemplate(text, start)) {
			jsdocStartPattern.lastIndex = start + 3
			continue
		}
		const end = text.indexOf('*/', start + 3)
		if (end < 0) break
		const blockText = text.slice(start, end + 2)
		const startLine = text.slice(0, start).split(/\r?\n/).length
		const endLine = text.slice(0, end + 2).split(/\r?\n/).length
		const lineStart = text.lastIndexOf('\n', start - 1) + 1
		blocks.push({ text: blockText, startLine, endLine, linePrefix: text.slice(lineStart, start) })
		jsdocStartPattern.lastIndex = end + 2
	}
	return blocks
}

/**
 * 取 JSDoc 块在首个 `@tag` 之前的摘要行（去 `*` 前缀）。
 * @param {string} block JSDoc 块全文
 * @returns {string[]} 非空摘要行
 */
export function jsdocSummaryLines(block) {
	const inner = block.slice(3, -2)
	const lines = []
	for (const raw of inner.split(/\r?\n/)) {
		const trimmed = raw.replace(/^\s*\*\s?/, '').trim()
		if (!trimmed) continue
		if (trimmed.startsWith('@')) break
		lines.push(trimmed)
	}
	return lines
}

/**
 * 摘要是否算「纯英文」：有拉丁字母、无 CJK，且非空。
 * @param {string[]} summaryLines 摘要行
 * @returns {boolean} 摘要是否为纯英文
 */
export function isEnglishJsdocSummary(summaryLines) {
	if (!summaryLines.length) return false
	const text = summaryLines.join(' ')
	if (!ASCII_LETTER_RE.test(text)) return false
	if (CJK_RE.test(text)) return false
	return true
}

/**
 * 块是否仅有类型/标签、无人类可读摘要。
 * 空块或无任何允许标签的块不算 tag-only。
 * @param {string} block JSDoc 块
 * @returns {boolean} 是否仅有类型/标签且无人类可读摘要
 */
export function isTagOnlyJsdoc(block) {
	const summary = jsdocSummaryLines(block)
	if (summary.length) return false
	let sawPermittedTag = false
	const inner = block.slice(3, -2)
	for (const raw of inner.split(/\r?\n/)) {
		const trimmed = raw.replace(/^\s*\*\s?/, '').trim()
		if (!trimmed || !trimmed.startsWith('@')) continue
		if (TAG_ONLY_PREFIX.test(trimmed) || /^@(param|returns?|throws?|yields?)\b/.test(trimmed)) {
			sawPermittedTag = true
			continue
		}
		return false
	}
	return sawPermittedTag
}

/**
 * 多行 JSDoc 是否在开头同行就写了内容（应让 `/**` 独占首行）。
 * 单行块不受约束。
 * @param {string} block JSDoc 块全文
 * @returns {boolean} 多行且首行 `/**` 后有内容则为 true
 */
export function hasInlineJsdocOpening(block) {
	if (!block.startsWith('/**')) return false
	const body = block.slice(3)
	const newlineIndex = body.search(/\r?\n/)
	if (newlineIndex < 0) return false
	return body.slice(0, newlineIndex).trim() !== ''
}

/**
 * 多行 JSDoc 是否把结尾星号斜杠写在内容行上（应换行缩进后再收尾）。
 * 单行块不受约束。
 * @param {string} block JSDoc 块全文
 * @returns {boolean} 多行且未前置换行缩进收尾则为 true
 */
export function hasInlineJsdocClosing(block) {
	if (!block.startsWith('/**') || !block.endsWith('*/')) return false
	if (!/\r?\n/.test(block)) return false
	return !/\n\s+$/.test(block.slice(0, -2))
}

/**
 * 多行 JSDoc 是否挤在源码光标之后（`/**` 前还有代码），也就是注释形如
 * `createClient({ /**` / `const handler = { /**` 这种「徽章」写法。
 * 多行块必须让 `/**` 独占一行。单行块（含行内 `@type` 断言）不受约束。
 * @param {string} block JSDoc 块全文
 * @param {string} linePrefix 块起点之前、同一源码行上的内容
 * @returns {boolean} 多行且同一行已有代码则为 true
 */
export function isMidLineJsdocOpening(block, linePrefix) {
	if (!block.startsWith('/**')) return false
	if (!/\r?\n/.test(block)) return false
	return linePrefix.trim() !== ''
}

/**
 * 多行 JSDoc 是否已按「字面量展开」排版。
 * 规则：开标记必须独占一行（其前只有空白），且开标记之前同一行上不能还留着未闭合的 `(` / `{`
 * （`createClient({ /**` 这种就是字面量没展开）。
 * 行首自成一行的普通声明与行内单行块（含 `@type` 断言）不受约束。
 * @param {string} block JSDoc 块全文
 * @param {string} linePrefix 开标记之前的同一行内容
 * @returns {boolean} 未按字面量展开排版则为 true
 */
export function hasUnsplitJsdocLiteral(block, linePrefix) {
	if (!block.startsWith('/**')) return false
	if (!/\r?\n/.test(block)) return false
	if (linePrefix.trim() !== '') return true
	return /[([{]\s*$/.test(linePrefix)
}

/**
 * 多行 JSDoc 是否把成员挤在收尾标记同一行（收尾标记后还有代码）。
 * @param {string} block JSDoc 块全文
 * @param {string} lineSuffix 收尾标记之后、同一行上的内容
 * @returns {boolean} 收尾行上还有成员则为 true
 */
export function hasJsdocMemberOnClosingLine(block, lineSuffix) {
	if (!block.startsWith('/**') || !block.endsWith('*/')) return false
	if (!/\r?\n/.test(block)) return false
	return !/^\s*[)\]}]*[,\s]*$/.test(lineSuffix.trimStart().replace(/^[)\]}]+/, ''))
}

/**
 * @typedef {{ path: string, line: number, summary: string, missingSummary: boolean }} JsdocNoEnglishIssue
 */

/**
 * @typedef {{ path: string, line: number }} JsdocOpeningIssue
 */

/**
 * @typedef {{ path: string, line: number }} JsdocClosingIssue
 */

/**
 * @typedef {{ path: string, line: number }} JsdocMidLineIssue
 */

/**
 * @typedef {{ path: string, line: number }} JsdocLiteralIssue
 */

/**
 * 扫描单文件中的纯英文 / 缺摘要 JSDoc。
 * @param {string} relativePath 相对仓库根
 * @param {string} text 文件内容
 * @returns {JsdocNoEnglishIssue[]} 命中列表
 */
export function scanFileJsdocNoEnglish(relativePath, text) {
	void relativePath
	/** @type {JsdocNoEnglishIssue[]} */
	const issues = []
	for (const { text: block, startLine } of extractJsdocBlocks(text)) {
		const summary = jsdocSummaryLines(block)
		const missingSummary = summary.length === 0 && !isTagOnlyJsdoc(block)
		if (isEnglishJsdocSummary(summary))
			issues.push({ path: relativePath, line: startLine, summary: summary.join(' '), missingSummary: false })
		else if (missingSummary)
			issues.push({ path: relativePath, line: startLine, summary: '', missingSummary: true })
	}
	return issues
}

/**
 * 扫描仓库中匹配后缀的文件。
 * @param {string} repoRoot 仓库根
 * @param {{ under?: string, suffixes?: string[] }} [options] 选项
 * @returns {Promise<{ files: string[], issues: JsdocNoEnglishIssue[] }>} 命中文件路径与问题列表
 */
export async function scanJsdocNoEnglish(repoRoot, options = {}) {
	const suffixes = options.suffixes ?? JSDOC_SCAN_SUFFIXES
	const files = await listRepoFiles(repoRoot, suffixes, { under: options.under })
	/** @type {JsdocNoEnglishIssue[]} */
	const issues = []
	for (const relativePath of files) {
		const text = await readFile(join(repoRoot, relativePath), 'utf8')
		issues.push(...scanFileJsdocNoEnglish(relativePath, text))
	}
	const hitFiles = [...new Set(issues.map(issue => issue.path))].sort()
	return { files: hitFiles, issues }
}

/**
 * 扫描单文件中「多行 JSDoc 首行 `/**` 后带内容」的块。
 * @param {string} relativePath 相对仓库根
 * @param {string} text 文件内容
 * @returns {JsdocOpeningIssue[]} 命中列表
 */
export function scanFileJsdocOpening(relativePath, text) {
	/** @type {JsdocOpeningIssue[]} */
	const issues = []
	for (const { text: block, startLine } of extractJsdocBlocks(text))
		if (hasInlineJsdocOpening(block))
			issues.push({ path: relativePath, line: startLine })
	return issues
}

/**
 * 扫描仓库中匹配后缀文件的「多行 JSDoc 首行 `/**` 后带内容」问题。
 * @param {string} repoRoot 仓库根
 * @param {{ under?: string, suffixes?: string[] }} [options] 选项
 * @returns {Promise<{ files: string[], issues: JsdocOpeningIssue[] }>} 命中文件路径与问题列表
 */
export async function scanJsdocOpening(repoRoot, options = {}) {
	const suffixes = options.suffixes ?? JSDOC_SCAN_SUFFIXES
	const files = await listRepoFiles(repoRoot, suffixes, { under: options.under })
	/** @type {JsdocOpeningIssue[]} */
	const issues = []
	for (const relativePath of files) {
		const text = await readFile(join(repoRoot, relativePath), 'utf8')
		issues.push(...scanFileJsdocOpening(relativePath, text))
	}
	const hitFiles = [...new Set(issues.map(issue => issue.path))].sort()
	return { files: hitFiles, issues }
}

/**
 * 扫描单文件中「多行 JSDoc 的收尾写在内容行上」的块。
 * @param {string} relativePath 相对仓库根
 * @param {string} text 文件内容
 * @returns {JsdocClosingIssue[]} 命中列表
 */
export function scanFileJsdocClosing(relativePath, text) {
	/** @type {JsdocClosingIssue[]} */
	const issues = []
	for (const { text: block, startLine } of extractJsdocBlocks(text))
		if (hasInlineJsdocClosing(block))
			issues.push({ path: relativePath, line: startLine })
	return issues
}

/**
 * 扫描仓库中匹配后缀文件的「多行 JSDoc 收尾写在内容行上」问题。
 * @param {string} repoRoot 仓库根
 * @param {{ under?: string, suffixes?: string[] }} [options] 选项
 * @returns {Promise<{ files: string[], issues: JsdocClosingIssue[] }>} 命中文件路径与问题列表
 */
export async function scanJsdocClosing(repoRoot, options = {}) {
	const suffixes = options.suffixes ?? JSDOC_SCAN_SUFFIXES
	const files = await listRepoFiles(repoRoot, suffixes, { under: options.under })
	/** @type {JsdocClosingIssue[]} */
	const issues = []
	for (const relativePath of files) {
		const text = await readFile(join(repoRoot, relativePath), 'utf8')
		issues.push(...scanFileJsdocClosing(relativePath, text))
	}
	const hitFiles = [...new Set(issues.map(issue => issue.path))].sort()
	return { files: hitFiles, issues }
}

/**
 * 扫描单文件中「多行 JSDoc 挤在代码之后」的块。
 * @param {string} relativePath 相对仓库根
 * @param {string} text 文件内容
 * @returns {JsdocMidLineIssue[]} 命中列表
 */
export function scanFileJsdocMidLine(relativePath, text) {
	/** @type {JsdocMidLineIssue[]} */
	const issues = []
	for (const { text: block, startLine, linePrefix } of extractJsdocBlocks(text))
		if (isMidLineJsdocOpening(block, linePrefix))
			issues.push({ path: relativePath, line: startLine })
	return issues
}

/**
 * 扫描仓库中匹配后缀文件的「多行 JSDoc 挤在代码之后」问题。
 * @param {string} repoRoot 仓库根
 * @param {{ under?: string, suffixes?: string[] }} [options] 选项
 * @returns {Promise<{ files: string[], issues: JsdocMidLineIssue[] }>} 命中文件路径与问题列表
 */
export async function scanJsdocMidLine(repoRoot, options = {}) {
	const suffixes = options.suffixes ?? JSDOC_SCAN_SUFFIXES
	const files = await listRepoFiles(repoRoot, suffixes, { under: options.under })
	/** @type {JsdocMidLineIssue[]} */
	const issues = []
	for (const relativePath of files) {
		const text = await readFile(join(repoRoot, relativePath), 'utf8')
		issues.push(...scanFileJsdocMidLine(relativePath, text))
	}
	const hitFiles = [...new Set(issues.map(issue => issue.path))].sort()
	return { files: hitFiles, issues }
}

/**
 * 扫描单文件中「含多行 JSDoc 的字面量未展开」的块（含把成员挤在收尾标记行上的情况）。
 * @param {string} relativePath 相对仓库根
 * @param {string} text 文件内容
 * @returns {JsdocLiteralIssue[]} 命中列表
 */
export function scanFileJsdocLiteral(relativePath, text) {
	const lines = text.split(/\r?\n/)
	/** @type {JsdocLiteralIssue[]} */
	const issues = []
	for (const { text: block, startLine, endLine, linePrefix } of extractJsdocBlocks(text)) {
		const closingLine = lines[endLine - 1] ?? ''
		if (hasUnsplitJsdocLiteral(block, linePrefix) || hasJsdocMemberOnClosingLine(block, closingLine.slice(closingLine.lastIndexOf('*/') + 2)))
			issues.push({ path: relativePath, line: startLine })
	}
	return issues
}

/**
 * 扫描仓库中匹配后缀文件的「含多行 JSDoc 的字面量未展开」问题。
 * @param {string} repoRoot 仓库根
 * @param {{ under?: string, suffixes?: string[] }} [options] 选项
 * @returns {Promise<{ files: string[], issues: JsdocLiteralIssue[] }>} 命中文件路径与问题列表
 */
export async function scanJsdocLiteral(repoRoot, options = {}) {
	const suffixes = options.suffixes ?? JSDOC_SCAN_SUFFIXES
	const files = await listRepoFiles(repoRoot, suffixes, { under: options.under })
	/** @type {JsdocLiteralIssue[]} */
	const issues = []
	for (const relativePath of files) {
		const text = await readFile(join(repoRoot, relativePath), 'utf8')
		issues.push(...scanFileJsdocLiteral(relativePath, text))
	}
	const hitFiles = [...new Set(issues.map(issue => issue.path))].sort()
	return { files: hitFiles, issues }
}
