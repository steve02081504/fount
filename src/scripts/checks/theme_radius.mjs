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
export const THEMED_FRONTEND_ROOTS = ['src/public', '.github/pages']

/** 扫描的后缀。 */
export const THEME_RADIUS_SUFFIXES = ['.html', '.mjs', '.js', '.css']

/**
 * 被排除的路径：测试夹具 / 测试文件里的类名是样例数据，不是真实 UI
 * （按项目 `.test` / `.spec` 命名约定排除，覆盖支持后缀）；
 * `.php.html` 是 PHP 诱饵页（`src/server/web_server/php_decoy.mjs` 用静态 HTML 响应对应 `.php` 请求），
 * 非主题化前端页面（与 html_meta 等检查一致排除）。
 * @param {string} relativePath 相对仓库根
 * @returns {boolean} 应排除则为 true
 */
export function isThemeRadiusExcluded(relativePath) {
	return /(?:^|\/)test\//u.test(relativePath)
		|| /\.(?:test|spec)\.(?:html|mjs|js|css)$/u.test(relativePath)
		|| /\.php\.html$/u.test(relativePath)
}

/**
 * 硬编码固定圆角类的正则（无 `g` 标志，供 `.test()` 等无状态使用）。
 * 捕获：裸 `rounded`（0.25rem）、`rounded-xs/sm/md/lg/xl/2xl/3xl/4xl`、
 * 单角前缀（`rounded-t-lg` / `rounded-l-md` 等）、`rounded-full`（头像等圆），
 * 以及 daisyUI `btn-circle`（硬编码 `border-radius: 3.40282e38px` 的圆形按钮，
 * 其悬浮阴影同样呈现圆形）—— 这些都用固定值无视主题圆角方案，
 * 应改用主题感知类 `rounded-selector/field/box/btn/badge`（按钮用 `rounded-btn` / `btn-square`）。
 * 允许（不命中）：`rounded-none`（显式方形）、`btn-square` 及主题感知类。
 * 注意：`btn-square` 名字有误导性（一般人以为"纯方形"），但它其实只设置等宽等高的
 * 【尺寸】而不碰 `border-radius`——圆角由主题的 `rounded-btn`（即 `--radius-*`）支配，
 * 故 cyberpunk 下为方形、默认主题下为圆角方形，是"自适应按钮"而非硬方形。
 * 它不含任何圆角硬编码，因此不应命中（检测管的是"绕过主题圆角/边框"，不是"方不方"）。
 * 已向 daisyUI 建议改名：https://github.com/saadeghi/daisyui/issues/4687
 * @type {RegExp}
 */
export const HARDCODED_RADIUS_PATTERN =
	/rounded-(?:(?:tl|tr|bl|br|t|b|l|r)-)?(?:xs|sm|md|lg|xl|2xl|3xl|4xl|full)\b|\brounded(?![-\w])|\bbtn-circle\b/u

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

/** `border-radius:` 声明头。 */
const BORDER_RADIUS_DECL_RE = /border-radius\s*:/gu

/**
 * 自定义 `--radius-*:` 声明头。
 * daisyUI 主题用 `--radius-selector/field/box` 表达圆角方案；自定义 `--radius-md: 10px` 等
 * 会另立一套硬编码圆角体系（如 chat `vars.css` 的 `--radius-sm/md/lg`），消费者 `var(--radius-md)`
 * 即绕过主题。主题感知写法应为 `--radius-md: var(--radius-box)`。
 */
const CUSTOM_RADIUS_VAR_DECL_RE = /--radius-[\w-]+\s*:/gu

