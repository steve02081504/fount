/**
 * 主题样式感知检测：主题化前端不得硬编码受主题控制的圆角 / 边框宽度。
 * 覆盖 `src/public/**`（应用本体）与 `.github/pages/**`（GitHub Pages 静态站）。
 * daisyUI 主题用 `--radius-selector` / `--radius-field` / `--radius-box` 表达圆角方案、
 * `--border` 表达边框宽度（如 cyberpunk 圆角全为 0，即方形）。
 * 违反种类：
 * - Tailwind 固定圆角类：`rounded` / `rounded-sm/md/lg/xl/2xl/3xl` / `rounded-full`（头像等圆）
 *   及单角前缀变体，应改用 `rounded-selector` / `rounded-field` / `rounded-box`
 *   （或 `rounded-btn` / `rounded-badge` 等主题感知类）。
 * - CSS 直接硬编码 `border-radius: <固定长度>`（未用 `var(--radius-*)` / `var(--rounded-*)`）。
 * - 自定义硬编码圆角变量 `--radius-*: <固定长度>`：另立圆角体系，消费者 `var(--radius-md)`
 *   即绕过主题（如 chat `vars.css` 的 `--radius-sm/md/lg`），应改用 `var(--radius-box)` 等。
 * - CSS 硬编码边框宽度 `border: <px>` / `border-<侧>: <px>` / `border-width: <px>`：绕过 `--border`。
 */
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

import { listRepoFiles } from './walk.mjs'

/** 主题化前端根：主题化应用本体 + GitHub Pages 静态站。 */
export const THEMED_FRONTEND_ROOTS = Object.freeze(['src/public', '.github/pages'])

/** 扫描的后缀。 */
export const THEME_RADIUS_SUFFIXES = ['.html', '.mjs', '.js', '.css']

/**
 * 被排除的路径：测试夹具 / 测试文件里的类名是样例数据，不是真实 UI；
 * `.php.html` 是 PHP 诱饵页（`src/server/web_server/php_decoy.mjs` 用静态 HTML 响应对应 `.php` 请求），
 * 非主题化前端页面（与 html_meta 等检查一致排除）。
 * @param {string} relativePath 相对仓库根
 * @returns {boolean} 应排除则为 true
 */
export function isThemeRadiusExcluded(relativePath) {
	return /(?:^|\/)test\//u.test(relativePath)
		|| /\.test\.mjs$/u.test(relativePath)
		|| /\.php\.html$/u.test(relativePath)
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
 * 自定义 `--radius-*: <固定长度>` 变量定义。
 * daisyUI 主题用 `--radius-selector/field/box` 表达圆角方案；自定义 `--radius-md: 10px` 等
 * 会另立一套硬编码圆角体系（如 chat `vars.css` 的 `--radius-sm/md/lg`），消费者 `var(--radius-md)`
 * 即绕过主题。主题感知写法应为 `--radius-md: var(--radius-box)`。
 */
const CUSTOM_RADIUS_VAR_RE = /--radius-[a-zA-Z0-9-]+\s*:\s*[0-9.]+(?:px|rem|em|%)\b/gu

/**
 * 硬编码边框宽度（绕过主题 `--border`）：
 * `border: <长度>` / `border-<侧>: <长度>` / `border-width: <长度>`（不含 `border-radius`）。
 */
const HARDCODED_BORDER_WIDTH_RE =
	/border(?:-(?:top|right|bottom|left|width))?\s*:\s*[0-9]+(?:\.[0-9]+)?px\b/gu

/**
 * 跳过指令：上一行出现 `theme-radius-ignore` 时跳过下一行，用于放行有意的粗边框 / 大圆角。
 * 唯一指令形式，仅管下一行。参考 ESLint 下一行禁用注释。
 * @type {RegExp}
 */
const RADIUS_IGNORE_DIRECTIVE = /theme-radius-ignore/u

/**
 * 判断某行是否声明了对下一行的忽略。
 * @param {string} line 行文本
 * @returns {boolean} 命中则为 true
 */
function isNextLineIgnored(line) {
	return RADIUS_IGNORE_DIRECTIVE.test(line)
}

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
		if (isNextLineIgnored(lines[index - 1])) continue
		for (const match of lines[index].matchAll(HARDCODED_RADIUS_GLOBAL))
			issues.push({ path: relativePath, line: index + 1, token: match[0] })
		for (const match of lines[index].matchAll(CSS_BORDER_RADIUS_RE))
			issues.push({ path: relativePath, line: index + 1, token: match[0].trim() })
		for (const match of lines[index].matchAll(CUSTOM_RADIUS_VAR_RE))
			issues.push({ path: relativePath, line: index + 1, token: match[0].trim() })
		for (const match of lines[index].matchAll(HARDCODED_BORDER_WIDTH_RE))
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
