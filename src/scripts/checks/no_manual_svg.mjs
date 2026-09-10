/**
 * 手动 SVG 定义检测：主题化前端的 HTML / JS / TS / CSS 字符串不得内联手写 `<svg>` 图形
 * （图标一律用 Iconify CDN，交由 `svgInliner` 内联并随主题着色）。
 * 覆盖 `src/public/**`（应用本体）与 `.github/pages/**`（GitHub Pages 静态站），
 * 与 `theme_radius.mjs` 同范围（复用其根 / 后缀 / 排除）。
 * 命中形态：完整的内联 SVG 元素——`<svg …>` 开标签后紧跟子元素（`<path>` / `<rect>` /
 * `<circle>` / `<g>` 等），即"手动画的"图形。仅作字符串改写 / 正则匹配的
 * `<svg` 片段（`replace('<svg', …)`、`/<svg\b/`）以及 mermaid 之类的模板包装
 * （`<svg id="${id}">${html}</svg>`，`>` 后是插值而非子元素）不算定义。
 * 豁免：
 * - 注释内容（块注释 / 行注释 / HTML 注释）不扫描。
 * - 上一行为 `/* no-manual-svg-ignore *&#47;` 时跳过下一行。
 */
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

import { isThemeRadiusExcluded, THEMED_FRONTEND_ROOTS } from './theme_radius.mjs'
import { listRepoFiles } from './walk.mjs'

/** 扫描的后缀（含 css：`data:image/svg+xml` 里的手写图形同样命中）。 */
export const NO_MANUAL_SVG_SUFFIXES = ['.html', '.mjs', '.js', '.ts', '.css']

/**
 * 命中形态正则（无 `g` 标志，供 `.test()` 无状态使用）。
 * `<svg(?:\s[^>]*)?>` 要求 `svg` 后是空白+属性或直接闭合，避免命中 `<svg-foo>`；
 * `\s*<[A-Za-z]` 要求开标签后紧跟子元素——只匹配完整的手写图形，不匹配
 * `<svg id="${id}">${html}</svg>` 之类的模板包装或 `'<svg'` 片段。
 */
export const MANUAL_SVG_PATTERN = /<svg(?:\s[^>]*)?>\s*<[A-Za-z]/u

/** 带 `g` 标志的扫描用正则（`matchAll` 需要）。 */
const MANUAL_SVG_GLOBAL = new RegExp(MANUAL_SVG_PATTERN.source, 'gu')

/** 跳过指令：上一行恰好是 `/* no-manual-svg-ignore *&#47;` 注释时，跳过下一行的命中。 */
const NO_MANUAL_SVG_IGNORE_DIRECTIVE = /^\s*\/\*\s*no-manual-svg-ignore\s*\*\/\s*$/u

/**
 * 被排除的路径：与 theme_radius 完全一致（测试夹具 / 测试文件 / `.php.html` 诱饵页）。
 * @param {string} relativePath 相对仓库根
 * @returns {boolean} 应排除则为 true
 */
export function isNoManualSvgExcluded(relativePath) {
	return isThemeRadiusExcluded(relativePath)
}

/**
 * 剥离注释并保留换行/长度，使匹配偏移对应的行号与原文一致。
 * `.mjs` / `.js` / `.ts` 额外剥离 `//` 行注释（CSS 中 `//` 不合法，故不剥，
 * 以免破坏 `url(https://…)`）。
 * @param {string} relativePath 相对仓库根
 * @param {string} content 文件文本
 * @returns {string} 注释内容替换为空白（保留换行）后的文本
 */
function stripComments(relativePath, content) {
	let text = content
	if (/\.(?:mjs|js|ts)$/u.test(relativePath))
		text = text.replace(/\/\/[^\n\r]*/gu, match => match.replace(/[^\n]/gu, ' '))
	return text
		.replace(/\/\*[\s\S]*?\*\//gu, match => match.replace(/[^\n]/gu, ' '))
		.replace(/<!--[\s\S]*?-->/gu, match => match.replace(/[^\n]/gu, ' '))
}

/**
 * @typedef {{ path: string, line: number, token: string }} NoManualSvgIssue 命中条目
 */

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
 * 扫描单文件内容中的手动 SVG 定义。
 * @param {string} relativePath 相对仓库根
 * @param {string} content 文件文本
 * @returns {NoManualSvgIssue[]} 命中条目
 */
export function scanFileManualSvg(relativePath, content) {
	/** @type {NoManualSvgIssue[]} */
	const issues = []
	const lines = content.split('\n')
	const ignoredLines = new Set()
	for (let index = 0; index < lines.length - 1; index++)
		if (NO_MANUAL_SVG_IGNORE_DIRECTIVE.test(lines[index])) ignoredLines.add(index + 2)
	for (const match of stripComments(relativePath, content).matchAll(MANUAL_SVG_GLOBAL)) {
		const line = lineNumberAt(content, match.index)
		if (ignoredLines.has(line)) continue
		issues.push({ path: relativePath, line, token: match[0] })
	}
	return issues
}

/**
 * 扫描主题化前端中的手动 SVG 定义（全量）。
 * @param {string} repoRoot 仓库根
 * @returns {Promise<{ files: string[], issues: NoManualSvgIssue[] }>} 命中文件与问题列表
 */
export async function scanManualSvg(repoRoot) {
	/** @type {NoManualSvgIssue[]} */
	const issues = []
	for (const relativePath of (await Promise.all(
		THEMED_FRONTEND_ROOTS.map(under => listRepoFiles(repoRoot, NO_MANUAL_SVG_SUFFIXES, { under })),
	)).flat()
		.filter(path => !isNoManualSvgExcluded(path))) {
		let content
		try {
			content = await readFile(join(repoRoot, relativePath), 'utf8')
		}
		catch (error) {
			if (error?.code === 'ENOENT') continue
			throw error
		}
		issues.push(...scanFileManualSvg(relativePath, content))
	}
	return { files: [...new Set(issues.map(issue => issue.path))].sort(), issues }
}
