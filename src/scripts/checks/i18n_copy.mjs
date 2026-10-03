/**
 * 本地化文案的机器味与同步残渣扫描：空值、产品名走样、复合词断裂、空白框架漂移、标点粘连。
 *
 * 与 `i18n_keys` 的分工：那边管键结构与 `${placeholder}` 集合，这边管文案本身是否像
 * 母语产品团队写的、是否还留着同步脚本的痕迹。
 */
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

/** 产品名不写作 font 的语言：英语原文，以及 font / fonte 本身是正常词的法语、葡语。 */
const BRAND_SAFE_LOCALES = new Set(['en-UK', 'fr-FR', 'pt-PT'])

/** 允许为空的连接词：日语与 emoji 语言不需要中文的「的」。 */
const EMPTY_ALLOWED = {
	'ja-JP': ['installer_wait_screen.data_showcase.title_of'],
	emoji: ['installer_wait_screen.data_showcase.title_of'],
}

/** 这些是字体相关的技术词，不是产品名写错。 */
const FONT_TECH_SUFFIX = /^(?:-family|-size|-weight|-style|-face|-variant|-stretch|-smoothing|-display|-feature)/

/** 连字符前的功能词：荷兰语 `en -wachtwoord` 这类省略写法是合法的。 */
const CONJUNCTIONS = new Set(['en', 'of', 'und', 'oder', 'et', 'and', 'or', 'y', 'e', 'i', 'ta', 'и', 've', 'og', 'az', 'és'])

const BRAND = /\b(?:Font|font)\b/g
const SCHEME = /\bfonte:\/\//
const COMPOUND = / -(?<after>[\p{L}][\w]*)/gu
const WORD_TAIL = /[\p{L}\w]+$/u
const COMMA_SPACE = /\s+,/
const ELLIPSIS_SPACE = /\s+(?=\.\.\.)/
const PERIOD_SPACE = /[ \t]+(?=\.(?:\s|$))/
const KOREAN_COLON = /(?<=[\uac00-\ud7af\]\)])\s+:(?!\/\/)/
const HAN = /[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]/u

/**
 * 把 locale JSON 摊平成 `路径 → 叶子值`，数组下标写作 `[i]`。
 * @param {unknown} node JSON 节点
 * @param {string} prefix 路径前缀
 * @param {Map<string, unknown>} out 收集表
 * @returns {Map<string, unknown>} 路径到叶子
 */
export function flattenLocale(node, prefix = '', out = new Map()) {
	if (typeof node === 'string' || node === null) {
		if (prefix) out.set(prefix, node)
		return out
	}
	if (Array.isArray(node)) {
		node.forEach((item, index) => flattenLocale(item, `${prefix}[${index}]`, out))
		return out
	}
	if (node && typeof node === 'object') {
		for (const [key, value] of Object.entries(node)) {
			if (key === 'switch') continue
			flattenLocale(value, prefix ? `${prefix}.${key}` : key, out)
		}
	}
	return out
}

/**
 * 前导 / 尾随换行或空格的片段。
 * @param {string} text 待测文本
 * @returns {{ lead: string, trail: string }} 空白片段
 */
function edges(text) {
	return { lead: text.match(/^\s*/u)?.[0] ?? '', trail: text.match(/\s*$/u)?.[0] ?? '' }
}

/**
 * 单条文案的规则命中情况。
 * @param {object} input 输入
 * @param {string} input.locale locale id
 * @param {string} input.key 叶子路径
 * @param {string | null} input.value 本语言文案
 * @param {string | undefined} input.source zh-CN 文案
 * @returns {{ rule: string, detail: string }[]} 命中项
 */
