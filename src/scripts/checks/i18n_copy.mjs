/**
 * 本地化文案的机器味与同步残渣扫描：空值、产品名走样、复合词断裂、空白框架漂移、标点粘连。
 *
 * 与 `i18n_keys` 的分工：那边管键结构与 `${placeholder}` 集合，这边管文案本身是否像
 * 母语产品团队写的、是否还留着同步脚本的痕迹。
 */
import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'

/** 允许出现的非拉丁字母文字：语言本身用的那一套。 */
const SCRIPT_ALLOWED = {
	'zh-CN': ['Han'], 'zh-TW': ['Han'], lzh: ['Han'],
	'ja-JP': ['Han', 'Hiragana', 'Katakana'], 'ko-KR': ['Hangul', 'Han'],
	'ru-RU': ['Cyrillic'], 'uk-UA': ['Cyrillic'],
	'ar-SA': ['Arabic'], 'hi-IN': ['Devanagari'],
}
const SCRIPT_TESTS = [
	['Han', /\p{Script=Han}/u],
	['Hiragana', /\p{Script=Hiragana}/u],
	['Katakana', /\p{Script=Katakana}/u],
	['Hangul', /\p{Script=Hangul}/u],
	['Cyrillic', /\p{Script=Cyrillic}/u],
	['Greek', /\p{Script=Greek}/u],
	['Arabic', /\p{Script=Arabic}/u],
	['Devanagari', /\p{Script=Devanagari}/u],
]

/** 用符号和希腊字母当术语的语言：emoji 语言（Σ 求和、Δ 增量）。 */
const SCRIPT_FREE_LOCALES = new Set(['emoji'])

/**
 * 找出不属于该语言的文字系统的字母（拉丁字母永远允许，品牌与技术词要用）。
 * @param {string} locale locale id
 * @param {string} value 文案
 * @returns {string[]} 违规文字系统名
 */
function foreignScripts(locale, value) {
	if (SCRIPT_FREE_LOCALES.has(locale)) return []
	const allowed = new Set(SCRIPT_ALLOWED[locale] ?? [])
	const found = new Set()
	for (const char of value)
		for (const [name, pattern] of SCRIPT_TESTS)
			if (pattern.test(char) && !allowed.has(name)) found.add(name)


	return [...found]
}

/**
 * 产品名不写作 font 的语言：英语原文、法语（ils font 是正常动词）、葡语
 * （fonte 是「来源」的常用词，葡语的真产品名错误由 literal 规则兜住）。
 */
const BRAND_SAFE_LOCALES = new Set(['en-UK', 'fr-FR', 'pt-PT'])

/**
 * 各语言里出现过的产品名误译（评审轮反馈累积）。
 * `font` 词根的形式（fontur、fontein、fontsins…）由上面的 BRAND 规则覆盖，
 * 这里只放完全不沾 `font` 的译名。
 * @type {Record<string, RegExp>}
 */
const BRAND_ALIASES = {
	'nl-NL': /\blettertype\w*/gi,
	// 日语把产品名音译成「字体」「喷泉」：假名不沾 font 词根
	'ja-JP': /フォント|噴水/gu,
}

/** 允许为空的连接词：日语与 emoji 语言不需要中文的「的」。 */
const EMPTY_ALLOWED = {
	'ja-JP': ['installer_wait_screen.data_showcase.title_of'],
	emoji: ['installer_wait_screen.data_showcase.title_of'],
}

/** 这些是字体相关的技术词，不是产品名写错。 */
const FONT_TECH_SUFFIX = /^(?:-family|-size|-weight|-style|-face|-variant|-stretch|-smoothing|-display|-feature)/

/** 连字符前的功能词：荷兰语 `en -wachtwoord` 这类省略写法是合法的。 */
const CONJUNCTIONS = new Set(['en', 'of', 'und', 'oder', 'et', 'and', 'or', 'y', 'e', 'i', 'ta', 'и', 've', 'og', 'az', 'és'])

