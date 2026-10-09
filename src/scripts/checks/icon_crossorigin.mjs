/**
 * 图标跨域属性检查：主题化前端的图标一律走 Iconify CDN，并由 `svgInliner` 用 `fetch()` 取文本内联。
 *
 * 不带 `crossorigin="anonymous"` 时，浏览器为 `<img>` 发的是 no-cors 请求，响应是 opaque：
 * 既读不到内容，也不能被 `svgInliner` 的 cors fetch 复用（跨域 no-cors 与 cors 的缓存条目不通用），
 * 于是同一个图标要被下载两次。带上该属性后一次 CORS 抓取就能同时喂 `<img>`、`svgInliner`
 * 与预取器（Service Worker 侧也才能把它缓存成可复用的一份）。
 *
 * 只对已知会回 `Access-Control-Allow-Origin: *` 的图标 CDN 要求该属性：用户数据里出现的任意
 * 头像域名不保证允许 CORS，给它加 `crossorigin` 会让图片直接加载失败。数据驱动的图片 URL
 * （部件头像、成就图标、插件注册表 HTML）请在渲染时用 `pages/scripts/lib/corsImage.mjs` 现算。
 *
 * 覆盖两种写法：
 * - `<img src="https://api.iconify.design/…">` 标签（含 JSON 字符串里的转义形式）；
 * - `target.src = …` 赋值（值里出现图标 CDN 字面量，或引用了文件内持有图标 URL 的常量）。
 *   赋值必须在同一文件里先设过 `target.crossOrigin`；`if (x) x.src = …` 这种带守卫的行会被报出来
 *   但不会被自动修（插入点必须在守卫内），需要人工改。
 *
 * @module icon_crossorigin
 */

import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'

import { listRepoFiles } from './walk.mjs'

/** 扫描的后缀。 */
export const ICON_CROSSORIGIN_SUFFIXES = ['html', 'mjs', 'js', 'ts', 'css', 'json', 'md']

/**
 * 需要 `crossorigin` 的图标 URL 前缀（Iconify 公共 API 会回 `Access-Control-Allow-Origin: *`）。
 * @type {string[]}
 */
export const ICON_HOST_PREFIXES = ['https://api.iconify.design/']

/** 跳过指令：上一行恰好是该注释时跳过下一行。 */
const IGNORE_DIRECTIVE_REG = /^\s*(?:\/\*|<!--)\s*icon-crossorigin-ignore\s*(?:\*\/|-->)\s*$/

/** 匹配一个 `<img …>` 起始标签（JSON 字符串里属性值带 `\"` 转义，标签内不会出现 `>`）。 */
const IMG_TAG_REG = /<img\b[^>]*>/gi

/** 匹配 JS 里的 `target.src = …`（target 可以是 `a.b` / `a.b()` 之类的成员表达式）。 */
const SRC_ASSIGN_REG = /([$A-Z_a-z][\w$]*(?:\s*\.\s*[$A-Z_a-z][\w$]*|\s*\([^()]*\))*)\.src\s*=/g

