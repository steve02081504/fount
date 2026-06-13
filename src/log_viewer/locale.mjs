/**
 * log viewer 专用的轻量 i18n：按宿主 locale 读取 `src/public/locales/*.json`。
 * 不可复用 `src/scripts/i18n.mjs`——那会把整个服务器栈拖进这个轻量前台进程。
 */
import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'

const LOCALES_DIR = path.resolve(import.meta.dirname + '/../public/locales')
/** 兜底链尾部：主仓库翻译源为 zh-CN，en-UK 为默认语言。 */
const FALLBACK_LOCALES = ['en-UK', 'zh-CN']

/**
 * 宿主首选 locale 列表（环境变量优先，其次运行时 navigator）。
 * @returns {string[]} 形如 `zh-CN` 的 locale 列表。
 */
function hostPreferredLocales() {
	return [...new Set([
		...[process.env.LANG, process.env.LANGUAGE, process.env.LC_ALL]
			.filter(Boolean)
			.map(locale => locale.split('.')[0].replace('_', '-')),
		...globalThis.navigator?.languages ?? [globalThis.navigator?.language],
	].filter(Boolean))]
}

/**
 * 从首选列表中挑选最佳可用 locale（完全匹配优先，其次语言前缀）。
 * @param {string[]} preferred - 首选 locale 列表。
 * @param {string[]} available - 可用 locale 列表。
 * @returns {string | null} 最佳匹配，无则 `null`。
 */
function bestLocale(preferred, available) {
	const availableSet = new Set(available)
	for (const locale of preferred) {
		if (availableSet.has(locale)) return locale
		const prefix = locale.split('-')[0]
		for (const candidate of availableSet)
			if (candidate.startsWith(prefix)) return candidate
	}
	return null
}

/** @type {object[] | null} 按优先级排列的已加载 locale 数据。 */
let dataChain = null

/**
 * 加载 locale 数据链（最佳匹配 → 兜底），仅首次调用读盘。
 * @returns {object[]} locale 数据列表。
 */
function getDataChain() {
	if (dataChain) return dataChain
	dataChain = []
	let available = []
	try {
		available = fs.readdirSync(LOCALES_DIR)
			.filter(file => file.endsWith('.json'))
			.map(file => file.slice(0, -5))
	} catch { /* locales 目录缺失：仅用代码内兜底 */ }
	const chain = [...new Set([bestLocale(hostPreferredLocales(), available), ...FALLBACK_LOCALES])]
	for (const locale of chain.filter(Boolean)) try {
		dataChain.push(JSON.parse(fs.readFileSync(path.join(LOCALES_DIR, `${locale}.json`), 'utf-8')))
	} catch { /* 单个文件缺失或损坏：跳过 */ }
	return dataChain
}

/**
 * 取嵌套键值（`a.b.c`）。
 * @param {object} obj - 数据对象。
 * @param {string} key - 点分键。
 * @returns {unknown} 值，缺失为 `undefined`。
 */
function getNestedValue(obj, key) {
	let value = obj
	for (const part of key.split('.')) {
		if (!value || typeof value !== 'object' || !(part in value)) return undefined
		value = value[part]
	}
	return value
}

/**
 * 按宿主 locale 取翻译文本。
 * @param {string} key - 点分翻译键（如 `fountConsole.logViewer.replHint`）。
 * @param {string} fallback - 所有 locale 均缺失时的兜底文本。
 * @returns {string} 翻译文本。
 */
export function geti18n(key, fallback) {
	for (const data of getDataChain()) {
		const value = getNestedValue(data, key)
		if (typeof value === 'string') return value
	}
	return fallback
}