const BRAND = /\bfont\w*/gi
const SCHEME = /\bfonte:\/\//
const COMPOUND = / -(?<after>[\p{L}][\w]*)/gu
const WORD_TAIL = /[\p{L}\w]+$/u
const COMMA_SPACE = /\s+,/
const ELLIPSIS_SPACE = /\s+(?=\.\.\.)/
const PERIOD_SPACE = /[ \t]+(?=\.(?:\s|$))/
const KOREAN_COLON = /(?<=[\uac00-\ud7af\])])\s+:(?!\/\/)/
const FOUNT_SUBCOMMAND = /\bfount [a-z][a-z-]*/g
const CLI_FLAG = /(?<![\w-])--[a-z][a-z-]{1,}/g
const FILE_PATH = /(?<![\w./-])(?:[\w.-]+\/)+[\w.*-]+\.[a-z][a-z0-9]{1,4}\b/g
const DOT_FILE = /(?<![\w.])\.(?:no[a-z]+|[a-z][a-z0-9-]*\.(?:json|jsonl|mjs|toml|txt|md))\b/g
const ENV_ASSIGN = /\b[A-Z][A-Z0-9_]{3,}=/g
const ID_EXAMPLE = /\b[a-z][a-z0-9]*_\d{6,}[a-z0-9_]*/g
const URI_SCHEME = /\b[a-z][a-z0-9+.-]*:\/\//g
const BACKTICKED = /`([^`]+)`/g
/** camelCase 标识符：配置键与 JSON 字段名，必须原样保留。 */
const CAMEL_TOKEN = /(?<![\w$])[a-z][a-z0-9]*[A-Z][A-Za-z0-9]*(?![\w$])/g
/** 用符号说话的语言：emoji 语言把标识符也画成图，不按此规则要求。 */
const CAMEL_SAFE_LOCALES = new Set(['emoji'])

/**
 * 英文虚词：只有英语才有这些词，所以它们出现在一句中文源文的译文里就说明
 * 那句话没翻完（`Eliminar this month before`、`Falar ao create thread`）。
 * 刻意不收 in/is/of/no/as/do/or/for/not——德语、荷兰语、冰岛语、法语、葡语里
 * 它们是真词，收了就全是误报。
 */
const ENGLISH_FUNCTION_WORDS = /\b(?:the|and|please|your|yours|you|when|while|without|would|should|must|this|that|these|those|from|with|what|which|how|cannot)\b/gi
/** 借词惯用语，本语言里合法（德语/荷兰语还会写成 Drag-and-Drop 这样的连字） */
const ENGLISH_BORROWED = /\bdrag[- ]?(?:and|&)[- ]?drop\b|\bclient[- ]side\b|\bserver[- ]side\b/gi
const ENGLISH_SAFE_LOCALES = new Set(['en-UK', 'emoji'])
/** 键盘快捷键：`Ctrl+S` 之类，大小写不影响用户按键，比较时忽略大小写。 */
const SHORTCUT = /^(?:ctrl|control|shift|alt|opt|option|cmd|command|meta|fn|esc|escape|enter|return|tab|space|backspace|delete|home|end|page(?:up|down)|up|down|left|right)\b/i
// zero-width space / word joiner / BOM / soft hyphen; ZWJ and ZWNJ are meaningful (emoji, Devanagari)
const INVISIBLE = /[\u200b\u2060\ufeff\u00ad]/u
const DOUBLED_SPACE = /\p{L}  +\p{L}/u
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
	if (node && typeof node === 'object')
		for (const [key, value] of Object.entries(node)) {
			if (key === 'switch') continue
			flattenLocale(value, prefix ? `${prefix}.${key}` : key, out)
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
 * @param {string | undefined} input.reference en-UK 文案（参考译文，用于豁免有意改写）
 * @returns {{ rule: string, detail: string }[]} 命中项
 */
export function checkLeaf({ locale, key, value, source, reference }) {
	const hits = []
	if (value === null) hits.push({ rule: 'null', detail: 'value is null' })
	else if (value === '')
		if (!EMPTY_ALLOWED[locale]?.includes(key)) hits.push({ rule: 'empty', detail: 'value is empty' })

	if (typeof value !== 'string') return hits

	if (SCHEME.test(value)) hits.push({ rule: 'brand', detail: 'fonte:// instead of fount://' })
	if (!BRAND_SAFE_LOCALES.has(locale) && typeof source === 'string' && source.toLowerCase().includes('fount')) {
		for (const match of value.matchAll(BRAND))
			if (!FONT_TECH_SUFFIX.test(value.slice(match.index + match[0].length)))
				hits.push({ rule: 'brand', detail: `"${match[0]}" where the source says fount` })
		const aliases = BRAND_ALIASES[locale]
		if (aliases)
			for (const match of value.matchAll(aliases))
				hits.push({ rule: 'brand', detail: `"${match[0]}" is a translated product name (aliases)` })
	}

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

	if (INVISIBLE.test(value)) hits.push({ rule: 'invisible', detail: 'zero-width or soft-hyphen character in the copy' })
	if (DOUBLED_SPACE.test(value) && !(typeof source === 'string' && DOUBLED_SPACE.test(source)))
		hits.push({ rule: 'spacing', detail: 'doubled space between words' })
	for (const script of foreignScripts(locale, value))
		hits.push({ rule: 'script', detail: `${script} letters in a locale that does not use them` })

	if (typeof source === 'string') {
		const referenceText = typeof reference === 'string' ? reference : ''
		for (const token of new Set([...source.matchAll(FOUNT_SUBCOMMAND)].map(match => match[0])
			.concat([...source.matchAll(CLI_FLAG)].map(match => match[0]))
			.concat([...source.matchAll(FILE_PATH)].map(match => match[0]))
			.concat([...source.matchAll(DOT_FILE)].map(match => match[0]))
			.concat([...source.matchAll(ENV_ASSIGN)].map(match => match[0]))
			.concat([...source.matchAll(ID_EXAMPLE)].map(match => match[0]))
			.concat([...source.matchAll(URI_SCHEME)].map(match => match[0]))))
			if (!value.includes(token))
				hits.push({ rule: 'literal', detail: `dropped the literal token "${token}"` })
		for (const [, token] of source.matchAll(BACKTICKED)) {
			// a token the reference translation also dropped is a deliberate rewrite, not drift
			if (!referenceText.includes(token)) continue
			const present = SHORTCUT.test(token)
				? value.toLowerCase().includes(token.toLowerCase())
				: value.includes(token)
			if (!present) hits.push({ rule: 'literal', detail: `dropped the backticked literal "${token}"` })
		}
		if (!CAMEL_SAFE_LOCALES.has(locale))
			for (const [token] of source.matchAll(CAMEL_TOKEN))
				if (!value.includes(token))
					hits.push({ rule: 'identifier', detail: `dropped the identifier "${token}"` })
	}

	if (!ENGLISH_SAFE_LOCALES.has(locale) && typeof source === 'string' && HAN.test(source)) {
		const match = value.replace(ENGLISH_BORROWED, ' ').match(ENGLISH_FUNCTION_WORDS)
		if (match) hits.push({ rule: 'english', detail: `English word "${match[0]}" left in a translated value` })
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
	const reference = flattenLocale(trees['en-UK'] ?? {})
	const issues = []
	for (const [locale, tree] of Object.entries(trees)) {
		if (locale === 'zh-CN') continue
		for (const [key, value] of flattenLocale(tree))
			for (const hit of checkLeaf({ locale, key, value, source: source.get(key), reference: reference.get(key) }))
				issues.push({ locale, key, rule: hit.rule, detail: hit.detail })
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
