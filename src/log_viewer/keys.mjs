/**
 * REPL 按键语义与文本编辑的纯函数集合：
 * Kitty / CSI-u 序列识别、成对符号表、词界跳转与粘贴规范化。
 */

/** 括号粘贴开始标记。 */
export const PASTE_START = '\x1b[200~'
/** 括号粘贴结束标记。 */
export const PASTE_END = '\x1b[201~'
/** 开启括号粘贴模式。 */
export const BRACKETED_PASTE_ON = '\x1b[?2004h'
/** 关闭括号粘贴模式。 */
export const BRACKETED_PASTE_OFF = '\x1b[?2004l'

const WORD_CHAR = /[\w$]/
/** xterm Shift+Enter CSI（如 `[13;2~`）；keycode 常映射为 `f3`+Shift。 */
const SHIFT_ENTER_CSI = /;2;13|\[13;2[~u$^]|\b13;2[~u]/

/**
 * 解析后的按键事件（由 `@cliffy/keycode` 的 `KeyCode` 适配）。
 * @typedef {object} KeyEvent
 * @property {string} [key] - 键名（如 `return` / `enter` / `up`）。
 * @property {string} [char] - 字符值（可打印键）。
 * @property {string} [sequence] - 原始转义序列。
 * @property {string} [code] - CSI code（如 `[13;2u`）。
 * @property {boolean} ctrlKey - Ctrl 修饰。
 * @property {boolean} metaKey - Meta/Alt 修饰。
 * @property {boolean} shiftKey - Shift 修饰。
 */

/** 开符号 → 闭符号（半角/全角/弯引号/直角与书名号/夹注与隅足号等）。 @type {ReadonlyMap<string, string>} */
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
 * 解析 Kitty / CSI-u 按键（keycode 常解析为 `undefined`）。
 * @param {KeyEvent} event - 按键事件。
 * @returns {'submit' | 'newline' | 'ctrlBackspace' | 'interrupt' | null} 动作或 `null`。
 */
export function kittyKeyAction(event) {
	const src = event.code ?? event.sequence ?? ''
	if (!src) return null
	if (/99;5u/.test(src)) return 'interrupt'
	if (/\[13;2u$/.test(src) || (/13;2[~u]/.test(src) && /;2/.test(src))) return 'newline'
	const enter = src.match(/\[13(?:;(\d+))?u$/) ?? src.match(/13(?:;(\d+))?u/)
	if (enter) {
		const mod = Number(enter[1] ?? '1')
		if (mod === 2) return 'newline'
		if (mod === 1 || mod === 5) return 'submit'
	}
	if (/\[127;5u$/.test(src) || /127;5u/.test(src)) return 'ctrlBackspace'
	return null
}

/**
 * 是否为 Shift+Enter 的 xterm / 集成终端 CSI 变体。
 * @param {KeyEvent} event - 按键事件。
 * @returns {boolean} 是否应插入换行。
 */
export function isShiftEnterCsi(event) {
	const seq = event.sequence ?? ''
	const code = event.code ?? ''
	if (/13;2[~u$^]/.test(seq) || /13;2[~u$^]/.test(code)) return true
	if (SHIFT_ENTER_CSI.test(seq)) return true
	if (event.code === '[13~' && event.shiftKey) return true
	if (event.key === 'f3' && event.shiftKey) return true
	return false
}

/**
 * 过滤 IME 切换等产生的无效按键（避免吞掉后续真实按键）。
 * @param {KeyEvent} event - 按键事件。
 * @returns {boolean} 是否应忽略。
 */
export function isImeNoise(event) {
	if (event.char === '\x00') return true
	if (event.key === 'undefined' && !event.char) return true
	return false
}

/**
 * 向左跳到词界（readline 风格：`\w` 为词字符）。
 * @param {string} text - 纯文本。
 * @param {number} pos - 当前偏移。
 * @returns {number} 新偏移。
 */
export function prevWordBoundary(text, pos) {
	if (pos <= 0) return 0
	let i = pos - 1
	while (i > 0 && /\s/.test(text[i])) i--
	if (WORD_CHAR.test(text[i])) {
		while (i > 0 && WORD_CHAR.test(text[i - 1])) i--
		return i
	}
	while (i > 0 && !/\s/.test(text[i - 1])) i--
	return i
}

/**
 * 向右跳到词界。
 * @param {string} text - 纯文本。
 * @param {number} pos - 当前偏移。
 * @returns {number} 新偏移。
 */
export function nextWordBoundary(text, pos) {
	if (pos >= text.length) return text.length
	let i = pos
	if (WORD_CHAR.test(text[i]))
		while (i < text.length && WORD_CHAR.test(text[i])) i++
	else if (!/\s/.test(text[i]))
		while (i < text.length && !/\s/.test(text[i])) i++
	while (i < text.length && /\s/.test(text[i])) i++
	return i
}

/**
 * 从光标处向前删除一个词。
 * @param {string} text - 纯文本。
 * @param {number} pos - 当前偏移。
 * @returns {{ text: string, pos: number }} 新文本与光标。
 */
export function deleteWordForward(text, pos) {
	const end = nextWordBoundary(text, pos)
	return { text: text.slice(0, pos) + text.slice(end), pos }
}

/**
 * 从光标处向后删除一个词。
 * @param {string} text - 纯文本。
 * @param {number} pos - 当前偏移。
 * @returns {{ text: string, pos: number }} 新文本与光标。
 */
export function deleteWordBackward(text, pos) {
	const start = prevWordBoundary(text, pos)
	return { text: text.slice(0, start) + text.slice(pos), pos: start }
}

/**
 * 取偏移前的最后一个 Unicode 字符。
 * @param {string} text - 纯文本。
 * @param {number} offset - 光标偏移。
 * @returns {string | null} 前一字符，无则 `null`。
 */
export function charBefore(text, offset) {
	if (offset <= 0) return null
	const head = text.slice(0, offset)
	const code = head.codePointAt(head.length - 1)
	return code === undefined ? null : String.fromCodePoint(code)
}

/**
 * 取偏移处 Unicode 字符。
 * @param {string} text - 纯文本。
 * @param {number} offset - 光标偏移。
 * @returns {string | null} 当前字符，无则 `null`。
 */
export function charAt(text, offset) {
	if (offset >= text.length) return null
	const code = text.codePointAt(offset)
	return code === undefined ? null : String.fromCodePoint(code)
}

/**
 * 规范化粘贴文本（统一换行符、剥离 ESC）。
 * @param {string} text - 原始剪贴板文本。
 * @returns {string} 规范化后的文本。
 */
export function normalizePaste(text) {
	return text.replace(/\r\n?/g, '\n').replaceAll('\x1b', '')
}
