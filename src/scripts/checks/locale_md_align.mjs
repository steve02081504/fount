/**
 * 平行 locale markdown（`Stem.xx-YY.md`）行级结构对齐：行数、标题级、列表、加粗/斜体、链接等。
 */
import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'

/** 默认检查的目录（相对仓库根）。 */
export const DEFAULT_LOCALE_MD_DIRS = Object.freeze(['docs/EULA', 'docs/readme'])

/** 参与比对的形状字段。 */
export const SHAPE_KEYS = Object.freeze([
	'heading',
	'hr',
	'quote',
	'fence',
	'list',
	'bold',
	'italic',
	'links',
	'images',
	'codes',
])

const LOCALE_MD_NAME = /^(.+)\.(.+)\.md$/
const AUTOLINK = /<https?:[^\s>]+>/gi
const MD_IMAGE = /!\[[^\]]*]\([^)]*\)/g
const MD_LINK = /\[[^\]]*]\([^)]*\)/g
const INLINE_CODE = /`[^`]+`/g

/**
 * 去掉末尾换行后按行切开。
 * @param {string} text 文件文本
 * @returns {string[]} 行
 */
export function splitMdLines(text) {
	const normalized = text.replaceAll('\r\n', '\n').replaceAll('\r', '\n')
	const lines = normalized.split('\n')
	if (lines.at(-1) === '') lines.pop()
	return lines
}

/**
 * 剥掉行内代码 / 链接后再数强调标记，避免 URL 与 code 干扰。
 * @param {string} text 已去掉列表前缀的行
 * @returns {{ rest: string, links: number, images: number, codes: number }} 计数与剩余
 */
function stripInlineAtoms(text) {
	let rest = text
	let images = 0
	let links = 0
	let codes = 0
	rest = rest.replace(MD_IMAGE, () => {
		images++
		return '\0'
	})
	rest = rest.replace(MD_LINK, () => {
		links++
		return '\0'
	})
	rest = rest.replace(AUTOLINK, () => {
		links++
		return '\0'
	})
	rest = rest.replace(INLINE_CODE, () => {
		codes++
		return '\0'
	})
	return { rest, links, images, codes }
}

/**
 * 数成对强调。先 *** / ___，再 ** / __，再 * / _。
 * @param {string} text 已去掉链接与 code 的文本
 * @returns {{ bold: number, italic: number }} 成对个数
 */
export function countEmphasis(text) {
	let rest = text
	let bold = 0
	let italic = 0
	rest = rest.replace(/\*{3}([\S\s]*?)\*{3}/g, () => { bold++; italic++; return '\0' })
	rest = rest.replace(/___([\S\s]*?)___/g, () => { bold++; italic++; return '\0' })
	rest = rest.replace(/\*\*([\S\s]*?)\*\*/g, () => { bold++; return '\0' })
	rest = rest.replace(/__([\S\s]*?)__/g, () => { bold++; return '\0' })
	rest = rest.replace(/\*([\S\s]*?)\*/g, () => { italic++; return '\0' })
	rest = rest.replace(/_([\S\s]*?)_/g, () => { italic++; return '\0' })
	return { bold, italic }
}

/**
 * 单行 markdown 结构指纹。
 * @param {string} line 一行
 * @returns {{ heading: number, hr: number, quote: number, fence: number, list: string, bold: number, italic: number, links: number, images: number, codes: number }} 形状
 */
export function mdLineShape(line) {
	const fence = /^```/.test(line) ? 1 : 0
	const hr = /^(?:-{3,}|\*{3,}|_{3,})\s*$/.test(line) ? 1 : 0
	const headingMatch = /^(#{1,6})(?:\s|$)/.exec(line)
	const heading = headingMatch ? headingMatch[1].length : 0
	let rest = headingMatch ? line.slice(headingMatch[0].length) : line
	const quoteMatch = /^>\s?/.exec(rest)
	const quote = quoteMatch ? 1 : 0
	if (quoteMatch) rest = rest.slice(quoteMatch[0].length)
	let list = ''
	if (!heading && !hr && !fence) {
		const ul = /^([*+-])\s+/.exec(rest)
		const ol = /^\d+\.\s+/.exec(rest)
		if (ul) {
			list = ul[1]
			rest = rest.slice(ul[0].length)
		}
		else if (ol) {
			list = 'ol'
			rest = rest.slice(ol[0].length)
		}
	}
	const atoms = stripInlineAtoms(rest)
	const emphasis = hr || fence ? { bold: 0, italic: 0 } : countEmphasis(atoms.rest)
	return {
		heading,
		hr,
		quote,
		fence,
		list,
		bold: emphasis.bold,
		italic: emphasis.italic,
		links: atoms.links,
		images: atoms.images,
		codes: atoms.codes,
	}
}

