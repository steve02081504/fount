/**
 * daisyUI 语义变量缩写检测：主题化前端必须使用语义变量的全拼（`--color-*`），
 * 不得使用 daisyUI v4 的缩写名（`--b1` / `--b2` / `--b3` / `--bc` / `--p` / `--wa` 等）。
 * 覆盖 `src/public/**`（应用本体）与 `.github/pages/**`（GitHub Pages 静态站），
 * 与 `theme_radius.mjs` 同范围（复用其根 / 后缀 / 排除）。
 * daisyUI 5 主题变量统一为 `--color-*` 全称；v4 缩写名在 v5 下仅是兼容别名，
 * 组件已改用 `--color-*`，手写缩写（尤其自定义主题 fallback）即静默失效，
 * 统一写全拼。映射（v4 → v5）：
 * - `--b1` / `--b2` / `--b3` / `--bc` → `--color-base-100` / `--color-base-200` / `--color-base-300` / `--color-base-content`
 * - `--p` / `--pc` → `--color-primary` / `--color-primary-content`
 * - `--s` / `--sc` → `--color-secondary` / `--color-secondary-content`
 * - `--a` / `--ac` → `--color-accent` / `--color-accent-content`
 * - `--n` / `--nc` → `--color-neutral` / `--color-neutral-content`
 * - `--in` / `--inc` → `--color-info` / `--color-info-content`
 * - `--su` / `--suc` → `--color-success` / `--color-success-content`
 * - `--wa` / `--wac` → `--color-warning` / `--color-warning-content`
 * - `--er` / `--erc` → `--color-error` / `--color-error-content`
 * 豁免：
 * - 注释内容（块注释 / 行注释 / HTML 注释）不扫描——文档里出现 `var(--bc)` 等说明文字不算真实代码。
 * - 上一行为 `/* daisyui-var-ignore *&#47;` 时跳过下一行（对齐 `theme-radius-ignore` 指令）。
 */
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

import { isThemeRadiusExcluded, THEMED_FRONTEND_ROOTS, THEME_RADIUS_SUFFIXES } from './theme_radius.mjs'
import { listRepoFiles } from './walk.mjs'

/** 扫描的后缀（与 theme_radius 一致）。 */
export const DAISYUI_VAR_SUFFIXES = THEME_RADIUS_SUFFIXES

/** daisyUI v4 缩写 → v5 全拼 映射表。 */
export const DAISYUI_VAR_FULL_NAMES = Object.freeze({
	'--b1': '--color-base-100',
	'--b2': '--color-base-200',
	'--b3': '--color-base-300',
	'--bc': '--color-base-content',
	'--p': '--color-primary',
	'--pc': '--color-primary-content',
	'--s': '--color-secondary',
	'--sc': '--color-secondary-content',
	'--a': '--color-accent',
	'--ac': '--color-accent-content',
	'--n': '--color-neutral',
	'--nc': '--color-neutral-content',
	'--in': '--color-info',
	'--inc': '--color-info-content',
	'--su': '--color-success',
	'--suc': '--color-success-content',
	'--wa': '--color-warning',
	'--wac': '--color-warning-content',
	'--er': '--color-error',
	'--erc': '--color-error-content',
})

/**
 * 被排除的路径：与 theme_radius 完全一致（测试夹具 / 测试文件 / `.php.html` 诱饵页）。
 * @param {string} relativePath 相对仓库根
 * @returns {boolean} 应排除则为 true
 */
export function isDaisyuiVarExcluded(relativePath) {
	return isThemeRadiusExcluded(relativePath)
}

const ABBR_ALTERNATION = Object.keys(DAISYUI_VAR_FULL_NAMES)
	.map(name => name.slice(2))
	.sort((a, b) => b.length - a.length)
	.join('|')

/**
 * 命中形态：`var(--缩写` 引用，或 `--缩写:` 定义 / 内联赋值。
 * `\b` 保证不命中 `--padding` / `--primary` / `--border` 等长名（缩写后紧跟单词字符即非边界）。
 */
const ABBR_VAR_RE = new RegExp(
	`(?:var\\(\\s*)(--(?:${ABBR_ALTERNATION}))\\b|(?<![\\w-])(--(?:${ABBR_ALTERNATION}))\\b\\s*:`,
	'gu',
)

/** 跳过指令：上一行恰好是 `/* daisyui-var-ignore *&#47;` 注释时，跳过下一行的缩写变量。 */
const DAISYUI_VAR_IGNORE_DIRECTIVE = /^\s*\/\*\s*daisyui-var-ignore\s*\*\/\s*$/u

/**
 * 剥离注释并保留换行/长度，使匹配偏移对应的行号与原文一致。
 * `.mjs` / `.js` / `.ts` 额外剥离 `//` 行注释（CSS 中 `//` 不合法，故不剥，
 * 以免破坏 `url(https://…)`；HTML 内联 `<script>` 的行注释暂不处理）。
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
 * @typedef {{ path: string, line: number, token: string, abbr: string, full: string }} DaisyuiVarIssue 命中条目
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
 * 扫描单文件内容中的 daisyUI 语义变量缩写。
 * @param {string} relativePath 相对仓库根
 * @param {string} content 文件文本
 * @returns {DaisyuiVarIssue[]} 命中条目
 */
export function scanFileDaisyuiVar(relativePath, content) {
	/** @type {DaisyuiVarIssue[]} */
	const issues = []
	const text = stripComments(relativePath, content)
	const lines = content.split('\n')
	const ignoredLines = new Set()
	for (let index = 0; index < lines.length - 1; index++)
		if (DAISYUI_VAR_IGNORE_DIRECTIVE.test(lines[index])) ignoredLines.add(index + 2)
	for (const match of text.matchAll(ABBR_VAR_RE)) {
		const abbr = match[1] ?? match[2]
		const line = lineNumberAt(content, match.index)
		if (ignoredLines.has(line)) continue
		issues.push({ path: relativePath, line, token: match[0].trim(), abbr, full: DAISYUI_VAR_FULL_NAMES[abbr] })
	}
	return issues
}

/**
 * 扫描主题化前端中的 daisyUI 语义变量缩写（全量）。
 * @param {string} repoRoot 仓库根
 * @returns {Promise<{ files: string[], issues: DaisyuiVarIssue[] }>} 命中文件与问题列表
 */
export async function scanDaisyuiVar(repoRoot) {
	/** @type {DaisyuiVarIssue[]} */
	const issues = []
	for (const relativePath of (await Promise.all(
		THEMED_FRONTEND_ROOTS.map(under => listRepoFiles(repoRoot, DAISYUI_VAR_SUFFIXES, { under })),
	)).flat()
		.filter(path => !isDaisyuiVarExcluded(path))) {
		let content
		try {
			content = await readFile(join(repoRoot, relativePath), 'utf8')
		}
		catch (error) {
			if (error?.code === 'ENOENT') continue
			throw error
		}
		issues.push(...scanFileDaisyuiVar(relativePath, content))
	}
	return { files: [...new Set(issues.map(issue => issue.path))].sort(), issues }
}
