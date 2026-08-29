/**
 * 主题颜色感知检测：主题化前端不得用「自定义变量 + 硬编码颜色 fallback」兜底未主题化样式。
 * 覆盖 `src/public/**`（应用本体）与 `.github/pages/**`（GitHub Pages 静态站），
 * 与 `theme_radius.mjs` 同范围（复用其根 / 后缀 / 排除）。
 * daisyUI 主题用 `--color-*`（如 `--color-base-100` / `--color-base-content` / `--color-primary`）
 * 表达配色，`--radius-*` / `--rounded-*` / `--border` 表达圆角与边框。
 * 违反形态：
 * - `var(--bg-panel, #1e1e1e)` 这类 `var(<自定义变量>, <硬编码颜色>)`：
 *   自定义变量（如 `--bg-panel` / `--bg-hover` / 仅在个别页面定义的 `--text-normal`）不一定存在，
 *   一旦未定义即回退到写死的颜色——且这些 fallback 几乎都是深色主题的值，
 *   light 主题下就会露出「纯灰 + 黑字」的未主题化样式（如 emoji-pack-preview 卡）。
 *   fallback 应为主题变量（`var(--text-muted, var(--color-base-content))`）或直接去掉。
 * - 仅 `var()` 的 fallback 值为硬编码颜色时命中；主变量是主题变量（`--color-*` / `--radius-*` /
 *   `--rounded-*` / `--border`）时视为安全，fallback 通常永不生效。
 * 豁免：
 * - `*.user.js`：userscript 运行在外部网站（无 daisyUI 主题环境），写死颜色即其「主题」，不算主题化前端。
 * - 上一行为 `/* theme-color-ignore *&#47;` 时跳过下一行（对齐 `theme-radius-ignore` 指令）。
 */
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

import { isThemeRadiusExcluded, THEMED_FRONTEND_ROOTS, THEME_RADIUS_SUFFIXES } from './theme_radius.mjs'
import { listRepoFiles } from './walk.mjs'

/** 扫描的后缀（与 theme_radius 一致）。 */
export const THEME_COLOR_SUFFIXES = THEME_RADIUS_SUFFIXES

/**
 * 被排除的路径：theme_radius 的排除 + `*.user.js`（无主题环境 userscript）。
 * @param {string} relativePath 相对仓库根
 * @returns {boolean} 应排除则为 true
 */
export function isThemeColorExcluded(relativePath) {
	return isThemeRadiusExcluded(relativePath) || /\.user\.js$/u.test(relativePath)
}

/**
 * 主题变量判定：`var()` 主变量是 daisyUI 主题颜色变量（`--color-*`）或主题边框宽度变量
 * （`--border`）时，fallback 里的颜色视为保险丝，不构成未主题化。
 * 注意 `--border-color`、`--radius-sm` 等 fount 页面局部变量不在其列——它们只在本页定义，
 * 跨页即失效，写死颜色 fallback 同样漏出未主题化样式。
 * `--radius-*` / `--rounded-*` 承载圆角值而非颜色，颜色 fallback 挂在上面属怪异写法，
 * 统一按自定义变量处理（命中即上报）。
 * @param {string} prop CSS 变量名（含 `--` 前缀）
 * @returns {boolean} 主题变量则为 true
 */
export function isThemeColorVar(prop) {
	return /^--color-/u.test(prop) || prop === '--border'
}

/**
 * 硬编码颜色字面量：十六进制、`rgb(a)` / `hsl(a)` / `hwb` / `oklch` / `oklab` / `lab` / `lch` 函数，
 * 以及黑白关键字（最常见的写死色）。`transparent` / `none` 不算颜色。
 * `color-mix(...)` 内部残留的字面色（如 `#1e1e1e`）由上述 hex / 函数分支自然覆盖。
 */
const HARDCODED_COLOR_RE =
	/#[0-9a-fA-F]{3,8}\b|rgba?\(|hsla?\(|hwb\(|oklch\(|oklab\(|lab\(|lch\(|(?<![\w-])(?:white|black)\b/u