/** 匹配把 URL 存进标识符的字符串常量声明（`const ICON = 'https://…'`）。 */
const ICON_CONST_REG = /\b(?:const|let|var)\s+([$A-Z_a-z][\w$]*)\s*=\s*(["'`])([^\n"'`]*)\2/g

/** 匹配给同一个 target 设置 `crossOrigin` 的语句。 */
const CROSSORIGIN_ASSIGN_REG = /([$A-Z_a-z][\w$]*(?:\s*\.\s*[$A-Z_a-z][\w$]*|\s*\([^()]*\))*)\.crossOrigin\s*=/g

/** 需要加上的属性（HTML 形式与 JSON 字符串转义形式）。 */
const ATTRIBUTE_HTML = ' crossorigin="anonymous"'
const ATTRIBUTE_ESCAPED = ' crossorigin=\\"anonymous\\"'

/**
 * 判断标签是否引用了需要 CORS 的图标 CDN。
 * @param {string} tag - 一个 `<img …>` 起始标签文本
 * @returns {boolean} 是否引用了图标 CDN
 */
function referencesIconHost(tag) {
	return ICON_HOST_PREFIXES.some(prefix => tag.includes(prefix))
}

/**
 * 判断标签是否已经带 `crossorigin`。
 * @param {string} tag - 一个 `<img …>` 起始标签文本
 * @returns {boolean} 是否已带该属性
 */
function hasCrossorigin(tag) {
	return /\bcrossorigin\b/i.test(tag)
}

/**
 * 计算下标所在行号（1 基）。
 * @param {string} text - 文件内容
 * @param {number} index - 字符下标
 * @returns {number} 行号
 */
function lineOf(text, index) {
	let line = 1
	for (let cursor = 0; cursor < index; cursor++) if (text[cursor] === '\n') line++
	return line
}

/**
 * 收集需要补 `crossorigin` 的标签位置。
 * @param {string} text - 文件内容
 * @returns {{ index: number, tag: string, line: number, escaped: boolean }[]} 违规标签
 */
function collectViolations(text) {
	const lines = text.split('\n')
	const violations = []
	for (const match of text.matchAll(IMG_TAG_REG)) {
		const tag = match[0]
		if (!referencesIconHost(tag) || hasCrossorigin(tag)) continue
		const line = lineOf(text, match.index)
		if (IGNORE_DIRECTIVE_REG.test(lines[line - 2] ?? '')) continue
		violations.push({ index: match.index, tag, line, escaped: tag.includes('\\"') })
	}
	return violations
}

/**
 * 收集文件里「存着图标 URL」的常量名。
 * @param {string} text - 文件内容
 * @returns {Set<string>} 常量名集合
 */
function collectIconConstants(text) {
	/** @type {Set<string>} */
	const names = new Set()
	for (const match of text.matchAll(ICON_CONST_REG))
		if (referencesIconHost(match[3])) names.add(match[1])
	return names
}

/**
 * 逐行收集 `target.src = …` 形式里缺少 `crossOrigin` 的赋值。
 * 判定依据：赋的值里出现图标 CDN 字面量，或引用了文件内持有图标 URL 的常量；
 * 且该行之前没有给同一个 target 设过 `crossOrigin`（属性必须在 `src` 之前设好）。
 * `bare` 表示该赋值是本行第一个语句（可安全地在行前插入一行；带 `if (x) x.src = …` 守卫的行不算，
 * 那种情况要人工写进守卫内，`fixTextIconCrossorigin` 不会替你动它）。
 * @param {string} text - 文件内容
 * @returns {{ index: number, line: number, target: string, indent: string, bare: boolean }[]} 违规赋值
 */
function collectSrcAssignments(text) {
	const iconConstants = collectIconConstants(text)
	/** @type {Map<string, number>} target → 已设过 crossOrigin 的字符下标 */
	const covered = new Map()
	for (const match of text.matchAll(CROSSORIGIN_ASSIGN_REG))
		if (!covered.has(match[1])) covered.set(match[1], match.index)

	const violations = []
	/** @type {Set<string>} 本次扫描里已经报过的 target（每个 target 只报第一处，修一处就够） */
	const reported = new Set()
	const lines = text.split('\n')
	let lineStart = 0
	for (const [lineIndex, line] of lines.entries()) {
		const assignment = [...line.matchAll(SRC_ASSIGN_REG)].at(-1)
		if (assignment) {
			const target = assignment[1]
			const value = line.slice(assignment.index + assignment[0].length)
			const referencesIcon = ICON_HOST_PREFIXES.some(prefix => value.includes(prefix))
				|| [...iconConstants].some(name => new RegExp(`\\b${name}\\b`).test(value))
			const coveredAt = covered.get(target)
			if (referencesIcon && !reported.has(target) && (coveredAt === undefined || coveredAt > lineStart + assignment.index))
				if (!IGNORE_DIRECTIVE_REG.test(lines[lineIndex - 1] ?? '')) {
					reported.add(target)
					violations.push({
						index: lineStart + assignment.index,
						line: lineIndex + 1,
						target,
						indent: line.match(/^\s*/)[0],
						bare: line.slice(0, assignment.index).trim() === '',
					})
				}
		}
		lineStart += line.length + 1
	}
	return violations
}

/**
 * 扫描文件内容里缺少 `crossorigin` 的图标 `<img>` 与 `img.src = …` 赋值。
 * @param {string} path - 相对路径（用于报告）
 * @param {string} text - 文件内容
 * @returns {{ path: string, line: number, tag: string }[]} 违规列表
 */
export function scanTextIconCrossorigin(path, text) {
	return [
		...collectViolations(text).map(({ line, tag }) => ({ path, line, tag: tag.trim().slice(0, 120) })),
		...collectSrcAssignments(text).map(({ line, target }) => ({ path, line, tag: `${target}.src` })),
	].sort((a, b) => a.line - b.line)
}

/**
 * 扫描仓库文件（读取失败按无违规处理）。
 * @param {string} path - 相对路径
 * @param {string} text - 文件内容
 * @returns {{ path: string, line: number, tag: string }[]} 违规列表
 */
export function scanFileIconCrossorigin(path, text) {
	return scanTextIconCrossorigin(path, text)
}

/**
 * 修复文件内容：给缺少 `crossorigin` 的图标 `<img>` 补上该属性，并给图标 `src` 赋值前补上 `crossOrigin = 'anonymous'`。
 * @param {string} text - 文件内容
 * @returns {string | null} 修复后的内容；无需修改时返回 null
 */
export function fixTextIconCrossorigin(text) {
	const tags = collectViolations(text)
	const assignments = collectSrcAssignments(text)
	/** @type {{ index: number, insert: string, replace: number }[]} */
	const insertions = [
		...tags.map(violation => ({
			index: violation.index,
			insert: '<img' + (violation.escaped ? ATTRIBUTE_ESCAPED : ATTRIBUTE_HTML),
			replace: '<img'.length,
		})),
		...assignments.filter(violation => violation.bare).map(violation => ({
			index: violation.index,
			insert: `${violation.target}.crossOrigin = 'anonymous'\n${violation.indent}`,
			replace: 0,
		})),
	].sort((a, b) => a.index - b.index)
	if (!insertions.length) return null
	let fixed = ''
	let cursor = 0
	for (const insertion of insertions) {
		fixed += text.slice(cursor, insertion.index) + insertion.insert
		cursor = insertion.index + insertion.replace
	}
	return fixed + text.slice(cursor)
}

/**
 * 该路径是否在检查范围内：主题化前端（`src/public/**`、`.github/pages/**`），排除测试目录。
 * @param {string} path - 相对路径
 * @returns {boolean} 是否在范围内
 */
export function isIconCrossoriginScopePath(path) {
	if (path.includes('/test/') || path.startsWith('test/')) return false
	return path.startsWith('src/public/') || path.startsWith('.github/pages/')
}

/**
 * 列出检查范围内的文件。
 * @param {string} repoRoot - 仓库根目录
 * @returns {Promise<string[]>} 仓库相对路径列表
 */
export async function resolveIconCrossoriginScanPaths(repoRoot) {
	const files = await listRepoFiles(repoRoot, ICON_CROSSORIGIN_SUFFIXES)
	return files.map(file => file.replaceAll('\\', '/')).filter(isIconCrossoriginScopePath)
}

/**
 * 扫描范围内的图标 `<img>` 是否缺 `crossorigin`。
 * @param {string} repoRoot - 仓库根目录
 * @param {string[]} [paths] - 限定扫描的相对路径
 * @returns {Promise<{ issues: { path: string, line: number, tag: string }[] }>} 扫描结果
 */
export async function scanIconCrossorigin(repoRoot, paths) {
	const issues = []
	for (const file of paths ?? await resolveIconCrossoriginScanPaths(repoRoot)) try {
		const text = await readFile(path.join(repoRoot, file), 'utf8')
		issues.push(...scanFileIconCrossorigin(file, text))
	} catch { /* 读不到就当它没有违规 */ }
	return { issues }
}

/**
 * 修复范围内的图标 `<img>`：补上 `crossorigin="anonymous"`。
 * @param {string} repoRoot - 仓库根目录
 * @param {string[]} [paths] - 限定修复的相对路径
 * @returns {Promise<string[]>} 被改动的文件（仓库相对路径）
 */
export async function fixIconCrossorigin(repoRoot, paths) {
	const fixed = []
	for (const file of paths ?? await resolveIconCrossoriginScanPaths(repoRoot)) try {
		const absolute = path.join(repoRoot, file)
		const next = fixTextIconCrossorigin(await readFile(absolute, 'utf8'))
		if (next === null) continue
		await writeFile(absolute, next, 'utf8')
		fixed.push(file)
	} catch { /* 读不到/写不了就跳过 */ }
	return fixed
}
