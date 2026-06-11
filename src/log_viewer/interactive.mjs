/**
 * Cliffy 交互式日志查看器：日志直接写入终端滚动区（可用终端自带滚动条），
 * 仅重绘底部 REPL 输入区。
 * @see https://cliffy.io/docs/v1.2.1
 */
import path from 'node:path'
import process from 'node:process'

import { ansi } from 'jsr:@cliffy/ansi'
import { setRaw } from 'jsr:@cliffy/internal@1.2.1/runtime/set-raw'
import { keypress } from 'jsr:@cliffy/keypress'
import { renderAnsi } from 'npm:@steve02081504/virtual-console/node'
import { WireLogEntry } from 'npm:@steve02081504/virtual-console/wire/client'

import { createHistoryStore } from './history.mjs'

const ANSI_ESCAPE = /\x1b\[[0-9;]*m/g
const LEVEL_PREFIX_COLORS = {
	error: '\x1b[31m',
	warn: '\x1b[33m',
	info: '\x1b[36m',
	debug: '\x1b[2m',
}
const ANSI_RESET = '\x1b[0m'
const MIN_INPUT_ROWS = 1
/** 恢复全屏滚动区域（DECSTBM reset）。 */
const SCROLL_REGION_RESET = '\x1b[r'
const BRACKETED_PASTE_ON = '\x1b[?2004h'
const BRACKETED_PASTE_OFF = '\x1b[?2004l'
const PASTE_START = '\x1b[200~'
const PASTE_END = '\x1b[201~'
const WORD_CHAR = /[\w$]/
/** Deno 下勿同时 `setRaw` 与 `process.stdin.setRawMode`，否则 stdin 隔键才送达。 */
const IS_DENO = 'Deno' in globalThis
/** xterm Shift+Enter CSI（如 `[13;2~`）；Cliffy 常映射为 `f3`+Shift。 */
const SHIFT_ENTER_CSI = /;2;13|\[13;2[~u$^]|\b13;2[~u]/

/** 开符号 → 闭符号（半角/全角/弯引号/直角与书名号/夹注与隅足号等）。 @type {ReadonlyMap<string, string>} */
const OPEN_TO_CLOSE = new Map([
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
const CLOSE_CHARS = new Set(OPEN_TO_CLOSE.values())

/**
 * 解析 Kitty / CSI-u 按键（Cliffy 常解析为 `undefined`）。
 * @param {import('jsr:@cliffy/keypress').KeyPressEvent} event - 按键事件。
 * @returns {'submit' | 'newline' | 'ctrlBackspace' | 'interrupt' | null} 动作或 `null`。
 */
function kittyKeyAction(event) {
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
 * @param {import('jsr:@cliffy/keypress').KeyPressEvent} event - 按键事件。
 * @returns {boolean} 是否应插入换行。
 */
function isShiftEnterCsi(event) {
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
 * @param {import('jsr:@cliffy/keypress').KeyPressEvent} event - 按键事件。
 * @returns {boolean} 是否应忽略。
 */
function isImeNoise(event) {
	if (event.char === '\x00') return true
	if (event.key === 'undefined' && !event.char) return true
	return false
}

/**
 * @typedef {object} InteractiveViewer
 * @property {(entry: import('npm:@steve02081504/virtual-console/wire/client').WireLogEntry) => Promise<void>} writeEntry - 写入 wire 日志条目。
 * @property {(text: string) => void} appendText - 追加原始文本。
 * @property {() => Promise<void>} clear - 清空日志区。
 * @property {(text: string) => Promise<void>} showInitialInfo - 显示 logo 与初始信息。
 * @property {() => void} focusInput - 重绘 REPL 输入区。
 * @property {() => void} tearDown - 退出前擦除 REPL 区并恢复全屏滚动。
 */

/**
 * @typedef {object} TerminalLayout
 * @property {number} cols - 列宽。
 * @property {number} rows - 行高。
 * @property {number} scrollBottom - 日志滚动区末行（含）。
 * @property {number} sepRow - 分隔线行号。
 * @property {number} inputStart - 输入区首行。
 * @property {number} inputRows - 输入区行数。
 */

/**
 * 输入文本占用的逻辑行数（空输入为 1 行）。
 * @param {string} text - 纯文本。
 * @returns {number} 行数（至少 1）。
 */
function countInputLines(text) {
	return Math.max(MIN_INPUT_ROWS, text.split('\n').length)
}

/**
 * 当前终端允许的最大输入行数（不超过界面下半，含分隔线）。
 * @param {number} rows - 终端总行数。
 * @returns {number} 最大输入行数。
 */
function maxInputRowsForTerminal(rows) {
	return Math.max(MIN_INPUT_ROWS, Math.floor(rows / 2))
}

/**
 * 按内容与终端高度解析输入区行数。
 * @param {string} text - 纯文本。
 * @returns {number} 实际使用的输入行数。
 */
function resolveInputRows(text) {
	const rows = process.stdout.rows || 24
	return Math.min(maxInputRowsForTerminal(rows), countInputLines(text))
}

/**
 * 截断一行至终端可见宽度（粗略剥离 ANSI 后切分）。
 * @param {string} text - 含 ANSI 的文本。
 * @param {number} maxCols - 列宽上限。
 * @returns {string} 截断后的文本。
 */
function truncateVisible(text, maxCols) {
	const plain = text.replace(ANSI_ESCAPE, '')
	if (plain.length <= maxCols) return text
	return plain.slice(0, maxCols)
}

/**
 * 当前终端布局：上方 `scrollBottom` 行为日志滚动区，其下为分隔线 + REPL。
 * @param {number} inputRows - 输入区行数。
 * @returns {TerminalLayout} 列宽、行高与分区行号。
 */
function getLayout(inputRows) {
	const cols = process.stdout.columns || 80
	const rows = process.stdout.rows || 24
	const clamped = Math.min(inputRows, maxInputRowsForTerminal(rows))
	const scrollBottom = Math.max(1, rows - clamped - 1)
	return {
		cols, rows, scrollBottom,
		sepRow: scrollBottom + 1,
		inputStart: scrollBottom + 2,
		inputRows: clamped,
	}
}

/**
 * 将纯文本偏移转为行/列（0-based）。
 * @param {string} text - 纯文本。
 * @param {number} offset - 字节偏移。
 * @returns {{ line: number, col: number }} 光标所在行与列。
 */
function plainOffsetToRowCol(text, offset) {
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
function rowColToPlainOffset(text, line, col) {
	const lines = text.split('\n')
	let offset = 0
	for (let i = 0; i < line; i++) offset += lines[i].length + 1
	offset += Math.min(col, lines[line]?.length ?? 0)
	return offset
}

/**
 * 规范化粘贴文本。
 * @param {string} text - 原始剪贴板文本。
 * @returns {string} 规范化后的文本。
 */
function normalizePaste(text) {
	return text.replace(/\r\n?/g, '\n').replaceAll('\x1b', '')
}

/**
 * 绘制输入区右侧模拟滚动条的一格。
 * @param {number} rowIndex - 视口内行索引。
 * @param {number} viewportRows - 视口行数。
 * @param {number} totalLines - 总行数。
 * @param {number} scrollTop - 视口首行索引。
 * @returns {string} 含 ANSI 的单字符。
 */
function renderScrollbarCell(rowIndex, viewportRows, totalLines, scrollTop) {
	if (totalLines <= viewportRows) return ' '
	const thumbRows = Math.max(1, Math.round(viewportRows * viewportRows / totalLines))
	const maxScroll = totalLines - viewportRows
	const thumbStart = maxScroll > 0
		? Math.round(scrollTop / maxScroll * (viewportRows - thumbRows))
		: 0
	if (rowIndex >= thumbStart && rowIndex < thumbStart + thumbRows)
		return '\x1b[90m█\x1b[0m'
	return '\x1b[90m│\x1b[0m'
}

/**
 * 逐行语法高亮，避免 ANSI 码干扰光标列计算。
 * @param {string} text - 纯文本输入。
 * @param {(code: string) => string} highlightJs - 高亮函数。
 * @returns {string} 高亮后的多行文本。
 */
function highlightInputLines(text, highlightJs) {
	if (!text) return ''
	return text.split('\n').map(line => highlightJs(line)).join('\n')
}

/**
 * 计算输入区可见行与光标位置（顶对齐，超出时随光标滚动视口）。
 * @param {string} highlighted - 高亮后的输入全文。
 * @param {number} inputStart - 输入区首行行号。
 * @param {number} cursorLine - 光标所在行（0-based）。
 * @param {number} cursorCol - 光标所在列（0-based）。
 * @param {number} inputRows - 输入区可见行数。
 * @param {number} scrollTop - 视口首行索引。
 * @returns {{ visible: string[], cursorRow: number, cursorCol: number, scrollTop: number }} 可见行、光标与滚动位置。
 */
function getInputView(highlighted, inputStart, cursorLine, cursorCol, inputRows, scrollTop) {
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

	const cursorRow = inputStart + (cursorLine - startLine)
	return { visible, cursorRow, cursorCol: 1 + cursorCol, scrollTop: startLine }
}

/**
 * 向左跳到词界（readline 风格：`\w` 为词字符）。
 * @param {string} text - 纯文本。
 * @param {number} pos - 当前偏移。
 * @returns {number} 新偏移。
 */
function prevWordBoundary(text, pos) {
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
function nextWordBoundary(text, pos) {
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
function deleteWordForward(text, pos) {
	const end = nextWordBoundary(text, pos)
	return { text: text.slice(0, pos) + text.slice(end), pos }
}

/**
 * 从光标处向后删除一个词。
 * @param {string} text - 纯文本。
 * @param {number} pos - 当前偏移。
 * @returns {{ text: string, pos: number }} 新文本与光标。
 */
function deleteWordBackward(text, pos) {
	const start = prevWordBoundary(text, pos)
	return { text: text.slice(0, start) + text.slice(pos), pos: start }
}

/**
 * 取偏移前的最后一个 Unicode 字符。
 * @param {string} text - 纯文本。
 * @param {number} offset - 光标偏移。
 * @returns {string | null} 前一字符，无则 `null`。
 */
function charBefore(text, offset) {
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
function charAt(text, offset) {
	if (offset >= text.length) return null
	const code = text.codePointAt(offset)
	return code === undefined ? null : String.fromCodePoint(code)
}

/**
 * 创建 Cliffy 交互界面（终端滚动日志 + 固定 REPL），不接管主循环。
 * @param {object} root0 - 选项。
 * @param {number} root0.port - fount 监听端口（用于 `/api/eval`）。
 * @param {() => Promise<string>} root0.generateLogo - 生成 ASCII logo。
 * @param {(err: Error) => void} root0.onFatal - 致命错误处理。
 * @param {string} [root0.fountDir] - fount 根目录（历史文件路径）。
 * @param {() => void} [root0.onClearComplete] - 日志区清空后的附加动作（如请求随机 tip）。
 * @returns {InteractiveViewer} 日志与 REPL 控件。
 */
export function createInteractiveViewer({ port, generateLogo, onFatal, fountDir, onClearComplete }) {
	const EVAL_URL = `http://127.0.0.1:${port}/api/eval`
	const historyStore = createHistoryStore(fountDir ?? path.resolve(import.meta.dirname + '/../../'))
	let input = ''
	let cursor = 0
	/** @type {number | null} 正在浏览的历史索引；`null` 表示编辑当前草稿。 */
	let historyBrowseIndex = null
	let historyDraft = ''
	let pendingInputRedraw = false
	let evalInFlight = false
	/** 上次绘制的输入区行数（缩小时需擦除多余行）。 */
	let renderedInputRows = MIN_INPUT_ROWS
	/** 输入视口首行索引（内容超出可见行时滚动）。 */
	let inputScrollTop = 0
	/** 括号粘贴模式缓冲。 */
	let bracketedPasteBuf = ''
	/** 已收到 `\r`，等待同批次 `\n` 以区分 Enter（`\r\n`）与单独 `\r`。 */
	let pendingReturnSubmit = false
	/** 已拆除 REPL，禁止再重绘或改终端模式。 */
	let replTornDown = false
	/** 交互界面已激活（滚动区 + REPL）；连接就绪前勿动终端，避免光标跳到 scrollBottom 撑出大片空白。 */
	let activated = false
	/** REPL 键盘循环是否已启动。 */
	let inputLoopStarted = false
	/** 中断 REPL 键盘循环（tearDown 时置位）。 */
	let stdinReadAbort = false

	/** @type {(code: string) => string} */
	let highlightJs = code => code
	/**
	 * @param {import('npm:cli-highlight').HighlightFunction} hl - cli-highlight 函数。
	 * @returns {(code: string) => string} 高亮包装器。
	 */
	function wrapHighlight(hl) {
		return code => hl(code, { language: 'js', ignoreIllegals: true })
	}
	import('npm:cli-highlight').then(({ highlight }) => {
		highlightJs = wrapHighlight(highlight)
	}).catch(() => { /* 降级为纯文本 */ })

	/**
	 * @returns {string} 仅设置 DECSTBM 滚动区（不移动光标，避免激活前/重绘时撑出空白行）。
	 */
	function setScrollRegionSeq() {
		const { scrollBottom } = getLayout(resolveInputRows(input))
		return `\x1b[1;${scrollBottom}r`
	}

	/**
	 * 将上方区域设为 DECSTBM 滚动区，新日志在此滚动，底部输入区不受影响。
	 * @returns {void}
	 */
	function applyScrollRegion() {
		if (replTornDown) return
		process.stdout.write(setScrollRegionSeq())
	}

	/**
	 * 输入区行数变化时，擦除新旧 REPL 占用的全部终端行（含分隔线）。
	 * @param {number} prevRows - 先前输入行数。
	 * @param {number} nextRows - 新输入行数。
	 * @returns {string} ANSI 擦除序列。
	 */
	function eraseReplBand(prevRows, nextRows) {
		if (prevRows === nextRows) return ''
		const oldLayout = getLayout(prevRows)
		const newLayout = getLayout(nextRows)
		const { cols } = newLayout
		const blank = ' '.repeat(cols)
		const firstRow = Math.min(oldLayout.sepRow, newLayout.sepRow)
		const lastRow = Math.max(
			oldLayout.inputStart + prevRows - 1,
			newLayout.inputStart + nextRows - 1,
		)
		let out = ''
		for (let row = firstRow; row <= lastRow; row++)
			out += ansi.cursorTo(1, row).toString() + ansi.eraseLine()
				+ ansi.cursorTo(1, row).text(blank).toString()
		return out
	}

	/**
	 * 保持 raw 模式读取 stdin（Cliffy keypress 每读一次就关 raw，会导致终端回显与 IME 乱序）。
	 * @returns {void}
	 */
	function enableRawStdin() {
		try { setRaw(true) } catch { /* ignore */ }
		if (!IS_DENO) try { process.stdin.setRawMode?.(true) } catch { /* ignore */ }
		try { process.stdin.resume?.() } catch { /* ignore */ }
	}

	/**
	 * 恢复 stdin 为 cooked 模式。
	 * @returns {void}
	 */
	function restoreStdin() {
		stdinReadAbort = true
		try { setRaw(false) } catch { /* ignore */ }
		if (!IS_DENO) try { process.stdin.setRawMode?.(false) } catch { /* ignore */ }
	}

	/**
	 * 退出时擦除 REPL 区：恢复全屏滚动，覆写分界线与输入行，归还终端给 shell。
	 * @returns {void}
	 */
	function tearDownRepl() {
		if (replTornDown) return
		replTornDown = true
		pendingInputRedraw = false
		if (!activated) return
		try { keypress().dispose() } catch { /* ignore */ }
		restoreStdin()
		const { rows, sepRow, inputStart } = getLayout(renderedInputRows)
		const lastReplRow = inputStart + renderedInputRows - 1
		let out = ANSI_RESET
		for (let row = sepRow; row <= lastReplRow; row++)
			out += `\x1b[${row};1H\x1b[2K`
		out += BRACKETED_PASTE_OFF + SCROLL_REGION_RESET + `\x1b[1;${rows}r`
		out += `\x1b[${rows};1H\x1b[2K` + ansi.cursorShow()
		process.stdout.write(out)
	}

	process.on('exit', () => {
		try { tearDownRepl() } catch { /* ignore */ }
	})
	if (process.stdout.isTTY)
		process.stdout.on('resize', () => {
			if (replTornDown || !activated) return
			applyScrollRegion()
			scheduleInputRedraw()
		})

	/**
	 * 首次写入或 WebSocket 就绪时激活交互界面：清屏、设滚动区、启动 REPL。
	 * @returns {void}
	 */
	function ensureActivated() {
		if (replTornDown || activated) return
		activated = true
		if (process.stdout.isTTY) process.stdout.write('\x1b[2J\x1b[1;1H')
		process.stdout.write(BRACKETED_PASTE_ON)
		applyScrollRegion()
		if (!inputLoopStarted) {
			inputLoopStarted = true
			runInputLoop().catch(onFatal)
		}
		scheduleInputRedraw()
	}

	/**
	 * 仅重绘底部分隔线与 REPL 输入区。
	 * @returns {void}
	 */
	function redrawInputArea() {
		if (replTornDown) return
		const inputRows = resolveInputRows(input)
		const prevRows = renderedInputRows
		const { cols, sepRow, inputStart } = getLayout(inputRows)
		const contentCols = Math.max(1, cols - 1)
		const totalLines = countInputLines(input)
		let out = ''
		if (inputRows !== prevRows)
			out += eraseReplBand(prevRows, inputRows) + setScrollRegionSeq()
		out += ansi.cursorHide()

		const label = ' js '
		const ruleLen = Math.max(0, contentCols - label.length)
		out += ansi.cursorTo(1, sepRow).toString() + ansi.eraseLine()
			+ ansi.cursorTo(1, sepRow).text(`\x1b[36m${'─'.repeat(ruleLen)}${label}\x1b[0m`).toString()
			+ ansi.cursorTo(cols, sepRow).text(' ').toString()

		const { line, col } = plainOffsetToRowCol(input, cursor)
		const view = getInputView(
			highlightInputLines(input, highlightJs), inputStart, line, col, inputRows, inputScrollTop,
		)
		inputScrollTop = view.scrollTop
		const { visible, cursorRow, cursorCol } = view
		for (let i = 0; i < inputRows; i++) {
			const row = inputStart + i
			const bar = renderScrollbarCell(i, inputRows, totalLines, inputScrollTop)
			out += ansi.cursorTo(1, row).toString() + ansi.eraseLine()
				+ ansi.cursorTo(1, row).text(truncateVisible(visible[i] ?? '', contentCols)).toString()
				+ ansi.cursorTo(cols, row).text(bar).toString()
		}

		out += ansi.cursorTo(cursorCol, cursorRow).toString() + ansi.cursorShow()
		process.stdout.write(out)
		renderedInputRows = inputRows
	}

	/**
	 * 合并微任务内多次输入区重绘。
	 * @returns {void}
	 */
	function scheduleInputRedraw() {
		if (!activated || replTornDown || pendingInputRedraw) return
		pendingInputRedraw = true
		queueMicrotask(() => {
			pendingInputRedraw = false
			redrawInputArea()
		})
	}

	/**
	 * 向日志滚动区追加输出，再恢复底部输入区。
	 * @param {string} text - 原始 ANSI 文本。
	 * @returns {void}
	 */
	function writeLog(text) {
		if (replTornDown || !text) return
		ensureActivated()
		const { scrollBottom } = getLayout(resolveInputRows(input))
		process.stdout.write(ansi.cursorTo(1, scrollBottom).toString() + text)
		scheduleInputRedraw()
	}

	/**
	 * 渲染 wire 求值载荷为 ANSI 文本。
	 * @param {object} payload - `/api/eval` 响应体。
	 * @returns {Promise<string>} ANSI 渲染后的求值输出。
	 */
	async function renderEvalPayload(payload) {
		let text = ''
		/** @returns {Promise<null>} 本地 REPL 不请求远程展开。 */
		async function requestExpand() { return null }
		const wireCtx = { requestExpand, supportsAnsi: true }
		for (const entryJson of payload.outputEntries ?? []) {
			const entry = new WireLogEntry(entryJson, wireCtx)
			text += await entry.renderString({ indent: '  ', maxDepth: 5 })
		}
		if (payload.result !== undefined)
			text += `\x1b[36m←\x1b[0m ${renderAnsi([{ kind: 'value', snapshot: payload.result }], { colorize: true, indent: '  ', maxDepth: 5 })}\n`
		if (payload.error !== undefined)
			text += `\x1b[31m✖\x1b[0m ${renderAnsi([{ kind: 'value', snapshot: payload.error }], { colorize: true, indent: '  ', maxDepth: 5 })}\n`
		return text
	}

	/**
	 * 提交 REPL 输入至 `/api/eval` 并展示结果。
	 * @returns {Promise<void>}
	 */
	async function submitEval() {
		if (evalInFlight) return
		const code = input.trimEnd()
		if (code.trim()) historyStore.push(code)
		input = ''
		cursor = 0
		inputScrollTop = 0
		historyBrowseIndex = null
		historyDraft = ''
		// 多行提交后输入区缩行时，须先同步重绘再 writeLog，否则异步 eraseReplBand 会擦掉刚写入的 `>` 行。
		redrawInputArea()
		if (!code.trim()) return

		writeLog(`\x1b[90m>\x1b[0m ${highlightInputLines(code, highlightJs).replace(/\n/g, '\n  ')}\n`)
		evalInFlight = true
		try {
			const res = await fetch(EVAL_URL, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ code }),
				signal: AbortSignal.timeout(120_000),
			})
			if (!res.ok) {
				writeLog(`\x1b[31m[eval ${res.status}] ${await res.text()}\x1b[0m\n`)
				return
			}
			writeLog(await renderEvalPayload(await res.json()))
		} catch (err) {
			writeLog(`\x1b[31m[eval] ${err?.message ?? err}\x1b[0m\n`)
		} finally {
			evalInFlight = false
		}
	}

	/**
	 * 退出历史浏览，恢复为编辑当前行。
	 * @returns {void}
	 */
	function exitHistoryBrowse() {
		historyBrowseIndex = null
		historyDraft = ''
	}

	/**
	 * 设置输入全文并将光标置于末尾。
	 * @param {string} text - 新输入。
	 * @returns {void}
	 */
	function setInput(text) {
		input = text
		cursor = text.length
		const visible = resolveInputRows(text)
		inputScrollTop = Math.max(0, countInputLines(text) - visible)
	}

	/**
	 * 在光标处插入文本（不处理成对符号）。
	 * @param {string} text - 待插入片段。
	 * @returns {void}
	 */
	function insertAtCursor(text) {
		exitHistoryBrowse()
		input = input.slice(0, cursor) + text + input.slice(cursor)
		cursor += text.length
		syncInputScrollToCursor()
		scheduleInputRedraw()
	}

	/**
	 * 插入单字符；开符号自动补闭符号，重复输入闭符号则跳过已有闭符号。
	 * @param {string} ch - 单个字符。
	 * @returns {void}
	 */
	function insertCharAtCursor(ch) {
		exitHistoryBrowse()
		const close = OPEN_TO_CLOSE.get(ch)
		if (close !== undefined) {
			input = input.slice(0, cursor) + ch + close + input.slice(cursor)
			cursor += ch.length
			scheduleInputRedraw()
			return
		}
		const next = charAt(input, cursor)
		if (CLOSE_CHARS.has(ch) && next === ch) {
			cursor += ch.length
			scheduleInputRedraw()
			return
		}
		input = input.slice(0, cursor) + ch + input.slice(cursor)
		cursor += ch.length
		syncInputScrollToCursor()
		scheduleInputRedraw()
	}

	/**
	 * 删除光标前一个字符；若为空成对符号则一并删除闭符号。
	 * @returns {void}
	 */
	function deleteBeforeCursor() {
		if (cursor <= 0) return
		exitHistoryBrowse()
		const { line } = plainOffsetToRowCol(input, cursor)
		const lineStart = rowColToPlainOffset(input, line, 0)
		// 行首（含该行第一个字符处）：退格应删掉 `\n` 并回到上一行末尾
		if (line > 0 && cursor === lineStart) {
			input = input.slice(0, cursor - 1) + input.slice(cursor)
			cursor -= 1
			syncInputScrollToCursor()
			scheduleInputRedraw()
			return
		}
		const before = charBefore(input, cursor)
		if (!before) return
		const beforeLen = before.length
		const after = charAt(input, cursor)
		if (after && OPEN_TO_CLOSE.get(before) === after) {
			input = input.slice(0, cursor - beforeLen) + input.slice(cursor + after.length)
			cursor -= beforeLen
		} else {
			input = input.slice(0, cursor - beforeLen) + input.slice(cursor)
			cursor -= beforeLen
		}
		syncInputScrollToCursor()
		scheduleInputRedraw()
	}

	/**
	 * 删除光标处字符。
	 * @returns {void}
	 */
	function deleteAtCursor() {
		if (cursor >= input.length) return
		exitHistoryBrowse()
		input = input.slice(0, cursor) + input.slice(cursor + 1)
		scheduleInputRedraw()
	}

	/**
	 * 移动光标并刷新。
	 * @param {number} pos - 新偏移。
	 * @returns {void}
	 */
	function moveCursor(pos) {
		cursor = Math.max(0, Math.min(pos, input.length))
		syncInputScrollToCursor()
		scheduleInputRedraw()
	}

	/**
	 * 视口随光标滚动，保证光标行可见。
	 * @returns {void}
	 */
	function syncInputScrollToCursor() {
		const { line } = plainOffsetToRowCol(input, cursor)
		const visible = resolveInputRows(input)
		const total = countInputLines(input)
		if (total <= visible) {
			inputScrollTop = 0
			return
		}
		const maxScroll = total - visible
		if (line < inputScrollTop) inputScrollTop = line
		else if (line >= inputScrollTop + visible)
			inputScrollTop = Math.min(maxScroll, line - visible + 1)
	}

	/**
	 * 垂直移动光标一行。
	 * @param {number} delta - 行偏移（-1 上，+1 下）。
	 * @returns {void}
	 */
	function moveCursorVertical(delta) {
		const { line, col } = plainOffsetToRowCol(input, cursor)
		const lines = input.split('\n')
		const newLine = Math.max(0, Math.min(lines.length - 1, line + delta))
		cursor = rowColToPlainOffset(input, newLine, col)
		syncInputScrollToCursor()
		scheduleInputRedraw()
	}

	/**
	 * 滚动输入视口（不改变光标）。
	 * @param {number} delta - 行偏移。
	 * @returns {void}
	 */
	function scrollInputBy(delta) {
		const visible = resolveInputRows(input)
		const total = countInputLines(input)
		const maxScroll = Math.max(0, total - visible)
		inputScrollTop = Math.max(0, Math.min(maxScroll, inputScrollTop + delta))
		scheduleInputRedraw()
	}

	/**
	 * 光标跳到输入开头。
	 * @returns {void}
	 */
	function jumpInputStart() {
		cursor = 0
		inputScrollTop = 0
		scheduleInputRedraw()
	}

	/**
	 * 光标跳到输入末尾。
	 * @returns {void}
	 */
	function jumpInputEnd() {
		cursor = input.length
		const visible = resolveInputRows(input)
		inputScrollTop = Math.max(0, countInputLines(input) - visible)
		scheduleInputRedraw()
	}

	/**
	 * 从系统剪贴板粘贴到光标处。
	 * @returns {Promise<void>}
	 */
	async function pasteFromClipboard() {
		const clip = globalThis.navigator?.clipboard
		if (!clip?.readText) return
		const text = await clip.readText()
		if (text) insertAtCursor(normalizePaste(text))
	}

	/**
	 * 处理括号粘贴片段。
	 * @param {string} chunk - 粘贴数据块。
	 * @returns {void}
	 */
	function handleBracketedPasteChunk(chunk) {
		if (!chunk) return
		let data = chunk
		if (data.includes(PASTE_START)) {
			data = data.split(PASTE_START).pop() ?? ''
			bracketedPasteBuf = ''
		}
		if (data.includes(PASTE_END)) {
			bracketedPasteBuf += data.split(PASTE_END)[0] ?? ''
			insertAtCursor(normalizePaste(bracketedPasteBuf))
			bracketedPasteBuf = ''
			return
		}
		bracketedPasteBuf += data
	}

	/**
	 * 上一条历史命令。
	 * @returns {void}
	 */
	function historyOlder() {
		const entries = historyStore.getEntries()
		if (!entries.length) return
		if (historyBrowseIndex === null) {
			historyDraft = input
			historyBrowseIndex = entries.length - 1
		} else if (historyBrowseIndex > 0)
			historyBrowseIndex--
		setInput(entries[historyBrowseIndex])
		scheduleInputRedraw()
	}

	/**
	 * 下一条历史命令（或回到草稿）。
	 * @returns {void}
	 */
	function historyNewer() {
		if (historyBrowseIndex === null) return
		const entries = historyStore.getEntries()
		if (historyBrowseIndex < entries.length - 1) {
			historyBrowseIndex++
			setInput(entries[historyBrowseIndex])
		} else {
			exitHistoryBrowse()
			setInput(historyDraft)
		}
		scheduleInputRedraw()
	}

	/**
	 * Enter / Shift+Enter：Cliffy 将 `\r` 映射为 `return`、`\n` 映射为 `enter`。
	 * 部分终端 Enter 发送 `\r\n` 两键，需合并为提交；单独 `\n` 或 Shift+Enter 为换行。
	 * @param {import('jsr:@cliffy/keypress').KeyPressEvent} event - 按键事件。
	 * @returns {void}
	 */
	function handleReturnOrEnter(event) {
		if (event.shiftKey || isShiftEnterCsi(event)) {
			pendingReturnSubmit = false
			insertAtCursor('\n')
			return
		}
		if (event.key === 'enter') {
			pendingReturnSubmit = false
			submitEval().catch(onFatal)
			return
		}
		// `\r`：同批次若紧跟 `\n` 由 `enter` 分支提交；否则下一微任务提交。
		pendingReturnSubmit = true
		queueMicrotask(() => {
			if (!pendingReturnSubmit) return
			pendingReturnSubmit = false
			submitEval().catch(onFatal)
		})
	}

	/**
	 * 处理单次按键。
	 * @param {import('jsr:@cliffy/keypress').KeyPressEvent} event - 按键事件。
	 * @returns {void}
	 */
	function handleKey(event) {
		if (isImeNoise(event)) return
		const seq = event.sequence ?? ''
		const kitty = kittyKeyAction(event)
		if (kitty === 'newline' || isShiftEnterCsi(event)) {
			pendingReturnSubmit = false
			insertAtCursor('\n')
			return
		}
		if (kitty === 'submit') {
			pendingReturnSubmit = false
			submitEval().catch(onFatal)
			return
		}
		if (kitty === 'ctrlBackspace') {
			pendingReturnSubmit = false
			const next = deleteWordBackward(input, cursor)
			if (next.text !== input) {
				exitHistoryBrowse()
				input = next.text
				cursor = next.pos
				scheduleInputRedraw()
			}
			return
		}
		if (kitty === 'interrupt' || (event.ctrlKey && event.key === 'c')) {
			tearDownRepl()
			process.kill(process.pid, 'SIGINT')
			return
		}
		if (seq.includes(PASTE_START) || seq.includes(PASTE_END) || bracketedPasteBuf) {
			handleBracketedPasteChunk(seq || event.char || '')
			return
		}
		if (event.ctrlKey && event.key === 'v') {
			pasteFromClipboard().catch(onFatal)
			return
		}
		if (event.key === 'up') {
			if (event.ctrlKey) {
				jumpInputStart()
				return
			}
			const { line } = plainOffsetToRowCol(input, cursor)
			if (line > 0) {
				moveCursorVertical(-1)
				return
			}
			if (inputScrollTop > 0) {
				scrollInputBy(-1)
				return
			}
			historyOlder()
			return
		}
		if (event.key === 'down') {
			if (event.ctrlKey) {
				jumpInputEnd()
				return
			}
			const lines = input.split('\n')
			const { line } = plainOffsetToRowCol(input, cursor)
			if (line < lines.length - 1) {
				moveCursorVertical(1)
				return
			}
			const visible = resolveInputRows(input)
			const maxScroll = Math.max(0, countInputLines(input) - visible)
			if (inputScrollTop < maxScroll) {
				scrollInputBy(1)
				return
			}
			historyNewer()
			return
		}
		if (event.key === 'left') {
			moveCursor(event.ctrlKey ? prevWordBoundary(input, cursor) : cursor - 1)
			return
		}
		if (event.key === 'right') {
			moveCursor(event.ctrlKey ? nextWordBoundary(input, cursor) : cursor + 1)
			return
		}
		if (event.key === 'return' || event.key === 'enter') {
			handleReturnOrEnter(event)
			return
		}
		if (event.key === 'backspace') {
			if (event.ctrlKey) {
				const next = deleteWordBackward(input, cursor)
				if (next.text !== input) {
					exitHistoryBrowse()
					input = next.text
					cursor = next.pos
					scheduleInputRedraw()
				}
				return
			}
			deleteBeforeCursor()
			return
		}
		if (event.key === 'delete') {
			if (event.ctrlKey) {
				const next = deleteWordForward(input, cursor)
				if (next.text !== input) {
					exitHistoryBrowse()
					input = next.text
					cursor = next.pos
					scheduleInputRedraw()
				}
				return
			}
			deleteAtCursor()
			return
		}
		if (event.char && event.char >= ' ' && !event.ctrlKey && !event.metaKey)
			insertCharAtCursor(event.char)
	}

	/**
	 * 后台 REPL 键盘循环。Cliffy keypress 每读一次会关 raw；每次处理后重新开启以免终端抢回显。
	 * @returns {Promise<void>}
	 */
	async function runInputLoop() {
		stdinReadAbort = false
		enableRawStdin()
		try {
			for await (const event of keypress()) {
				if (replTornDown || stdinReadAbort) break
				enableRawStdin()
				handleKey(event)
			}
		} catch { /* dispose / EOF */ }
	}

	/**
	 * 写入一条 wire 日志（`await entry.renderString()`，与进程内 {@link LogEntry#toString} 同源 ANSI 管线）。
	 * @param {import('npm:@steve02081504/virtual-console/wire/client').WireLogEntry} entry - 线路条目。
	 * @returns {Promise<void>}
	 */
	async function writeEntry(entry) {
		const body = await entry.renderString({ indent: '  ', maxDepth: 5 })
		const color = LEVEL_PREFIX_COLORS[entry?.level]
		writeLog(color ? `${color}${body}${ANSI_RESET}` : body)
	}

	/**
	 * 向日志滚动区追加原始文本。
	 * @param {string} text - 原始文本。
	 * @returns {void}
	 */
	function appendText(text) { writeLog(text) }

	/**
	 * 清空日志滚动区并重绘 logo。
	 * @returns {Promise<void>}
	 */
	async function clear() {
		ensureActivated()
		const { scrollBottom } = getLayout(resolveInputRows(input))
		let out = `\x1b[1;${scrollBottom}r` + ansi.cursorTo(1, 1).toString()
		for (let row = 1; row <= scrollBottom; row++)
			out += ansi.cursorTo(1, row).toString() + ansi.eraseLine()
		process.stdout.write(out)
		writeLog(await generateLogo())
		onClearComplete?.()
	}

	/**
	 * 显示 logo 与服务器下发的初始信息。
	 * @param {string} text - 初始信息文本。
	 * @returns {Promise<void>}
	 */
	async function showInitialInfo(text) {
		const logo = await generateLogo()
		writeLog(logo + (logo.endsWith('\n') ? '' : '\n') + text)
	}

	/**
	 * 连接就绪后重绘并聚焦 REPL 输入区。
	 * @returns {void}
	 */
	function focusInput() {
		ensureActivated()
		scheduleInputRedraw()
	}

	return { writeEntry, appendText, clear, showInitialInfo, focusInput, tearDown: tearDownRepl }
}