/**
 * @typedef {{ dir: string, stem: string, locale: string, path: string, lines: string[] }} LocaleMdFile 一个 locale 文件
 */

/**
 * @typedef {{ dir: string, stem: string, field?: string, line?: number, file: string, reference: string, expected: string | number, actual: string | number }} LocaleMdAlignIssue 对齐问题
 */

/**
 * 列出目录中的 locale markdown 族。
 * @param {string} absDir 绝对目录
 * @param {string} relDir 相对仓库根
 * @returns {Promise<Map<string, { locale: string, path: string }[]>>} stem → 文件
 */
export async function listLocaleMdGroups(absDir, relDir) {
	const names = await readdir(absDir)
	/** @type {Map<string, { locale: string, path: string }[]>} */
	const groups = new Map()
	for (const name of names) {
		const match = LOCALE_MD_NAME.exec(name)
		if (!match) continue
		const stem = match[1]
		const locale = match[2]
		const list = groups.get(stem) ?? []
		list.push({ locale, path: `${relDir}/${name}` })
		groups.set(stem, list)
	}
	for (const list of groups.values())
		list.sort((a, b) => a.locale < b.locale ? -1 : a.locale > b.locale ? 1 : 0)
	return groups
}

/**
 * 比对一族 locale 文件。
 * @param {{ locale: string, path: string, lines: string[] }[]} files 已读文件
 * @param {string} [referenceLocale] 参考 locale，默认 en-UK
 * @returns {LocaleMdAlignIssue[]} 问题
 */
export function compareLocaleMdFiles(files, referenceLocale = 'en-UK') {
	if (files.length < 2) return []
	const reference = files.find(file => file.locale === referenceLocale) ?? files[0]
	/** @type {LocaleMdAlignIssue[]} */
	const issues = []
	const refLen = reference.lines.length
	for (const file of files) {
		if (file.path === reference.path) continue
		if (file.lines.length !== refLen) {
			issues.push({
				dir: '',
				stem: '',
				file: file.path,
				reference: reference.path,
				field: 'lines',
				expected: refLen,
				actual: file.lines.length,
			})
			continue
		}
		for (let index = 0; index < refLen; index++) {
			const expectedShape = mdLineShape(reference.lines[index])
			const actualShape = mdLineShape(file.lines[index])
			for (const key of SHAPE_KEYS) {
				if (expectedShape[key] === actualShape[key]) continue
				issues.push({
					dir: '',
					stem: '',
					file: file.path,
					reference: reference.path,
					line: index + 1,
					field: key,
					expected: expectedShape[key],
					actual: actualShape[key],
				})
			}
		}
	}
	return issues
}

/**
 * 扫描仓库内默认或指定目录。
 * @param {string} repoRoot 仓库根
 * @param {{ dirs?: string[], referenceLocale?: string }} [options] 选项
 * @returns {Promise<{ files: string[], issues: LocaleMdAlignIssue[] }>} 结果
 */
export async function scanLocaleMdAlign(repoRoot, options = {}) {
	const dirs = options.dirs ?? [...DEFAULT_LOCALE_MD_DIRS]
	const referenceLocale = options.referenceLocale ?? 'en-UK'
	/** @type {LocaleMdAlignIssue[]} */
	const issues = []
	/** @type {string[]} */
	const files = []
	for (const relDir of dirs) {
		const groups = await listLocaleMdGroups(join(repoRoot, relDir), relDir)
		for (const [stem, group] of groups) {
			const loaded = await Promise.all(group.map(async item => {
				files.push(item.path)
				const text = await readFile(join(repoRoot, item.path), 'utf8')
				return { ...item, lines: splitMdLines(text) }
			}))
			for (const issue of compareLocaleMdFiles(loaded, referenceLocale)) {
				issue.dir = relDir
				issue.stem = stem
				issues.push(issue)
			}
		}
	}
	return { files, issues }
}

/**
 * 格式化一条问题。
 * @param {LocaleMdAlignIssue} issue 问题
 * @returns {string} 一行
 */
export function formatLocaleMdAlignIssue(issue) {
	if (issue.field === 'lines')
		return `${issue.file}: 行数 ${issue.actual} ≠ ${issue.reference} ${issue.expected}`
	return `${issue.file}:${issue.line} ${issue.field} ${JSON.stringify(issue.actual)} ≠ ${issue.reference} ${JSON.stringify(issue.expected)}`
}
