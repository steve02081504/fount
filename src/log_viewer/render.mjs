/**
 * 终端渲染纯函数：ANSI 基元、宽字符感知的宽度计算、终端布局几何与 REPL 输入框绘制。
 *
 * REPL 区为一个贴底的圆角输入框：
 * ```text
 * ╭─ js ──────────────────────────────────╮
 * │ ❯ 1 + 1                               │
 * ╰──────── enter 运行 · shift+enter 换行 ─╯
 * ```
 */
import process from 'node:process'

/** ANSI SGR 重置。 */
export const ANSI_RESET = '\x1b[0m'
/** 日志级别 → 行前缀色。 */
export const LEVEL_PREFIX_COLORS = {
	error: '\x1b[31m',
	warn: '\x1b[33m',
	info: '\x1b[36m',
	debug: '\x1b[2m',
}
/** REPL 配色。 */
export const THEME = {
	/** 边框、暗淡前缀。 */
	frame: '\x1b[90m',
	/** 提示符、标签。 */
	accent: '\x1b[36m',
	/** 错误。 */
	error: '\x1b[31m',
	dim: '\x1b[2m',
}

/** 恢复全屏滚动区域（DECSTBM reset）。 */
export const SCROLL_REGION_RESET = '\x1b[r'
/** 隐藏光标。 */
export const CURSOR_HIDE = '\x1b[?25l'
/** 显示光标。 */
export const CURSOR_SHOW = '\x1b[?25h'
/** 擦除整行。 */
export const ERASE_LINE = '\x1b[2K'
/** 保存光标位置与属性（DECSC）。 */
export const CURSOR_SAVE = '\x1b7'
/** 恢复光标位置与属性（DECRC）。 */
export const CURSOR_RESTORE = '\x1b8'

/**
 * 光标定位（1-based）。
 * @param {number} col - 列。
 * @param {number} row - 行。
 * @returns {string} ANSI 序列。
 */
export function cursorTo(col, row) {
	return `\x1b[${row};${col}H`
}

/** 输入区最少可见行数。 */
export const MIN_INPUT_ROWS = 1
/** 输入框左侧装饰宽度：`│ ` + 提示符 `❯ `。 */
export const INPUT_PAD_LEFT = 4
/** 输入框右侧装饰宽度：` ` + 边框/滚动条。 */
export const INPUT_PAD_RIGHT = 2

