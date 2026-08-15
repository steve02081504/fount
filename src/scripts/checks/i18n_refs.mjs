/**
 * 【文件】i18n_refs.mjs
 * 【职责】静态校验 i18n 引用：data-i18n / setElementI18n 对象须含 DOM applicator；字符串 API 与 CLI 键须落到 string。
 * 【原理】对照 zh-CN（或传入）locale 解析点分键；对象模式仅认 placeholder/title/…/textContent/innerHTML/dataset。
 * 【关联】walk.mjs、pages/scripts/i18n translateSingularElement、path/fount.{ps1,sh} Get-I18n/get_i18n。
 */

import { isSwitchValue } from '../i18n/switch_value.mjs'

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
 * @typedef {{ kind: 'missing' | 'object_not_element' | 'object_not_string', key: string, path?: string, line?: number, message: string }} I18nRefIssue
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
 * @returns {{ key: string, line: number, binding: 'element' | 'string' | 'geti18n' }[]} 引用
 */
export function extractI18nRefsFromSource(text) {
	/** @type {{ key: string, line: number, binding: 'element' | 'string' | 'geti18n' }[]} */
	const refs = []
	/**
	 * @param {number} index 字符索引
	 * @returns {number} 1-based 行号
	 */
	const lineAt = (index) => text.slice(0, index).split('\n').length

	for (const match of text.matchAll(/\bdata-i18n\s*=\s*"([^"]*)"/g)) {
		const line = lineAt(match.index ?? 0)
		for (const key of splitDataI18nKeys(match[1]))
			refs.push({ key, line, binding: 'element' })
	}
	for (const match of text.matchAll(/\bdata-i18n\s*=\s*'([^']*)'/g)) {
		const line = lineAt(match.index ?? 0)
		for (const key of splitDataI18nKeys(match[1]))
			refs.push({ key, line, binding: 'element' })
	}

	for (const match of text.matchAll(/\bsetElementI18n\s*\(\s*[^,]+,\s*(["'`])([^"'`]+)\1/g))
		refs.push({ key: match[2], line: lineAt(match.index ?? 0), binding: 'element' })

	/** @type {Record<string, 'string' | 'geti18n'>} */
	const apis = {
		geti18n: 'geti18n',
		geti18n_nowarn: 'geti18n',
		confirmI18n: 'string',
		alertI18n: 'string',
		promptI18n: 'string',
		showToastI18n: 'string',
		promptText: 'string',
		promptTextArea: 'string',
		confirmAction: 'string',
	}
	// 仅前端 features/errorHandlers 的工厂形式：首参是 i18n key；后端 scripts/errorHandlers 首参是 error。
	if (/\bimport\s*\{[^}]*\bhandleError\b[^}]*\}\s*from\s*['"][^'"]*features\/errorHandlers\.mjs['"]/.test(text))
		apis.handleError = 'string'

	for (const [name, binding] of Object.entries(apis)) {
		const re = new RegExp(`\\b${name}\\s*\\(\\s*(["'\`])([^"'\`]+)\\1`, 'g')
		for (const match of text.matchAll(re)) {
			let key = match[2]
			// showToastI18n('success', 'key') — first arg is level
			if (name === 'showToastI18n' && ['success', 'error', 'warning', 'info'].includes(key)) {
				const rest = text.slice((match.index ?? 0) + match[0].length)
				const second = rest.match(/^\s*,\s*(["'`])([^"'`]+)\1/)
				if (!second) continue
				key = second[2]
			}
			refs.push({ key, line: lineAt(match.index ?? 0), binding })
		}
	}

	return refs
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
	for (const match of text.matchAll(/\b(?:Get-I18n\s+-key|get_i18n|print_i18n(?:_red|_yellow|_green)?)\s+'(?:([^']+))'/g))
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
