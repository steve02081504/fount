/**
 * 动效卫生检测：主题化前端不得写会拖垮合成器 / 触发整棵子树重排的过渡。
 * 覆盖 `src/public/**`（应用本体）与 `.github/pages/**`（GitHub Pages 静态站），
 * 与 `theme_radius.mjs` 同范围（复用其根 / 后缀 / 排除）。
 * 违反形态：
 * - `transition: all`（含 Tailwind 类 `transition-all`、`transition-property: all`、
 *   省略属性的 `transition: 0.3s ease`）：属性一旦新增就会搭车过渡，应显式枚举。
 *   参考 transitions.dev 的 common mistakes「Replacing transition with transition: all」。
 * - 过渡布局属性（`width` / `height` / `min/max-*` / `top/right/bottom/left/inset*` /
 *   `margin*` / `padding*` / `flex-basis` / `grid-template-*` 等）：
 *   每帧触发布局与重绘，应改用 `transform` / `opacity` / `grid-template-rows` 等合成友好的写法。
 * - `will-change` 用在非合成属性（只允许 `transform` / `opacity` / `filter` / `backdrop-filter` /
 *   `scroll-position` / `contents`）：为 `width` 之类提升图层没有收益，反而常驻显存。
 * 豁免：上一行为 `/* motion-ignore *&#47;` 时跳过下一行（对齐 `theme-radius-ignore` 指令），
 * 用于进度条等确需布局动画的场景。
 */
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

import { isThemeRadiusExcluded, THEMED_FRONTEND_ROOTS, THEME_RADIUS_SUFFIXES } from './theme_radius.mjs'
import { listRepoFiles } from './walk.mjs'

/** 扫描的后缀（与 theme_radius 一致）。 */
export const MOTION_SUFFIXES = THEME_RADIUS_SUFFIXES

/**
 * 被排除的路径：与 theme_radius 一致（测试夹具 / `.php.html` 诱饵页）。
 * @param {string} relativePath 相对仓库根
 * @returns {boolean} 应排除则为 true
 */
export function isMotionExcluded(relativePath) {
	return isThemeRadiusExcluded(relativePath)
}

/**
 * 触发重排的布局属性（精确名 + `margin-*` / `padding-*` / `inset-*` 前缀）。
 * @param {string} prop CSS 属性名（小写）
 * @returns {boolean} 命中则为 true
 */
export function isLayoutTransitionProp(prop) {
	if (/^(?:margin|padding|inset)-/u.test(prop)) return true
	return LAYOUT_TRANSITION_PROPS.has(prop)
}

/** 会触发重排的布局属性精确集合。 */
const LAYOUT_TRANSITION_PROPS = new Set([
	'width', 'height', 'min-width', 'max-width', 'min-height', 'max-height',
	'top', 'right', 'bottom', 'left', 'inset',
	'margin', 'padding', 'flex-basis',
	'grid-template', 'grid-template-columns', 'grid-template-rows',
])

/** 合成友好的 `will-change` 目标属性（`auto` 为默认/重置值，一并放行）。 */
const COMPOSITED_WILL_CHANGE_PROPS = new Set([
	'transform', 'opacity', 'filter', 'backdrop-filter', 'scroll-position', 'contents', 'auto',
])

