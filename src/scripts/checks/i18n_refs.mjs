/**
 * 【文件】i18n_refs.mjs
 * 【职责】静态校验 i18n 引用：data-i18n / setElementI18n 对象须含 DOM applicator；字符串 API 与 CLI 键须落到 string。
 * 【原理】对照 zh-CN（或传入）locale 解析点分键；对象模式仅认 placeholder/title/…/textContent/innerHTML/dataset。
 * 【关联】walk.mjs、pages/scripts/i18n translateSingularElement、path/fount.{ps1,sh} Get-I18n/get_i18n。
 */

import { extractPlaceholders } from '../../public/pages/scripts/i18n/placeholders.mjs'
import { isSwitchValue } from '../i18n/switch_value.mjs'

/** showToastI18n 的级别参数（首参为级别时，键在第二位）。 */
const TOAST_LEVELS = new Set(['success', 'error', 'warning', 'info'])

/** data-i18n 对象模式可写入元素的字段（与前端 translateSingularElement 对齐）。 */
export const I18N_ELEMENT_APPLICATOR_KEYS = [
	'placeholder',
	'title',
	'label',
	'value',
	'alt',
	'aria-label',
	'textContent',
	'innerHTML',
	'dataset',
]

/**
 * @param {unknown} value locale 节点
 * @returns {boolean} 是否为可作 data-i18n 目标的对象（含 ≥1 applicator）
 */
export function isI18nElementObject(value) {
	if (!value || typeof value !== 'object' || Array.isArray(value)) return false
	return I18N_ELEMENT_APPLICATOR_KEYS.some(key => Object.hasOwn(value, key))
}

/**
 * @param {unknown} root locale 根
 * @param {string} key 点分键
 * @returns {unknown} 嵌套值；缺失为 undefined
 */
export function getLocaleValue(root, key) {
	if (!key) return undefined
	let current = root
	for (const part of key.split('.')) {
		if (!current || typeof current !== 'object' || Array.isArray(current) || !(part in current))
			return undefined
		current = current[part]
	}
	return current
}

/**
 * @typedef {{ kind: 'missing' | 'object_not_element' | 'object_not_string' | 'missing_placeholder', key: string, path?: string, line?: number, message: string }} I18nRefIssue
 */

/** 静态点分键：≥2 段，无 `${}` / `{{` 插值。 */
const STATIC_I18N_KEY_RE = /^[A-Za-z][\w-]*(?:\.[A-Za-z][\w-]*)+$/

/**
 * 是否为可静态解析的 i18n 键（模板插值键跳过）。
 * @param {string} key 候选键
 * @returns {boolean} 静态则为 true
 */
export function isStaticI18nKey(key) {
	return STATIC_I18N_KEY_RE.test(key)
}

/**
 * 校验 data-i18n / setElementI18n 类「绑到元素」的键。
 * @param {unknown} root locale 根
 * @param {string} key 点分键
 * @returns {I18nRefIssue | null} 问题或 null
 */
export function checkElementI18nKey(root, key) {
	if (!isStaticI18nKey(key)) return null
	const value = getLocaleValue(root, key)
	if (value === undefined)
		return { kind: 'missing', key, message: `element i18n key missing: ${key}` }
	if (typeof value === 'string' || Array.isArray(value) || isSwitchValue(value)) return null
	if (typeof value === 'object') {
		if (isI18nElementObject(value)) return null
		const hint = Object.hasOwn(value, 'main')
			? ` object has "main" but no DOM applicator — use ${key}.main (or textContent/title/…)`
			: ' object has no DOM applicator field (textContent/title/aria-label/…)'
		return { kind: 'object_not_element', key, message: `element i18n key ${key}:${hint}` }
	}
	return { kind: 'missing', key, message: `element i18n key unusable type: ${key}` }
}

/**
 * 校验 confirmI18n / showToastI18n / CLI 等「必须是字符串」的键。
 * @param {unknown} root locale 根
 * @param {string} key 点分键
 * @returns {I18nRefIssue | null} 问题或 null
 */