/** 主题圆角变量引用前缀：`var(--radius-*)` / `var(--rounded-*)`（含 `var(--radius-sm, 6px)` 等 fallback）。 */
const THEME_RADIUS_VAR_PREFIX = /^var\(\s*--(?:radius|rounded)-/u

/** CSS 长度值：十进制数字 + 常见长度单位（px/rem/em/%/ch/vw/vh/vmin/vmax/cm/mm/in/pt/pc/ex），或裸数字（如 `0`）。 */
const CSS_LENGTH_RE = /^(?:[0-9]+(?:\.[0-9]+)?|\.[0-9]+)(?:px|rem|em|%|ch|vw|vh|vmin|vmax|cm|mm|in|pt|pc|ex)?$/u

/**
 * 判断单个圆角组件是否为硬编码固定值：非零长度或 `calc(...)`。
 * 合法的方形角 `0`（无单位或带单位）视为主题无关的安全值，不命中。
 * @param {string} component 单个圆角值组件
 * @returns {boolean} 命中则为 true
 */
function isHardcodedRadiusComponent(component) {
	component = component.trim()
	if (THEME_RADIUS_VAR_PREFIX.test(component)) return false
	if (/^calc\(/u.test(component))
		// calc(...) 内含主题圆角变量（如 `calc(var(--radius-box) - 2px)`）即为主题感知；
		// 否则（如 `calc(1rem - 2px)`）是硬编码圆角。
		return !/var\(\s*--(?:radius|rounded)-/u.test(component)
	if (CSS_LENGTH_RE.test(component)) return parseFloat(component) !== 0
	return false
}

/**
 * 将 CSS 声明值拆成组件（按顶层空白切分，忽略 `var()` / `calc()` 括号内的空白）。
 * @param {string} value 声明值
 * @returns {string[]} 组件列表
 */
function splitCssComponents(value) {
	const components = []
	let current = ''
	let depth = 0
	for (const ch of value) {
		if (ch === '(') depth++
		if (ch === ')') depth--
		if (/\s/u.test(ch) && depth === 0) {
			if (current) components.push(current)
			current = ''
		}
		else current += ch
	}
	if (current) components.push(current)
	return components
}

/**
 * 扫描某类圆角声明（`border-radius:` / 自定义 `--radius-*:`）中的硬编码值。
 * 按声明值逐组件解析，仅当声明完全由主题变量（或合法方形角 `0`）组成时跳过；
 * 出现任一硬编码非零长度或 `calc(...)`（含与主题变量混用）即上报。
 * @param {string} content 文件文本
 * @param {RegExp} declRe 声明头正则
 * @param {string} relativePath 相对仓库根
 * @param {ThemeRadiusIssue[]} issues 收集命中
 */
function scanRadiusDeclaration(content, declRe, relativePath, issues) {
	for (const decl of content.matchAll(declRe)) {
		let value = ''
		for (let index = decl.index + decl[0].length; index < content.length && content[index] !== ';' && content[index] !== '}'; index++)
			value += content[index]
		if (splitCssComponents(value).some(isHardcodedRadiusComponent))
			issues.push({ path: relativePath, line: lineNumberAt(content, decl.index), token: `${decl[0].trim()} ${value.trim()}` })
	}
}

/**
 * 硬编码边框宽度（绕过主题 `--border`）：
 * `border: <长度>` / `border-<侧>: <长度>` / `border-width: <长度>`（不含 `border-radius`）。
 */
const HARDCODED_BORDER_WIDTH_RE =
	/border(?:-(?:top|right|bottom|left|width))?\s*:\s*[0-9]+(?:\.[0-9]+)?px(?![-\w])/gu

/**
 * 跳过指令：上一行恰好是 `/* theme-radius-ignore *&#47;` 注释时，跳过下一行的硬编码边框宽度，
 * 用于放行有意的粗边框。唯一指令形式，仅管下一行。参考 ESLint 下一行禁用注释。
 * @type {RegExp}
 */
const RADIUS_IGNORE_DIRECTIVE = /^\s*\/\*\s*theme-radius-ignore\s*\*\/\s*$/u

/**
 * 判断某行是否声明了对下一行的忽略。
 * @param {string} line 行文本
 * @returns {boolean} 命中则为 true
 */
function isNextLineIgnored(line) {
	return RADIUS_IGNORE_DIRECTIVE.test(line)
}

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
 * 扫描单文件内容中的硬编码固定圆角。
 * @param {string} relativePath 相对仓库根
 * @param {string} content 文件文本
 * @returns {ThemeRadiusIssue[]} 命中条目
 */
export function scanFileThemeRadius(relativePath, content) {
	/** @type {ThemeRadiusIssue[]} */
	const issues = []
	const lines = content.split('\n')
	// 硬编码固定圆角类按行扫描（HTML/MJS 中为单词 token，无跨行可能）。
	for (let index = 0; index < lines.length; index++)
		for (const match of lines[index].matchAll(HARDCODED_RADIUS_GLOBAL))
			issues.push({ path: relativePath, line: index + 1, token: match[0] })
	// 可跨行的 CSS 声明对完整内容匹配，再从偏移推出行号；逐组件判断是否全为主题变量。
	scanRadiusDeclaration(content, BORDER_RADIUS_DECL_RE, relativePath, issues)
	scanRadiusDeclaration(content, CUSTOM_RADIUS_VAR_DECL_RE, relativePath, issues)
	// 仅硬编码边框宽度受 `theme-radius-ignore` 豁免；圆角类、border-radius、--radius-* 一律上报。
	const ignoredBorderWidthLines = new Set()
	for (let index = 0; index < lines.length - 1; index++)
		if (isNextLineIgnored(lines[index])) ignoredBorderWidthLines.add(index + 2)
	for (const match of content.matchAll(HARDCODED_BORDER_WIDTH_RE)) {
		const line = lineNumberAt(content, match.index)
		if (ignoredBorderWidthLines.has(line)) continue
		issues.push({ path: relativePath, line, token: match[0].trim() })
	}
	return issues
}

/**
 * 扫描主题化前端中的硬编码固定圆角类（全量）。
 * @param {string} repoRoot 仓库根
 * @returns {Promise<{ files: string[], issues: ThemeRadiusIssue[] }>} 命中文件与问题列表
 */
export async function scanThemeRadius(repoRoot) {
	/** @type {ThemeRadiusIssue[]} */
	const issues = []
	for (const relativePath of (await Promise.all(
		THEMED_FRONTEND_ROOTS.map(under => listRepoFiles(repoRoot, THEME_RADIUS_SUFFIXES, { under })),
	)).flat()
		.filter(path => !isThemeRadiusExcluded(path))) {
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
