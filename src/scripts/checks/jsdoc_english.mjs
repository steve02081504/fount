/**
 * 扫描源码中的纯英文 JSDoc 摘要（含字母、无 CJK）。
 */
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

import { CJK_RE } from './agents_md_english.mjs'
import { listRepoFiles } from './walk.mjs'

/** 源码后缀。 */
export const JSDOC_SCAN_SUFFIXES = Object.freeze(['.mjs', '.js', '.ts'])

/** 摘要行视为「无描述」的 @ 标签前缀。 */
const TAG_ONLY_PREFIX = /^@(typedef|type|template|augments|extends|implements|memberof|see|link|example|default|deprecated|ignore|internal|private|protected|public|readonly|override|inheritdoc|satisfies|import)\b/

const ASCII_LETTER_RE = /[a-zA-Z]/

/**
 * 从源码文本中提取 JSDoc 块（含起止行号）。
 * 仅匹配行首（或前置空白）的 `/**`，避免命中字符串/行内注释。
 * @param {string} text 源码
 * @returns {{ text: string, startLine: number, endLine: number }[]} 块列表
 */
export function extractJsdocBlocks(text) {
	/** @type {{ text: string, startLine: number, endLine: number }[]} */
	const blocks = []
	const re = /(^|\n)([ \t]*)\/\*\*/g
	let match
	while ((match = re.exec(text)) !== null) {
		const start = match.index + match[1].length + match[2].length
		const end = text.indexOf('*/', start + 3)
		if (end < 0) break
		const blockText = text.slice(start, end + 2)
		const startLine = text.slice(0, start).split(/\r?\n/).length
		const endLine = text.slice(0, end + 2).split(/\r?\n/).length
		blocks.push({ text: blockText, startLine, endLine })
		re.lastIndex = end + 2
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
 * @returns {boolean}
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
 * @param {string} block JSDoc 块
 * @returns {boolean}
 */
export function isTagOnlyJsdoc(block) {
	const summary = jsdocSummaryLines(block)
	if (summary.length) return false
	const inner = block.slice(3, -2)
	for (const raw of inner.split(/\r?\n/)) {
		const trimmed = raw.replace(/^\s*\*\s?/, '').trim()
		if (!trimmed || !trimmed.startsWith('@')) continue
		if (TAG_ONLY_PREFIX.test(trimmed)) continue
		if (/^@(param|returns?|throws?|yields?)\b/.test(trimmed)) continue
		return false
	}
	return true
}

/**
 * @typedef {{ path: string, line: number, summary: string, missingSummary: boolean }} JsdocEnglishIssue
 */

/**
 * 扫描单文件中的英文 JSDoc。
 * @param {string} relativePath 相对仓库根
 * @param {string} text 文件内容
 * @returns {JsdocEnglishIssue[]} 命中列表
 */
export function scanFileJsdocEnglish(relativePath, text) {
	void relativePath
	/** @type {JsdocEnglishIssue[]} */
	const issues = []
	for (const { text: block, startLine } of extractJsdocBlocks(text)) {
		const summary = jsdocSummaryLines(block)
		const missingSummary = summary.length === 0 && !isTagOnlyJsdoc(block)
			&& /\n\s*\*\s*@(param|returns?|property)\b/.test(block)
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
 * @returns {Promise<{ files: string[], issues: JsdocEnglishIssue[] }>}
 */
export async function scanJsdocEnglish(repoRoot, options = {}) {
	const suffixes = options.suffixes ?? JSDOC_SCAN_SUFFIXES
	const files = await listRepoFiles(repoRoot, suffixes, { under: options.under })
	/** @type {JsdocEnglishIssue[]} */
	const issues = []
	for (const relativePath of files) {
		const text = await readFile(join(repoRoot, relativePath), 'utf8')
		issues.push(...scanFileJsdocEnglish(relativePath, text))
	}
	const hitFiles = [...new Set(issues.map(issue => issue.path))].sort()
	return { files: hitFiles, issues }
}