export function checkStringI18nKey(root, key) {
	if (!isStaticI18nKey(key)) return null
	const value = getLocaleValue(root, key)
	if (value === undefined)
		return { kind: 'missing', key, message: `string i18n key missing: ${key}` }
	if (typeof value === 'string') return null
	if (Array.isArray(value)) return null
	if (isSwitchValue(value)) return null
	if (value && typeof value === 'object') {
		const hint = Object.hasOwn(value, 'main')
			? ` resolves to object — use ${key}.main (or a string leaf)`
			: ' resolves to object, not a string'
		return { kind: 'object_not_string', key, message: `string i18n key ${key}:${hint}` }
	}
	return { kind: 'missing', key, message: `string i18n key unusable type: ${key}` }
}

/**
 * 校验 geti18n：允许返回对象（如 util.zxcvbn 整包），仅抓缺失。
 * @param {unknown} root locale 根
 * @param {string} key 点分键
 * @returns {I18nRefIssue | null} 问题或 null
 */
export function checkGeti18nKey(root, key) {
	if (!isStaticI18nKey(key)) return null
	if (getLocaleValue(root, key) === undefined)
		return { kind: 'missing', key, message: `geti18n key missing: ${key}` }
	return null
}

/**
 * 收集 locale 叶子（含 switch 各分支 / 数组元素）声明的占位符名。
 * @param {unknown} value locale 节点
 * @returns {string[]} 占位符名列表（含重复）
 */
function valuePlaceholders(value) {
	if (typeof value === 'string') return extractPlaceholders(value)
	if (isSwitchValue(value)) {
		const names = valuePlaceholders(value.default)
		for (const caseValue of Object.values(value.cases ?? {})) names.push(...valuePlaceholders(caseValue))
		return names
	}
	if (Array.isArray(value)) return value.flatMap(valuePlaceholders)
	return []
}

/**
 * 校验调用点内联对象是否覆盖 locale 文本声明的占位符（未定义占位符）。
 * `params === null` 表示实参非字面量对象（静态不可知），跳过。
 * @param {unknown} root locale 根
 * @param {string} key 点分键
 * @param {string[] | null} params 调用点静态已知的参数名（null = 未知）
 * @param {string[]} [extraParams] 调用点自动注入的参数名（如 handleError 的 error）
 * @returns {I18nRefIssue | null} 问题或 null
 */
export function checkI18nPlaceholders(root, key, params, extraParams = []) {
	if (params === null || !isStaticI18nKey(key)) return null
	const value = getLocaleValue(root, key)
	if (value === undefined) return null
	const provided = new Set([...params, ...extraParams])
	const missing = [...new Set(valuePlaceholders(value))].filter(name => !provided.has(name))
	if (!missing.length) return null
	return {
		kind: 'missing_placeholder',
		key,
		message: `i18n key ${key} declares placeholder(s) not provided at the call site: ${missing.join(', ')}`,
	}
}

/**
 * 拆 data-i18n 多键（`;` 分隔）；跳过 `'literal'`。
 * @param {string} raw data-i18n 属性值
 * @returns {string[]} 点分键列表
 */
export function splitDataI18nKeys(raw) {
	return raw.split(';').map(part => part.trim()).filter(part => {
		if (!part) return false
		if (part.startsWith('\'') && part.endsWith('\'')) return false
		return true
	})
}

/**
 * 从源码文本提取 data-i18n / setElementI18n / 字符串 API 键。
 * @param {string} text 源码
 * @returns {{ key: string, line: number, binding: 'element' | 'string' | 'geti18n', params: string[] | null, extraParams?: string[] }[]} 引用
 */