export function checkLeaf({ locale, key, value, source }) {
	const hits = []
	if (value === null) hits.push({ rule: 'null', detail: 'value is null' })
	else if (value === '') {
		if (!EMPTY_ALLOWED[locale]?.includes(key)) hits.push({ rule: 'empty', detail: 'value is empty' })
	}
	if (typeof value !== 'string') return hits

	if (SCHEME.test(value)) hits.push({ rule: 'brand', detail: 'fonte:// instead of fount://' })
	if (!BRAND_SAFE_LOCALES.has(locale) && typeof source === 'string' && source.toLowerCase().includes('fount'))
		for (const match of value.matchAll(BRAND))
			if (!FONT_TECH_SUFFIX.test(value.slice(match.index + match[0].length)))
				hits.push({ rule: 'brand', detail: `"${match[0]}" where the source says fount` })

	for (const match of value.matchAll(COMPOUND)) {
		const before = value.slice(0, match.index).match(WORD_TAIL)?.[0]
		if (!before || CONJUNCTIONS.has(before.toLowerCase())) continue
		const after = match.groups.after
		const tail = value.slice(match.index + match[0].length, match.index + match[0].length + 1)
		if (after.length === 1 && (tail === '' || tail === ' ' || tail === '<')) continue // CLI flag like `-f <file>`
		hits.push({ rule: 'compound', detail: `space inside the compound "${before} -${after}"` })
	}

	if (typeof source === 'string') {
		const mine = edges(value), theirs = edges(source)
		if (theirs.lead.includes('\n') && !mine.lead.includes('\n')) hits.push({ rule: 'whitespace', detail: 'lost the leading newline of the source' })
		if (theirs.trail.includes('\n') && !mine.trail.includes('\n')) hits.push({ rule: 'whitespace', detail: 'lost the trailing newline of the source' })
		if (value.trim() === source.trim() && theirs.lead && !mine.lead && !theirs.lead.includes('\n'))
			hits.push({ rule: 'whitespace', detail: `lost the leading whitespace ${JSON.stringify(theirs.lead)}` })
		if (value.trim() === source.trim() && theirs.trail && !mine.trail && !theirs.trail.includes('\n'))
			hits.push({ rule: 'whitespace', detail: `lost the trailing whitespace ${JSON.stringify(theirs.trail)}` })
	}

	if (COMMA_SPACE.test(value)) hits.push({ rule: 'punctuation', detail: 'space before a comma' })
	if (ELLIPSIS_SPACE.test(value)) hits.push({ rule: 'punctuation', detail: 'space before an ellipsis' })
	if (PERIOD_SPACE.test(value)) hits.push({ rule: 'punctuation', detail: 'space before a sentence-final period' })
	if (locale === 'ko-KR' && !value.includes('\n') && KOREAN_COLON.test(value))
		hits.push({ rule: 'punctuation', detail: 'space before a Korean colon' })

	return hits
}

/**
 * 全语言扫描：返回每条命中。
 * @param {Record<string, unknown>} trees locale id → JSON 树
 * @returns {{ locale: string, key: string, rule: string, detail: string }[]} 命中列表
 */
export function scanLocaleCopy(trees) {
	const source = flattenLocale(trees['zh-CN'])
	const issues = []
	for (const [locale, tree] of Object.entries(trees)) {
		if (locale === 'zh-CN') continue
		for (const [key, value] of flattenLocale(tree)) {
			for (const hit of checkLeaf({ locale, key, value, source: source.get(key) }))
				issues.push({ locale, key, rule: hit.rule, ...{ detail: hit.detail } })
		}
	}
	return issues
}

/**
 * 读取 `src/public/locales/*.json` 并扫描。
 * @param {string} repoRoot 仓库根
 * @returns {Promise<{ issues: { locale: string, key: string, rule: string, detail: string }[], localeIds: string[] }>} 扫描结果
 */
export async function scanRepoLocaleCopy(repoRoot) {
	const dir = join(repoRoot, 'src/public/locales')
	const { readdir } = await import('node:fs/promises')
	const names = (await readdir(dir)).filter(name => name.endsWith('.json')).sort()
	/** @type {Record<string, unknown>} */
	const trees = {}
	for (const name of names)
		trees[name.slice(0, -'.json'.length)] = JSON.parse(await readFile(join(dir, name), 'utf8'))
	return { issues: scanLocaleCopy(trees), localeIds: Object.keys(trees) }
}

/**
 * 判断某条文案是否含有汉字（zh-TW / lzh 的共用字形判定用）。
 * @param {string} text 文本
 * @returns {boolean} 是否含汉字
 */
export function hasHan(text) {
	return HAN.test(text)
}
