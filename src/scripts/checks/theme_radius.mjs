/**
 * 主题圆角感知检测：主题化前端不得硬编码固定圆角。
 * 覆盖 `src/public/**`（应用本体）与 `.github/pages/**`（GitHub Pages 静态站）。
 * daisyUI 主题用 `--radius-selector` / `--radius-field` / `--radius-box` 表达各自的圆角方案
 * （如 cyberpunk 全为 0，即方形）。
 * 两类违反：
 * - Tailwind 固定圆角类：`rounded` / `rounded-sm/md/lg/xl/2xl/3xl` / `rounded-full`（头像等圆）
 *   及单角前缀变体，应改用 `rounded-selector` / `rounded-field` / `rounded-box`
 *   （或 `rounded-btn` / `rounded-badge` 等主题感知类）。
 * - CSS 直接硬编码 `border-radius: <固定长度>`（未用 `var(--radius-*)` / `var(--rounded-*)`）。
 *   头像等圆形元素也应随主题变化（cyberpunk 下应为方形）。
 */
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

import { listRepoFiles } from './walk.mjs'

/** 主题化前端根：主题化应用本体 + GitHub Pages 静态站。 */
export const THEMED_FRONTEND_ROOTS = Object.freeze(['src/public', '.github/pages'])

/** 扫描的后缀。 */
export const THEME_RADIUS_SUFFIXES = ['.html', '.mjs', '.js', '.css']

/**
 * 被排除的路径：测试夹具 / 测试文件里的类名是样例数据，不是真实 UI。
 * @param {string} relativePath 相对仓库根
 * @returns {boolean} 应排除则为 true
 */
export function isThemeRadiusExcluded(relativePath) {
	return /(?:^|\/)test\//u.test(relativePath) || /\.test\.mjs$/u.test(relativePath)
}

/**
 * 硬编码固定圆角类的正则（无 `g` 标志，供 `.test()` 等无状态使用）。
 * 捕获：裸 `rounded`（0.25rem）、`rounded-xs/sm/md/lg/xl/2xl/3xl/4xl`、
 * 单角前缀（`rounded-t-lg` / `rounded-l-md` 等），以及 `rounded-full`（头像等圆）
 * —— 这些都用固定值无视主题圆角方案，应改用主题感知类 `rounded-selector/field/box/btn/badge`。
 * 允许（不命中）：`rounded-none`（显式方形）及主题感知类。
 * @type {RegExp}
 */
export const HARDCODED_RADIUS_PATTERN =
	/rounded-(?:(?:tl|tr|bl|br|t|b|l|r)-)?(?:xs|sm|md|lg|xl|2xl|3xl|4xl|full)\b|\brounded(?![-\w])/u

/** 带 `g` 标志的扫描用正则（`matchAll` 需要）。 */
const HARDCODED_RADIUS_GLOBAL = new RegExp(HARDCODED_RADIUS_PATTERN.source, 'gu')

/**
 * 判断文本是否包含硬编码固定圆角类。
 * @param {string} text 目标文本
 * @returns {boolean} 包含则为 true
 */
export function hasHardcodedRadius(text) {
	HARDCODED_RADIUS_PATTERN.lastIndex = 0
	return HARDCODED_RADIUS_PATTERN.test(text)
}

/**
 * @typedef {{ path: string, line: number, token: string }} ThemeRadiusIssue 命中条目
 */

/** CSS 声明中 `border-radius:` 的固定值：非 `var(--radius-*)` / `var(--rounded-*)` 的长度（px/rem/em/%…）。 */
const CSS_BORDER_RADIUS_RE =
	/border-radius\s*:\s*(?![^;}]*var\(\s*--(?:radius|rounded)-)[0-9.]+(?:px|rem|em|%)\b[^;}]*/gu

/**
 * 扫描单文件内容中的硬编码固定圆角。
 * @param {string} relativePath 相对仓库根
 * @param {string} content 文件文本
 * @returns {ThemeRadiusIssue[]} 命中条目
 */
export function scanFileThemeRadius(relativePath, content) {
	/** @type {ThemeRadiusIssue[]} */
	const issues = []
	const lines = content.split('\n')
	for (let index = 0; index < lines.length; index++) {
		for (const match of lines[index].matchAll(HARDCODED_RADIUS_GLOBAL))
			issues.push({ path: relativePath, line: index + 1, token: match[0] })
		for (const match of lines[index].matchAll(CSS_BORDER_RADIUS_RE))
			issues.push({ path: relativePath, line: index + 1, token: match[0].trim() })
	}
	return issues
}

/**
 * 扫描主题化前端中的硬编码固定圆角类（全量）。
 * @param {string} repoRoot 仓库根
 * @returns {Promise<{ files: string[], issues: ThemeRadiusIssue[] }>} 命中文件与问题列表
 */
export async function scanThemeRadius(repoRoot) {
	const paths = (await Promise.all(
		THEMED_FRONTEND_ROOTS.map(under => listRepoFiles(repoRoot, THEME_RADIUS_SUFFIXES, { under })),
	)).flat()
		.filter(path => !isThemeRadiusExcluded(path))
	/** @type {ThemeRadiusIssue[]} */
	const issues = []
	for (const relativePath of paths) {
		let content
		try {
			content = await readFile(join(repoRoot, relativePath), 'utf8')
		}
		catch (error) {
			if (error?.code === 'ENOENT') continue
			throw error
		}
		issues.push(...scanFileThemeRadius(relativePath, content))
	}
	return { files: [...new Set(issues.map(issue => issue.path))].sort(), issues }
}
