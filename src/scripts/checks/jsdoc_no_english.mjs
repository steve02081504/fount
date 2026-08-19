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
 * 从源码文本中提取 JSDoc 块（含起止行号）。
 * 匹配任意位置的 `/**`（含行内对象字面量前的注释），并跳过字符串/模板/普通注释内的伪 JSDoc。
 * @param {string} text 源码
 * @returns {{ text: string, startLine: number, endLine: number }[]} 块列表
 */
export function extractJsdocBlocks(text) {
	/** @type {{ text: string, startLine: number, endLine: number }[]} */
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
		blocks.push({ text: blockText, startLine, endLine })
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
 * @typedef {{ path: string, line: number, summary: string, missingSummary: boolean }} JsdocNoEnglishIssue
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