export function extractI18nRefsFromSource(text) {
	/** @type {{ key: string, line: number, binding: 'element' | 'string' | 'geti18n', params: string[] | null, extraParams?: string[] }[]} */
	const refs = []
	/**
	 * @param {number} index 字符索引
	 * @returns {number} 1-based 行号
	 */
	const lineAt = (index) => text.slice(0, index).split('\n').length

	for (const match of text.matchAll(/\bdata-i18n\s*=\s*"([^"]*)"/g)) {
		const line = lineAt(match.index ?? 0)
		for (const key of splitDataI18nKeys(match[1]))
			refs.push({ key, line, binding: 'element', params: null })
	}
	for (const match of text.matchAll(/\bdata-i18n\s*=\s*'([^']*)'/g)) {
		const line = lineAt(match.index ?? 0)
		for (const key of splitDataI18nKeys(match[1]))
			refs.push({ key, line, binding: 'element', params: null })
	}

	for (const match of text.matchAll(/\bsetElementI18n\s*\(/g)) {
		const open = (match.index ?? 0) + match[0].length - 1
		const close = findMatchingParen(text, open)
		if (close < 0) continue
		const args = splitTopLevelArgs(text.slice(open + 1, close))
		const keyMatch = args[1]?.match(/^(["'`])([^"'`]+)\1$/)
		if (!keyMatch) continue
		// 插值参数来自 element.dataset（含 HTML 上的 data-*），静态不可全知 → 不做占位符覆盖校验
		refs.push({ key: keyMatch[2], line: lineAt(match.index ?? 0), binding: 'element', params: null })
	}

	/** @type {Record<string, { binding: 'string' | 'geti18n', keyIndex: number, paramsIndex?: number, extraParams?: string[] }>} */
	const apis = {
		geti18n: { binding: 'geti18n', keyIndex: 0 },
		geti18n_nowarn: { binding: 'geti18n', keyIndex: 0 },
		geti18nForTerminal: { binding: 'geti18n', keyIndex: 0 },
		confirmI18n: { binding: 'string', keyIndex: 0 },
		alertI18n: { binding: 'string', keyIndex: 0 },
		promptI18n: { binding: 'string', keyIndex: 0 },
		showToastI18n: { binding: 'string', keyIndex: 1 },
		// promptText / promptTextArea 的第二参是初始值，插值参数在第三参
		promptText: { binding: 'string', keyIndex: 0, paramsIndex: 2 },
		promptTextArea: { binding: 'string', keyIndex: 0, paramsIndex: 2 },
		confirmAction: { binding: 'string', keyIndex: 0 },
		logI18n: { binding: 'string', keyIndex: 0 },
		warnI18n: { binding: 'string', keyIndex: 0 },
		errorI18n: { binding: 'string', keyIndex: 0 },
		infoI18n: { binding: 'string', keyIndex: 0 },
		freshLineI18n: { binding: 'string', keyIndex: 1 },
	}
	// 仅前端 features/errorHandlers 的工厂形式：首参是 i18n key；后端 scripts/errorHandlers 首参是 error。
	if (/\bimport\s*{[^}]*\bhandleError\b[^}]*}\s*from\s*["'][^"']*features\/errorHandlers\.mjs["']/.test(text))
		apis.handleError = { binding: 'string', keyIndex: 0, extraParams: ['error'] }

	for (const [name, config] of Object.entries(apis)) {
		const re = new RegExp(`\\b${name}\\s*\\(`, 'g')
		for (const match of text.matchAll(re)) {
			const open = (match.index ?? 0) + match[0].length - 1
			const close = findMatchingParen(text, open)
			if (close < 0) continue
			const args = splitTopLevelArgs(text.slice(open + 1, close))
			let keyIndex = config.keyIndex
			// showToastI18n('success', 'key') — 首参为级别时键在后一位；无级别时键在首位
			if (name === 'showToastI18n') keyIndex = TOAST_LEVELS.has(literalValue(args[0])) ? 1 : 0
			const key = literalValue(args[keyIndex])
			if (!key) continue
			const paramsArg = args[config.paramsIndex ?? keyIndex + 1]
			const params = paramsArg === undefined ? [] : inlineObjectKeys(paramsArg)
			refs.push({ key, line: lineAt(match.index ?? 0), binding: config.binding, params, extraParams: config.extraParams })
		}
	}

	return refs
}

/**
 * 字符串字面量的值；非字符串字面量为 null。
 * @param {string | undefined} source 实参文本
 * @returns {string | null} 字面量值或 null
 */
function literalValue(source) {
	const match = source?.match(/^(["'`])([^"'`]+)\1$/)
	return match ? match[2] : null
}

/**
 * 跳过 `openIndex` 处的字符串字面量（处理反斜杠转义）。
 * @param {string} text 源码
 * @param {number} openIndex 开引号下标
 * @returns {number} 闭引号下标；未闭合为末尾
 */
function skipStringLiteral(text, openIndex) {
	const quote = text[openIndex]
	let index = openIndex
	while (++index < text.length && text[index] !== quote)
		if (text[index] === '\\') index++
	return index
}

/**
 * 找到 `openIndex` 处 `(` 的配对 `)`（跳过字符串字面量）。
 * @param {string} text 源码
 * @param {number} openIndex `(` 的下标
 * @returns {number} 配对 `)` 下标；未配对为 -1
 */
function findMatchingParen(text, openIndex) {
	let depth = 0
	for (let index = openIndex; index < text.length; index++) {
		const char = text[index]
		if (char === '(') depth++
		else if (char === ')') {
			depth--
			if (!depth) return index
		}
		else if (char === '"' || char === '\'' || char === '`')
			index = skipStringLiteral(text, index)
	}
	return -1
}

/**
 * 按顶层逗号切分实参文本（跳过嵌套括号与字符串）。
 * @param {string} source 括号内文本
 * @returns {string[]} 修剪后的实参
 */
function splitTopLevelArgs(source) {
	const args = []
	let depth = 0
	let start = 0
	for (let index = 0; index < source.length; index++) {
		const char = source[index]
		if (char === '(' || char === '[' || char === '{') depth++
		else if (char === ')' || char === ']' || char === '}') depth--
		else if (char === '"' || char === '\'' || char === '`')
			index = skipStringLiteral(source, index)
		else if (char === ',' && !depth) {
			args.push(source.slice(start, index).trim())
			start = index + 1
		}
	}
	const last = source.slice(start).trim()
	if (last) args.push(last)
	return args
}

/**
 * 从内联对象字面量提取键名；非对象字面量 / 含展开 / 计算键时为 null（静态不可知）。
 * @param {string} source 实参文本
 * @returns {string[] | null} 键名列表或 null
 */
function inlineObjectKeys(source) {
	if (!source.startsWith('{') || !source.endsWith('}')) return null
	const inner = source.slice(1, -1).trim()
	if (!inner) return []
	if (inner.includes('...')) return null
	const keys = []
	for (const part of splitTopLevelArgs(inner)) {
		if (part.startsWith('[')) return null
		const match = part.match(/^(?:([A-Za-z_$][\w$]*)|["']([^"']+)["'])\s*(?::|$)/)
		if (!match) return null
		keys.push(match[1] ?? match[2])
	}
	return keys
}

/**
 * 从 path CLI / runner 脚本提取相对 fountConsole.path 的键。
 * @param {string} text 脚本正文
 * @returns {{ key: string, line: number }[]} 相对键（仍带 remove.… 前缀）
 */
export function extractFountConsolePathKeys(text) {
	/** @type {{ key: string, line: number }[]} */
	const refs = []
	/**
	 * @param {number} index 字符索引
	 * @returns {number} 1-based 行号
	 */
	const lineAt = (index) => text.slice(0, index).split('\n').length
	for (const match of text.matchAll(/\b(?:Get-I18n\s+-key|get_i18n|print_i18n(?:_red|_yellow|_green)?)\s+'([^']+)'/g))
		refs.push({ key: match[1], line: lineAt(match.index ?? 0) })
	return refs
}

/**
 * @param {unknown} root locale 根
 * @param {string} text 源码
 * @param {string} [path] 文件路径（写入 issue）
 * @returns {I18nRefIssue[]} 问题列表
 */
export function scanSourceI18nRefs(root, text, path = '') {
	/** @type {I18nRefIssue[]} */
	const issues = []
	for (const ref of extractI18nRefsFromSource(text)) {
		const issue = ref.binding === 'element'
			? checkElementI18nKey(root, ref.key)
			: ref.binding === 'geti18n'
				? checkGeti18nKey(root, ref.key)
				: checkStringI18nKey(root, ref.key)
		if (issue) issues.push({ ...issue, path, line: ref.line })
		const placeholderIssue = checkI18nPlaceholders(root, ref.key, ref.params, ref.extraParams)
		if (placeholderIssue) issues.push({ ...placeholderIssue, path, line: ref.line })
	}
	return issues
}

/**
 * @param {unknown} localeRoot 完整 locale（含 fountConsole）
 * @param {string} text 脚本正文
 * @param {string} [path] 文件路径
 * @returns {I18nRefIssue[]} 问题列表
 */
export function scanFountConsolePathScript(localeRoot, text, path = '') {
	const pathRoot = getLocaleValue(localeRoot, 'fountConsole.path')
	/** @type {I18nRefIssue[]} */
	const issues = []
	for (const ref of extractFountConsolePathKeys(text)) {
		const issue = checkStringI18nKey(pathRoot, ref.key)
		if (issue) issues.push({ ...issue, path, line: ref.line })
	}
	return issues
}
