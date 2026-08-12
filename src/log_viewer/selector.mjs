/**
 * `fount log` 选择器：从缓冲快照中挑出最近若干条（可按级别过滤）。
 *
 * 语法：`[levels][:count]` 或纯 `count`
 * - `error:5` — 最近 5 条 error
 * - `error+warn:10` — 最近 10 条 error|warn
 * - `error` — 缓冲内全部 error
 * - `5` / `:5` — 最近 5 条（任意级别）
 */

/** 选择器可用的语义级别（与 virtual-console `LogEntry.level` 对齐）。 */
export const LOG_SELECTOR_LEVELS = Object.freeze(['error', 'warn', 'info', 'log', 'debug'])

/** @type {Readonly<Record<string, string>>} */
const LEVEL_ALIASES = Object.freeze({
	err: 'error',
	warning: 'warn',
})

/**
 * @typedef {object} LogSelector
 * @property {string[] | null} levels - 允许的级别；`null` 表示不限。
 * @property {number | null} count - 取末尾条数；`null` 表示全部匹配项。
 */

/**
 * 规范化单个级别名；未知则返回 `null`。
 * @param {string} raw - 用户输入的级别片段。
 * @returns {string | null} 规范级别或 `null`。
 */
export function normalizeLogLevel(raw) {
	const key = String(raw ?? '').trim().toLowerCase()
	if (!key) return null
	const mapped = LEVEL_ALIASES[key] ?? key
	return LOG_SELECTOR_LEVELS.includes(mapped) ? mapped : null
}

/**
 * 解析选择器字符串；非法时抛错。
 * @param {string} raw - 如 `error:5`、`5`、`:3`、`error+warn`。
 * @returns {LogSelector} 规范化选择器。
 */
export function parseLogSelector(raw) {
	const text = String(raw ?? '').trim()
	if (!text) throw new Error('empty_selector')

	let levelsPart = ''
	let countPart = ''
	const colon = text.indexOf(':')
	if (colon === -1)
		if (/^\d+$/.test(text)) countPart = text
		else levelsPart = text
	else {
		levelsPart = text.slice(0, colon)
		countPart = text.slice(colon + 1)
	}

	/** @type {string[] | null} */
	let levels = null
	if (levelsPart) {
		const parts = levelsPart.split('+').map(s => s.trim()).filter(Boolean)
		if (!parts.length) throw new Error('empty_levels')
		levels = []
		for (const part of parts) {
			const level = normalizeLogLevel(part)
			if (!level) throw new Error(`unknown_level:${part}`)
			if (!levels.includes(level)) levels.push(level)
		}
	}

	/** @type {number | null} */
	let count = null
	if (countPart !== '') {
		if (!/^\d+$/.test(countPart)) throw new Error(`bad_count:${countPart}`)
		count = Number(countPart)
		if (!Number.isSafeInteger(count) || count < 1) throw new Error(`bad_count:${countPart}`)
	}

	if (levels === null && count === null) throw new Error('empty_selector')
	return { levels, count }
}

/**
 * 按选择器从条目列表中取出结果（保持原相对顺序；`count` 取末尾）。
 * @template {{ level?: string }} T
 * @param {readonly T[]} entries - 时间顺序缓冲（旧→新）。
 * @param {LogSelector} selector - {@link parseLogSelector} 结果。
 * @returns {T[]} 匹配子集。
 */
export function selectLogEntries(entries, selector) {
	const matched = selector.levels
		? entries.filter(entry => selector.levels.includes(entry?.level))
		: [...entries]
	if (selector.count == null) return matched
	return matched.slice(-selector.count)
}

/**
 * 选择器用法说明（stderr）。
 * @returns {string} 多行帮助文本。
 */
export function logSelectorUsage() {
	return [
		'usage: fount log [selector]',
		'  selector: [levels][:count] | count',
		'  levels:   error|warn|info|log|debug (combine with +)',
		'  examples: fount log error:5',
		'            fount log error+warn:10',
		'            fount log :20',
		'            fount log 5',
	].join('\n')
}