/**
 * 判断文本是否含硬编码颜色字面量。
 * 直接检测 fallback 文本即可——纯主题变量引用（`var(--color-base-content)`）与
 * 全主题变量的 `color-mix(...)` 不含字面色，不会误伤。
 * @param {string} text 目标文本（var fallback 值）
 * @returns {boolean} 含硬编码颜色则为 true
 */
export function containsHardcodedColor(text) {
	HARDCODED_COLOR_RE.lastIndex = 0
	return HARDCODED_COLOR_RE.test(text)
}

/** `var(--prop, ` 形式（捕获完整变量名含 `--`，`g` 标志扫描用）。 */
const VAR_FALLBACK_RE = /var\(\s*(--[\w-]+)\s*,/gu

/** 跳过指令：上一行恰好是 `/* theme-color-ignore *&#47;` 注释时，跳过下一行的硬编码颜色 fallback。 */
const THEME_COLOR_IGNORE_DIRECTIVE = /^\s*\/\*\s*theme-color-ignore\s*\*\/\s*$/u

/**
 * @typedef {{ path: string, line: number, token: string }} ThemeColorIssue 命中条目
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
 * 从 `var(--prop,` 匹配处提取 fallback 文本与整个 `var(...)` 的结束偏移。
 * 用括号深度扫描处理嵌套 `var()` / `color-mix()` / `calc()` 等。
 * @param {string} content 文件文本
 * @param {RegExpExecArray} match VAR_FALLBACK_RE 的匹配
 * @returns {{ fallback: string, end: number }} fallback 文本与 `var()` 结束偏移
 */
function varFallbackAt(content, match) {
	let depth = 1
	let index = match.index + match[0].length
	const start = index
	for (; index < content.length; index++) 
		if (content[index] === '(') depth++
		else if (content[index] === ')') {
			depth--
			if (depth === 0) break
		}
	
	return { fallback: content.slice(start, index), end: index }
}

/**
 * 扫描单文件内容中未主题化的硬编码颜色 fallback。
 * @param {string} relativePath 相对仓库根
 * @param {string} content 文件文本
 * @returns {ThemeColorIssue[]} 命中条目
 */
export function scanFileThemeColor(relativePath, content) {
	/** @type {ThemeColorIssue[]} */
	const issues = []
	const lines = content.split('\n')
	const ignoredLines = new Set()
	for (let index = 0; index < lines.length - 1; index++)
		if (THEME_COLOR_IGNORE_DIRECTIVE.test(lines[index])) ignoredLines.add(index + 2)
	for (const match of content.matchAll(VAR_FALLBACK_RE)) {
		const prop = match[1]
		if (isThemeColorVar(prop)) continue
		const { fallback, end } = varFallbackAt(content, match)
		if (!containsHardcodedColor(fallback)) continue
		const line = lineNumberAt(content, match.index)
		if (ignoredLines.has(line)) continue
		issues.push({ path: relativePath, line, token: content.slice(match.index, end + 1).replaceAll('\n', ' ').replace(/\s+/g, ' ').trim() })
	}
	return issues
}

/**
 * 扫描主题化前端中未主题化的硬编码颜色 fallback（全量）。
 * @param {string} repoRoot 仓库根
 * @returns {Promise<{ files: string[], issues: ThemeColorIssue[] }>} 命中文件与问题列表
 */
export async function scanThemeColor(repoRoot) {
	/** @type {ThemeColorIssue[]} */
	const issues = []
	for (const relativePath of (await Promise.all(
		THEMED_FRONTEND_ROOTS.map(under => listRepoFiles(repoRoot, THEME_COLOR_SUFFIXES, { under })),
	)).flat()
		.filter(path => !isThemeColorExcluded(path))) {
		let content
		try {
			content = await readFile(join(repoRoot, relativePath), 'utf8')
		}
		catch (error) {
			if (error?.code === 'ENOENT') continue
			throw error
		}
		issues.push(...scanFileThemeColor(relativePath, content))
	}
	return { files: [...new Set(issues.map(issue => issue.path))].sort(), issues }
}