// eslint-disable-next-line no-control-regex
const ANSI_ESCAPE = /\x1b\[[0-9;]*m/g
/** 终端上占两列的字符（CJK 及其标点、全角等常用区段）。 */
const WIDE_CHAR = /[\u1100-\u115F\u2E80-\uA4CF\uA960-\uA97F\uAC00-\uD7A3\uF900-\uFAFF\uFE10-\uFE19\uFE30-\uFE6F\uFF00-\uFF60\uFFE0-\uFFE6]/

/**
 * 剥离 SGR 颜色序列。
 * @param {string} text - 含 ANSI 的文本。
 * @returns {string} 纯文本。
 */
export function stripAnsi(text) {
	return text.replace(ANSI_ESCAPE, '')
}

/**
 * 单字符终端显示宽度。
 * @param {string} ch - 单个 Unicode 字符。
 * @returns {number} 1 或 2。
 */
export function charWidth(ch) {
	return WIDE_CHAR.test(ch) ? 2 : 1
}

/**
 * 文本终端显示宽度（剥离 ANSI、宽字符计 2）。
 * @param {string} text - 文本。
 * @returns {number} 显示列数。
 */
export function visibleWidth(text) {
	let width = 0
	for (const ch of stripAnsi(text)) width += charWidth(ch)
	return width
}

/**
 * 行内光标前缀宽度（用于光标列定位；宽字符计 2）。
 * @param {string} lineText - 光标所在行纯文本。
 * @param {number} col - 光标列（UTF-16 偏移）。
 * @returns {number} 显示列数。
 */
export function textWidthBefore(lineText, col) {
	let width = 0
	for (const ch of lineText.slice(0, col)) width += charWidth(ch)
	return width
}

/**
 * 按显示宽度截断一行（截断时以 `…` 收尾；粗略剥离 ANSI 后切分）。
 * @param {string} text - 含 ANSI 的文本。
 * @param {number} maxCols - 列宽上限。
 * @returns {string} 截断后的文本。
 */
export function truncateByWidth(text, maxCols) {
	const plain = stripAnsi(text)
	if (visibleWidth(plain) <= maxCols) return text
	let out = ''
	let width = 0
	for (const ch of plain) {
		const w = charWidth(ch)
		if (width + w > maxCols - 1) break
		out += ch
		width += w
	}
	return `${out}${THEME.frame}…${ANSI_RESET}`
}

/**
 * @typedef {object} TerminalLayout
 * @property {number} cols - 列宽。
 * @property {number} rows - 行高。
 * @property {number} scrollBottom - 日志滚动区末行（含）。
 * @property {number} boxTop - 输入框上边框行号。
 * @property {number} inputStart - 输入区首行。
 * @property {number} boxBottom - 输入框下边框行号。
 * @property {number} inputRows - 输入区行数。
 */

/**
 * 输入文本占用的逻辑行数（空输入为 1 行）。
 * @param {string} text - 纯文本。
 * @returns {number} 行数（至少 1）。
 */
export function countInputLines(text) {
	return Math.max(MIN_INPUT_ROWS, text.split('\n').length)
}

/**
 * 当前终端允许的最大输入行数（不超过界面下半，含上下边框）。
 * @param {number} rows - 终端总行数。
 * @returns {number} 最大输入行数。
 */
export function maxInputRowsForTerminal(rows) {
	return Math.max(MIN_INPUT_ROWS, Math.floor(rows / 2) - 1)
}

/**
 * 按内容与终端高度解析输入区行数。
 * @param {string} text - 纯文本。
 * @returns {number} 实际使用的输入行数。
 */
export function resolveInputRows(text) {
	const rows = process.stdout.rows || 24
	return Math.min(maxInputRowsForTerminal(rows), countInputLines(text))
}

/**
 * 当前终端布局：上方 `scrollBottom` 行为日志滚动区，其下为圆角输入框。
 * @param {number} inputRows - 输入区行数。
 * @param {number | null} [boxAnchorTop] - 输入框上边框锚定行号；resize 后贴日志末尾时使用，
 *   高于贴底位置时框与屏底之间留空白。`null` 表示贴底。
 * @returns {TerminalLayout} 列宽、行高与分区行号。
 */
export function getLayout(inputRows, boxAnchorTop = null) {
	const cols = process.stdout.columns || 80
	const rows = process.stdout.rows || 24
	const clamped = Math.min(inputRows, maxInputRowsForTerminal(rows))
	const bottomBoxTop = Math.max(2, rows - clamped - 1)
	const boxTop = Math.max(2, Math.min(boxAnchorTop ?? bottomBoxTop, bottomBoxTop))
	const scrollBottom = boxTop - 1
	return {
		cols, rows, scrollBottom,
		boxTop,
		inputStart: boxTop + 1,
		boxBottom: boxTop + 1 + clamped,
		inputRows: clamped,
	}
}

/**
 * 将纯文本偏移转为行/列（0-based）。
 * @param {string} text - 纯文本。
 * @param {number} offset - 字节偏移。
 * @returns {{ line: number, col: number }} 光标所在行与列。
 */
export function plainOffsetToRowCol(text, offset) {
	const clamped = Math.max(0, Math.min(offset, text.length))
	const before = text.slice(0, clamped)
	const lines = before.split('\n')
	return { line: lines.length - 1, col: lines[lines.length - 1].length }
}

/**
 * 行/列转纯文本偏移。
 * @param {string} text - 纯文本。
 * @param {number} line - 行号（0-based）。
 * @param {number} col - 列号（0-based）。
 * @returns {number} 字节偏移。
 */
export function rowColToPlainOffset(text, line, col) {
	const lines = text.split('\n')
	let offset = 0
	for (let i = 0; i < line; i++) offset += lines[i].length + 1
	offset += Math.min(col, lines[line]?.length ?? 0)
	return offset
}

/**
 * 逐行语法高亮，避免 ANSI 码干扰光标列计算。
 * @param {string} text - 纯文本输入。
 * @param {(code: string) => string} highlightJs - 高亮函数。
 * @returns {string} 高亮后的多行文本。
 */
export function highlightInputLines(text, highlightJs) {
	if (!text) return ''
	return text.split('\n').map(line => highlightJs(line)).join('\n')
}

/**
 * 计算输入区可见行与光标位置（顶对齐，超出时随光标滚动视口）。
 * @param {string} highlighted - 高亮后的输入全文。
 * @param {number} inputStart - 输入区首行行号。
 * @param {number} cursorLine - 光标所在行（0-based）。
 * @param {number} inputRows - 输入区可见行数。
 * @param {number} scrollTop - 视口首行索引。
 * @returns {{ visible: string[], cursorRow: number, scrollTop: number }} 可见行、光标行与滚动位置。
 */
export function getInputView(highlighted, inputStart, cursorLine, inputRows, scrollTop) {
	const lines = highlighted.split('\n')
	const totalLines = lines.length
	const maxScroll = Math.max(0, totalLines - inputRows)
	let startLine = Math.max(0, Math.min(scrollTop, maxScroll))
	if (cursorLine < startLine) startLine = cursorLine
	if (cursorLine >= startLine + inputRows) startLine = cursorLine - inputRows + 1
	startLine = Math.max(0, Math.min(startLine, maxScroll))

	/** @type {string[]} */
	let visible
	if (totalLines > inputRows)
		visible = lines.slice(startLine, startLine + inputRows)
	else {
		visible = [...lines]
		while (visible.length < inputRows) visible.push('')
	}

	return { visible, cursorRow: inputStart + (cursorLine - startLine), scrollTop: startLine }
}

/**
 * 输入框上边框（含 ` js ` 标签；求值期间附加 `⋯`）。
 * @param {number} cols - 终端列宽。
 * @param {boolean} busy - 是否正在求值。
 * @returns {string} 含 ANSI 的整行。
 */
export function renderTopBorder(cols, busy) {
	const label = ' js '
	const busyTag = busy ? '⋯ ' : ''
	const fill = Math.max(0, cols - 3 - visibleWidth(label) - visibleWidth(busyTag))
	return `${THEME.frame}╭─${THEME.accent}${label}${THEME.frame}${busyTag}${'─'.repeat(fill)}╮${ANSI_RESET}`
}

/**
 * 输入框下边框（宽度足够时右侧嵌入按键提示）。
 * @param {number} cols - 终端列宽。
 * @param {string} [hint] - 按键提示文案（不含装饰空格）。
 * @returns {string} 含 ANSI 的整行。
 */
export function renderBottomBorder(cols, hint = '') {
	const padded = hint ? ` ${hint} ` : ''
	const hintWidth = visibleWidth(padded)
	if (!hintWidth || cols < hintWidth + 8)
		return `${THEME.frame}╰${'─'.repeat(Math.max(0, cols - 2))}╯${ANSI_RESET}`
	return `${THEME.frame}╰${'─'.repeat(cols - 3 - hintWidth)}${padded}─╯${ANSI_RESET}`
}

/**
 * 输入行行首提示符：首行 `❯`，续行 `…`，空白填充行无。
 * @param {number} logicalLine - 逻辑行索引（0-based）。
 * @param {number} totalLines - 输入总行数。
 * @returns {string} 两列宽的提示符（含 ANSI）。
 */
export function inputLinePrefix(logicalLine, totalLines) {
	if (logicalLine === 0) return `${THEME.accent}❯ ${ANSI_RESET}`
	if (logicalLine < totalLines) return `${THEME.frame}… ${ANSI_RESET}`
	return '  '
}

/**
 * 输入框右边框的一格：视口可滚动时兼作滚动条。
 * @param {number} rowIndex - 视口内行索引。
 * @param {number} viewportRows - 视口行数。
 * @param {number} totalLines - 总行数。
 * @param {number} scrollTop - 视口首行索引。
 * @returns {string} 含 ANSI 的单字符。
 */
export function renderScrollbarCell(rowIndex, viewportRows, totalLines, scrollTop) {
	if (totalLines <= viewportRows) return `${THEME.frame}│${ANSI_RESET}`
	const thumbRows = Math.max(1, Math.round(viewportRows * viewportRows / totalLines))
	const maxScroll = totalLines - viewportRows
	const thumbStart = maxScroll > 0
		? Math.round(scrollTop / maxScroll * (viewportRows - thumbRows))
		: 0
	const isThumb = rowIndex >= thumbStart && rowIndex < thumbStart + thumbRows
	return `${THEME.frame}${isThumb ? '█' : '│'}${ANSI_RESET}`
}

/** 补全下拉最大可见行数。 */
export const MAX_COMPLETION_ROWS = 5

/**
 * 补全下拉占用的终端行数。
 * @param {number} itemCount - 候选数量。
 * @param {boolean} active - 是否显示补全。
 * @returns {number} 行数。
 */
export function getCompletionVisibleRows(itemCount, active) {
	if (!active || itemCount <= 0) return 0
	return Math.min(MAX_COMPLETION_ROWS, itemCount)
}

/**
 * 在输入框上边框上方绘制补全候选列表。
 * @param {number} cols - 终端列宽。
 * @param {number} boxTop - 输入框上边框行号。
 * @param {string[]} items - 候选列表。
 * @param {number} selectedIndex - 当前选中下标。
 * @param {boolean} active - 是否激活。
 * @returns {string} ANSI 序列。
 */
export function renderCompletionBand(cols, boxTop, items, selectedIndex, active) {
	const rows = getCompletionVisibleRows(items.length, active)
	if (!rows) return ''
	const startIdx = items.length <= rows
		? 0
		: Math.max(0, Math.min(selectedIndex - Math.floor(rows / 2), items.length - rows))
	let out = ''
	for (let i = 0; i < rows; i++) {
		const row = boxTop - rows + i
		const itemIdx = startIdx + i
		const item = items[itemIdx] ?? ''
		const marker = itemIdx === selectedIndex ? `${THEME.accent}▸ ` : `${THEME.frame}  `
		const line = truncateByWidth(`${marker}${item}${ANSI_RESET}`, Math.max(1, cols - 2))
		out += cursorTo(1, row) + ERASE_LINE + line
	}
	return out
}
