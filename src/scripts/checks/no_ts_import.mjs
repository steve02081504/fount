/**
 * 本地 `.ts` 运行时导入检测：`.mjs` / `.js` 不得 import 仓库内的 `.ts` 文件。
 *
 * fount 项目约定：`.ts` 只作为 JSDoc 类型声明使用，实际逻辑一律由 `.mjs` / `.js` 承担。
 * 因此 `.ts` 里不应存在被 `.mjs` / `.js` 运行时 import 的常量、谓词或工厂；
 * 这类运行时语义应挪进 `.mjs` / `.js`。类型引用不受影响——JSDoc `{import('./x.ts')}`、
 * 注释、字符串里的说明文本都会被排除；远程 URL（`https://…/mod.ts`）与
 * `npm:` / `jsr:` / `node:` 说明符不属本仓，不纳入。
 */
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

import { listRepoFiles } from './walk.mjs'

/** 扫描的源码后缀。 */
export const NO_TS_IMPORT_SUFFIXES = ['.mjs', '.js']

/** 带 URL scheme 的说明符（`https:` / `npm:` / `jsr:` / `node:` …），非本仓文件。 */
const SPECIFIER_SCHEME = /^[a-zA-Z][a-zA-Z0-9+.-]*:/u

/** 语句形式的 `.ts` 说明符（`from` / 静态 `import` / 动态 `import()`）。 */
const TS_SPECIFIER = /(?:\bfrom\s*|\bimport\s*\(\s*|\bimport\s+)(['"])([^'"\n]*\.ts)\1/gu

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
 * 跳过引号字符串（`'` / `"` / 反引号，含转义），返回结束引号后的偏移。
 * @param {string[]} chars 文件字符数组
 * @param {number} index 起始引号偏移
 * @returns {number} 结束后的偏移
 */
function skipQuoted(chars, index) {
	const quote = chars[index]
	const len = chars.length
	let i = index + 1
	while (i < len) {
		if (chars[i] === '\\') { i += 2; continue }
		if (chars[i] === quote) return i + 1
		i++
	}
	return i
}

/**
 * 掩掉注释（保持偏移），并记录字符串区间，避免把字符串文本误判为 import 语句。
 * @param {string} content 文件文本
 * @returns {{ masked: string, stringSpans: [number, number][] }} 掩码文本与字符串区间
 */
function maskComments(content) {
	const chars = content.split('')
	const len = chars.length
	/** @type {[number, number][]} */
	const stringSpans = []
	let i = 0
	while (i < len) {
		const ch = chars[i]
		if (ch === '/' && chars[i + 1] === '/') {
			let j = i
			while (j < len && chars[j] !== '\n') { chars[j] = ' '; j++ }
			i = j
		}
		else if (ch === '/' && chars[i + 1] === '*') {
			chars[i] = ' '
			chars[i + 1] = ' '
			let j = i + 2
			while (j < len && !(chars[j] === '*' && chars[j + 1] === '/')) { chars[j] = ' '; j++ }
			if (j < len) { chars[j] = ' '; chars[j + 1] = ' '; j += 2 }
			i = j
		}
		else if (ch === '\'' || ch === '"' || ch === '`') {
			const start = i
			i = skipQuoted(chars, i)
			stringSpans.push([start, i])
		}
		else i++
	}
	return { masked: chars.join(''), stringSpans }
}

/**
 * 偏移是否落在某个字符串区间内。
 * @param {number} index 偏移
 * @param {[number, number][]} spans 字符串区间
 * @returns {boolean} 在字符串内则为 true
 */
function isInsideSpans(index, spans) {
	return spans.some(([start, end]) => index >= start && index < end)
}

/**
 * 说明符是否指向本仓文件（无 URL / 包管理器 scheme）。
 * @param {string} specifier 导入说明符
 * @returns {boolean} 本仓文件则为 true
 */
export function isLocalRepoSpecifier(specifier) {
	return !SPECIFIER_SCHEME.test(specifier)
}

/**
 * @typedef {{ path: string, line: number, specifier: string }} NoTsImportIssue 命中条目
 */

/**
 * 扫描单文件内容中的本地 `.ts` 运行时导入。
 * @param {string} relativePath 相对仓库根
 * @param {string} content 文件文本
 * @returns {NoTsImportIssue[]} 命中条目
 */
export function scanFileNoTsImport(relativePath, content) {
	const { masked, stringSpans } = maskComments(content)
	/** @type {NoTsImportIssue[]} */
	const issues = []
	for (const match of masked.matchAll(TS_SPECIFIER)) {
		if (isInsideSpans(match.index, stringSpans)) continue
		const specifier = match[2]
		if (!isLocalRepoSpecifier(specifier)) continue
		issues.push({ path: relativePath, line: lineNumberAt(content, match.index), specifier })
	}
	return issues
}

/**
 * 扫描仓库中 `.mjs` / `.js` 对本地 `.ts` 的运行时导入（全量）。
 * @param {string} repoRoot 仓库根
 * @returns {Promise<{ files: string[], issues: NoTsImportIssue[] }>} 命中文件与问题列表
 */
export async function scanNoTsImport(repoRoot) {
	/** @type {NoTsImportIssue[]} */
	const issues = []
	for (const relativePath of await listRepoFiles(repoRoot, NO_TS_IMPORT_SUFFIXES)) {
		let content
		try {
			content = await readFile(join(repoRoot, relativePath), 'utf8')
		}
		catch (error) {
			if (error?.code === 'ENOENT') continue
			throw error
		}
		issues.push(...scanFileNoTsImport(relativePath, content))
	}
	return { files: [...new Set(issues.map(issue => issue.path))].sort(), issues }
}
