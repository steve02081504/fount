/**
 * 浏览器 REPL 成对符号编辑（与终端 {@link module:keys} 行为一致）。
 */

/** 开符号 → 闭符号。 @type {ReadonlyMap<string, string>} */
export const OPEN_TO_CLOSE = new Map([
	['\'', '\''],
	['"', '"'],
	['`', '`'],
	['(', ')'],
	['[', ']'],
	['{', '}'],
	['（', '）'],
	['﹙', '﹚'],
	['【', '】'],
	['［', '］'],
	['﹝', '﹞'],
	['｛', '｝'],
	['﹛', '﹜'],
	['「', '」'],
	['『', '』'],
	['《', '》'],
	['〈', '〉'],
	['〔', '〕'],
	['〖', '〗'],
	['〘', '〙'],
	['〚', '〛'],
	['｢', '｣'],
	['＇', '＇'],
	['＂', '＂'],
	['\u2018', '\u2019'],
	['\u201C', '\u201D'],
])

/** @type {ReadonlySet<string>} */
export const CLOSE_CHARS = new Set(OPEN_TO_CLOSE.values())

/**
 * @param {string} text - 文本。
 * @param {number} offset - 偏移。
 * @returns {string | null} 前一 Unicode 字符。
 */
function charBefore(text, offset) {
	if (offset <= 0) return null
	const head = text.slice(0, offset)
	const code = head.codePointAt(head.length - 1)
	return code === undefined ? null : String.fromCodePoint(code)
}

/**
 * @param {string} text - 文本。
 * @param {number} offset - 偏移。
 * @returns {string | null} 当前 Unicode 字符。
 */
function charAt(text, offset) {
	if (offset >= text.length) return null
	const code = text.codePointAt(offset)
	return code === undefined ? null : String.fromCodePoint(code)
}

/**
 * 插入单字符：开符号补闭符号；重复输入闭符号则跳过已有闭符号。
 * @param {string} value - 当前文本。
 * @param {number} caret - 光标（无选区）。
 * @param {string} ch - 待插入字符。
 * @returns {{ value: string, caret: number }} 新文本与光标。
 */
export function editInsertChar(value, caret, ch) {
	const close = OPEN_TO_CLOSE.get(ch)
	if (close !== undefined)
		return { value: value.slice(0, caret) + ch + close + value.slice(caret), caret: caret + ch.length }
	const next = charAt(value, caret)
	if (CLOSE_CHARS.has(ch) && next === ch)
		return { value, caret: caret + ch.length }
	return { value: value.slice(0, caret) + ch + value.slice(caret), caret: caret + ch.length }
}

/**
 * 退格：空成对符号时一并删除闭符号。
 * @param {string} value - 当前文本。
 * @param {number} caret - 光标（无选区）。
 * @returns {{ value: string, caret: number } | null} 新状态；无法退格时 `null`。
 */
export function editBackspace(value, caret) {
	if (caret <= 0) return null
	const before = charBefore(value, caret)
	if (!before) return null
	const beforeLen = before.length
	const after = charAt(value, caret)
	if (after && OPEN_TO_CLOSE.get(before) === after)
		return {
			value: value.slice(0, caret - beforeLen) + value.slice(caret + after.length),
			caret: caret - beforeLen,
		}
	return { value: value.slice(0, caret - beforeLen) + value.slice(caret), caret: caret - beforeLen }
}

/**
 * 是否应对该次 `beforeinput` 使用成对符号编辑。
 * @param {InputEvent} event - `beforeinput` 事件。
 * @returns {boolean} 是否为成对符号相关的插入/退格。
 */
export function isPairInputEvent(event) {
	if (event.inputType === 'insertText' && event.data?.length === 1)
		return OPEN_TO_CLOSE.has(event.data) || CLOSE_CHARS.has(event.data)
	return event.inputType === 'deleteContentBackward'
}
