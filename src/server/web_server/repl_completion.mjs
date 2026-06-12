/**
 * `/ws/eval` REPL 补全：上下文解析、候选前缀匹配与 wire 载荷组装。
 */

/** @type {ReadonlySet<string>} */
export const JS_KEYWORDS = new Set([
	'async', 'await', 'break', 'case', 'catch', 'class', 'const', 'continue',
	'debugger', 'default', 'delete', 'do', 'else', 'export', 'extends', 'false',
	'finally', 'for', 'function', 'if', 'import', 'in', 'instanceof', 'let',
	'new', 'null', 'of', 'return', 'super', 'switch', 'this', 'throw', 'true',
	'try', 'typeof', 'undefined', 'var', 'void', 'while', 'with', 'yield',
])

/**
 * 在 `before` 中查找最后一个不在字符串/模板字面量内的 `.`。
 * @param {string} before - 光标前的文本。
 * @returns {number} 下标，无则 -1。
 */
export function findLastDotOutsideStrings(before) {
	let inSingle = false
	let inDouble = false
	let inTemplate = false
	let escape = false
	let lastDot = -1
	for (let i = 0; i < before.length; i++) {
		const ch = before[i]
		if (escape) {
			escape = false
			continue
		}
		if (ch === '\\') {
			escape = true
			continue
		}
		if (!inDouble && ch === '\'') {
			inSingle = !inSingle
			continue
		}
		if (!inSingle && ch === '"') {
			inDouble = !inDouble
			continue
		}
		if (!inSingle && !inDouble && ch === '`') {
			inTemplate = !inTemplate
			continue
		}
		if (!inSingle && !inDouble && !inTemplate && ch === '.')
			lastDot = i
	}
	return lastDot
}

/**
 * 解析补全上下文：成员访问或裸标识符。
 * @param {string} code - 完整输入。
 * @param {number} cursor - 光标偏移。
 * @returns {{ kind: 'member', receiver: string, fragment: string, replaceStart: number, replaceEnd: number } | { kind: 'identifier', fragment: string, replaceStart: number, replaceEnd: number } | null} 补全上下文，无法解析时为 `null`。
 */
export function parseCompletionContext(code, cursor) {
	const before = code.slice(0, Math.max(0, Math.min(cursor, code.length)))
	const lastDot = findLastDotOutsideStrings(before)
	if (lastDot >= 0) {
		const receiver = before.slice(0, lastDot).trimEnd()
		const fragment = before.slice(lastDot + 1)
		if (!receiver) return null
		return {
			kind: 'member',
			receiver,
			fragment,
			replaceStart: lastDot + 1,
			replaceEnd: cursor,
		}
	}
	const idMatch = before.match(/([\w$]*)$/)
	if (!idMatch) return null
	const fragment = idMatch[1]
	return {
		kind: 'identifier',
		fragment,
		replaceStart: cursor - fragment.length,
		replaceEnd: cursor,
	}
}

/**
 * 已输入前缀与候选项的大小写不敏感公共前缀长度。
 * @param {string} typed - 已输入片段。
 * @param {string} candidate - 候选项完整文本。
 * @returns {number} 匹配长度。
 */
export function sharedCompletionPrefixLength(typed, candidate) {
	let i = 0
	while (i < typed.length && i < candidate.length
		&& typed[i].toLowerCase() === candidate[i].toLowerCase())
		i++
	return i
}

/**
 * 候选项是否以已输入片段为前缀（大小写不敏感）。
 * @param {string} typed - 已输入片段。
 * @param {string} candidate - 候选项完整文本。
 * @returns {boolean} 是否匹配。
 */
export function matchesCompletionPrefix(typed, candidate) {
	return sharedCompletionPrefixLength(typed, candidate) === typed.length
}

/**
 * 按前缀过滤候选项（大小写不敏感）。
 * @param {string} fragment - 已输入前缀。
 * @param {Iterable<string>} names - 候选名集合。
 * @returns {string[]} 匹配项。
 */
export function filterByCompletionPrefix(fragment, names) {
	return [...names].filter(n => matchesCompletionPrefix(fragment, n))
}

/**
 * 计算行内幽灵补全后缀（已输入前缀之后的剩余部分）。
 * @param {string} input - 当前输入。
 * @param {number} replaceStart - 替换区间起点。
 * @param {number} replaceEnd - 替换区间终点。
 * @param {string} candidate - 当前候选完整文本。
 * @returns {string} 幽灵后缀（纯文本）；无剩余或无法匹配时为空。
 */
export function completionGhostSuffix(input, replaceStart, replaceEnd, candidate) {
	const typed = input.slice(replaceStart, replaceEnd)
	const matched = sharedCompletionPrefixLength(typed, candidate)
	if (matched < typed.length || matched >= candidate.length) return ''
	return candidate.slice(matched)
}

/**
 * 为 wire 补全响应附加与 `items` 对齐的幽灵后缀列表。
 * @param {string} code - 请求时的完整输入。
 * @param {{ items: string[], replaceStart: number, replaceEnd: number }} result - 补全结果。
 * @returns {{ items: string[], replaceStart: number, replaceEnd: number, suffixes: string[] }} wire 载荷。
 */
export function enrichCompletionWirePayload(code, result) {
	const { items, replaceStart, replaceEnd } = result
	const suffixes = items.map(item => completionGhostSuffix(code, replaceStart, replaceEnd, item))
	return { items, replaceStart, replaceEnd, suffixes }
}