/** Tailwind 全属性过渡类 `transition-all`（含 `hover:` / `md:` 等前缀），排除 `transition-[…]` 自定义值。 */
const TAILWIND_TRANSITION_ALL_RE = /(?<![\w-])transition-all(?![-\w[])/gu

/** 跳过指令：上一行恰好是 `/* motion-ignore *&#47;` / `/* motion-ignore: reason *&#47;`（CSS）或 `<!-- motion-ignore -->`（HTML）注释时，跳过下一行。 */
const MOTION_IGNORE_DIRECTIVE = /^\s*(?:\/\*\s*motion-ignore\b[\s\S]*?\*\/|<!--\s*motion-ignore\b[\s\S]*?-->)\s*$/u

/** 声明头：`transition:`（非 `transition-property`）/ `transition-property:` / `will-change:`。 */
const TRANSITION_SHORTHAND_RE = /(?<![\w-])transition\s*:/gu
const TRANSITION_PROPERTY_RE = /(?<![\w-])transition-property\s*:/gu
const WILL_CHANGE_RE = /(?<![\w-])will-change\s*:/gu

/**
 * @typedef {{ path: string, line: number, token: string }} MotionHygieneIssue 命中条目
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
 * 从声明头之后读取声明值，直到 `;` / `}` / 反引号 / 引号或文本结束。
 * @param {string} content 文件文本
 * @param {number} start 值起始偏移
 * @returns {string} 声明值
 */
function readDeclarationValue(content, start) {
	let value = ''
	for (let index = start; index < content.length; index++) {
		const ch = content[index]
		if (ch === ';' || ch === '}' || ch === '`' || ch === '\'' || ch === '"' || ch === '\n') break
		value += ch
	}
	return value
}

/**
 * 按顶层分隔符切分（忽略 `var()` / `calc()` 等括号内的分隔符）。
 * @param {string} value 待切分文本
 * @param {string} separators 顶层分隔符（如 `,` 或空白）
 * @returns {string[]} 切分结果（已去空白、丢弃空项）
 */
function splitTopLevel(value, separators) {
	const parts = []
	let current = ''
	let depth = 0
	for (const ch of value) {
		if (ch === '(') depth++
		else if (ch === ')') depth--
		if (depth === 0 && separators.includes(ch)) {
			if (current.trim()) parts.push(current.trim())
			current = ''
		}
		else current += ch
	}
	if (current.trim()) parts.push(current.trim())
	return parts
}

/**
 * 判断 token 是否为时长 / 缓动值（出现即表示属性已省略，等价于 `all`）。
 * @param {string} token 单个 token
 * @returns {boolean} 是则为 true
 */
function isTimeOrEasing(token) {
	return /^[+-]?[\d.]+m?s$/iu.test(token)
		|| /^(?:cubic-bezier|steps|linear|ease|ease-in|ease-out|ease-in-out)\b/u.test(token)
}

/**
 * 扫描 `transition:` / `transition-property:` / `will-change:` 声明。
 * @param {string} content 文件文本
 * @param {string} relativePath 相对仓库根
 * @param {Set<number>} ignoredLines 被忽略的行号集合
 * @param {MotionHygieneIssue[]} issues 收集命中
 */
function scanDeclarations(content, relativePath, ignoredLines, issues) {
	for (const match of content.matchAll(TRANSITION_SHORTHAND_RE)) {
		const line = lineNumberAt(content, match.index)
		if (ignoredLines.has(line)) continue
		const value = readDeclarationValue(content, match.index + match[0].length)
		for (const layer of splitTopLevel(value, ',')) {
			const tokens = splitTopLevel(layer, ' \t')
			if (!tokens.length) continue
			const prop = tokens[0].toLowerCase()
			if (prop === 'all' || isTimeOrEasing(prop))
				issues.push({ path: relativePath, line, token: 'transition: all' })
			else if (isLayoutTransitionProp(prop))
				issues.push({ path: relativePath, line, token: `transition: ${prop}` })
		}
	}
	for (const match of content.matchAll(TRANSITION_PROPERTY_RE)) {
		const line = lineNumberAt(content, match.index)
		if (ignoredLines.has(line)) continue
		const value = readDeclarationValue(content, match.index + match[0].length)
		for (const prop of splitTopLevel(value, ',').map(part => part.toLowerCase())) 
			if (prop === 'all')
				issues.push({ path: relativePath, line, token: 'transition-property: all' })
			else if (isLayoutTransitionProp(prop))
				issues.push({ path: relativePath, line, token: `transition-property: ${prop}` })
		
	}
	for (const match of content.matchAll(WILL_CHANGE_RE)) {
		const line = lineNumberAt(content, match.index)
		if (ignoredLines.has(line)) continue
		const value = readDeclarationValue(content, match.index + match[0].length)
		for (const prop of splitTopLevel(value, ',').map(part => part.toLowerCase()))
			if (!COMPOSITED_WILL_CHANGE_PROPS.has(prop))
				issues.push({ path: relativePath, line, token: `will-change: ${prop}` })
	}
}

/**
 * 扫描单文件内容中的动效卫生问题。
 * @param {string} relativePath 相对仓库根
 * @param {string} content 文件文本
 * @returns {MotionHygieneIssue[]} 命中条目
 */
export function scanFileMotionHygiene(relativePath, content) {
	/** @type {MotionHygieneIssue[]} */
	const issues = []
	const lines = content.split('\n')
	const ignoredLines = new Set()
	for (let index = 0; index < lines.length - 1; index++)
		if (MOTION_IGNORE_DIRECTIVE.test(lines[index])) ignoredLines.add(index + 2)
	for (let index = 0; index < lines.length; index++)
		for (const match of lines[index].matchAll(TAILWIND_TRANSITION_ALL_RE))
			if (!ignoredLines.has(index + 1))
				issues.push({ path: relativePath, line: index + 1, token: 'transition-all' })
	scanDeclarations(content, relativePath, ignoredLines, issues)
	issues.sort((a, b) => a.line - b.line)
	return issues
}

/**
 * 扫描主题化前端中的动效卫生问题（全量）。
 * @param {string} repoRoot 仓库根
 * @returns {Promise<{ files: string[], issues: MotionHygieneIssue[] }>} 命中文件与问题列表
 */
export async function scanMotionHygiene(repoRoot) {
	/** @type {MotionHygieneIssue[]} */
	const issues = []
	for (const relativePath of (await Promise.all(
		THEMED_FRONTEND_ROOTS.map(under => listRepoFiles(repoRoot, MOTION_SUFFIXES, { under })),
	)).flat()
		.filter(path => !isMotionExcluded(path))) {
		let content
		try {
			content = await readFile(join(repoRoot, relativePath), 'utf8')
		}
		catch (error) {
			if (error?.code === 'ENOENT') continue
			throw error
		}
		issues.push(...scanFileMotionHygiene(relativePath, content))
	}
	return { files: [...new Set(issues.map(issue => issue.path))].sort(), issues }
}
