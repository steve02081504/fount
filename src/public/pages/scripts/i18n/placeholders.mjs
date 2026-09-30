/**
 * i18n 插值占位符工具：从翻译文本提取 `${name}` 名称，并找出调用方 params 未提供的名称。
 * `\${name}` 为字面义转义（渲染成 `${name}` 文本），不计入占位符。
 * 供前端 i18n、后端 i18n 与静态检查共用；switch / 数组节点经 `./switch_value.mjs` 解包。
 */
import { isSwitchValue, resolveSwitchCase } from './switch_value.mjs'

/** 未转义的 `${name}` 占位符；`\${` 前缀视为字面义而跳过。 */
const PLACEHOLDER_RE = /(?<!\\)\$\{([^{}]*)\}/g

/**
 * 提取翻译文本中的占位符名称（按首次出现顺序去重）。
 * @param {string} text - 翻译文本。
 * @returns {string[]} 占位符名称列表。
 */
export function extractPlaceholders(text) {
	const names = []
	for (const match of String(text).matchAll(PLACEHOLDER_RE))
		if (!names.includes(match[1])) names.push(match[1])
	return names
}

/**
 * 找出翻译文本里 params 未提供的占位符名称。
 * @param {string} text - 翻译文本。
 * @param {Record<string, unknown>} [params] - 插值参数。
 * @returns {string[]} 缺失的占位符名称列表。
 */
export function missingPlaceholders(text, params = {}) {
	return extractPlaceholders(text).filter(name => !(name in params))
}

/**
 * 收集翻译节点（字符串 / switch 命中分支 / 数组元素）里 params 未提供的占位符名。
 * 纯对象（如 `data-i18n` applicator 映射）不递归——其字段各自经 geti18n 渲染。
 * @param {unknown} translation - 翻译节点。
 * @param {Record<string, unknown>} [params] - 插值参数。
 * @returns {Set<string>} 缺失的占位符名集合。
 */
export function collectMissingPlaceholders(translation, params = {}) {
	if (isSwitchValue(translation))
		return collectMissingPlaceholders(resolveSwitchCase(translation, params), params)
	const missing = new Set()
	if (Array.isArray(translation)) {
		for (const item of translation)
			for (const name of collectMissingPlaceholders(item, params)) missing.add(name)
		return missing
	}
	for (const name of missingPlaceholders(String(translation), params)) missing.add(name)
	return missing
}
