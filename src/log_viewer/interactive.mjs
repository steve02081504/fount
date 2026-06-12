/**
 * 交互式日志查看器：日志直接写入终端滚动区（DECSTBM，可用终端自带滚动条），
 * 底部固定一个圆角 REPL 输入框，提交至 `/ws/eval`。
 *
 * 按键解析的纯函数见 {@link module:keys}，渲染几何与绘制见 {@link module:render}。
 */
import path from 'node:path'
import process from 'node:process'

import { parse as parseKeyCodes } from 'jsr:@cliffy/keycode'
import { connectLogWire, WireLogEntry } from 'npm:@steve02081504/virtual-console/wire/client'

import { createHistoryStore } from './history.mjs'
import {
	BRACKETED_PASTE_OFF, BRACKETED_PASTE_ON, CLOSE_CHARS, OPEN_TO_CLOSE, PASTE_END, PASTE_START,
	charAt, charBefore, deleteWordBackward, deleteWordForward,
	isImeNoise, isShiftEnterCsi, kittyKeyAction,
	nextWordBoundary, normalizePaste, prevWordBoundary,
} from './keys.mjs'
import { geti18n } from './locale.mjs'
import {
	ANSI_RESET, CURSOR_HIDE, CURSOR_RESTORE, CURSOR_SAVE, CURSOR_SHOW, ERASE_LINE,
	INPUT_PAD_LEFT, INPUT_PAD_RIGHT, LEVEL_PREFIX_COLORS, MIN_INPUT_ROWS,
	SCROLL_REGION_RESET, THEME,
	countInputLines, cursorTo, getInputView, getLayout, highlightInputLines,
	inputLinePrefix, plainOffsetToRowCol, renderBottomBorder, renderCompletionBand,
	renderScrollbarCell, renderTopBorder, resolveInputRows, rowColToPlainOffset,
	completionGhostSuffix, getCompletionVisibleRows, textWidthBefore, truncateByWidth,
} from './render.mjs'

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
 * 创建交互界面（终端滚动日志 + 固定 REPL 输入框），不接管主循环。
 * @param {object} root0 - 选项。
 * @param {number} root0.port - fount 监听端口（用于 `/ws/eval`）。
 * @param {() => Promise<string>} root0.generateLogo - 生成 ASCII logo。
 * @param {(err: Error) => void} root0.onFatal - 致命错误处理。
 * @param {string} [root0.fountDir] - fount 根目录（历史文件路径）。
 * @param {() => void} [root0.onClearComplete] - 日志区清空后的附加动作（如请求随机 tip）。
 * @returns {InteractiveViewer} 日志与 REPL 控件。
 */
export function createInteractiveViewer({ port, generateLogo, onFatal, fountDir, onClearComplete }) {
	const EVAL_WS_URL = `ws://127.0.0.1:${port}/ws/eval`
	const historyStore = createHistoryStore(fountDir ?? path.resolve(import.meta.dirname + '/../../'))
	const replHint = geti18n('fountConsole.logViewer.replHint', 'enter run · shift+enter newline')

	let input = ''
	let cursor = 0
	/** @type {number | null} 正在浏览的历史索引；`null` 表示编辑当前草稿。 */
	let historyBrowseIndex = null
	let historyDraft = ''
	let pendingInputRedraw = false
	let evalInFlight = false
	/** 上次绘制的输入区行数（缩小时需擦除多余行）。 */
	let renderedInputRows = MIN_INPUT_ROWS
	/** 上次绘制时的终端列宽（变窄时旧框每行会折行，需按倍数擦除）。 */
	let renderedCols = process.stdout.columns || 80
	/** 输入视口首行索引（内容超出可见行时滚动）。 */
	let inputScrollTop = 0
	/** 括号粘贴模式缓冲。 */
	let bracketedPasteBuf = ''
	/** 正在接收括号粘贴数据（已见 `PASTE_START`，未见 `PASTE_END`）。 */
	let pasteActive = false
	/** 已收到 `\r`，等待同批次 `\n` 以区分 Enter（`\r\n`）与单独 `\r`。 */
	let pendingReturnSubmit = false
	/** 已拆除 REPL，禁止再重绘或改终端模式。 */
	let replTornDown = false
	/** 交互界面已激活（滚动区 + REPL）；连接就绪前勿动终端，避免光标跳到 scrollBottom 撑出大片空白。 */
	let activated = false
	/** REPL 键盘监听是否已启动。 */
	let inputLoopStarted = false
	/** 停止处理 stdin（tearDown 时置位）。 */
	let stdinReadAbort = false
	/** @type {ReturnType<typeof connectLogWire> | null} */
	let evalConn = null
	/** @type {Map<string, { resolve: (v: object) => void, reject: (e: Error) => void }>} */
	const pendingEvalRequests = new Map()
	let nextEvalRequestId = 1
	let completionActive = false
	/** @type {string[]} */
	let completionItems = []
	let completionIndex = 0
	let completionReplaceStart = 0
	let completionReplaceEnd = 0
	/** 补全请求代次（丢弃过期响应）。 */
	let completionRequestSeq = 0
	/** @type {ReturnType<typeof setTimeout> | null} */
	let completionRefreshTimer = null
	/** Escape 关闭补全后，直至下次编辑前不再自动弹出。 */
	let completionSuppressed = false
	/** 上次绘制的补全行数（用于擦除）。 */
	let renderedCompletionRows = 0
	/** 输入框上边框锚定行（`null` 表示贴底）。 */
	let boxAnchorTop = null
	/** resize 处理进行中（期间日志写入进缓冲、跳过常规重绘）。 */
	let resizeInFlight = false
	/** resize 处理期间又收到 resize 事件，需再跑一轮。 */
	let resizeAgain = false
	/** @type {string[] | null} resize 期间缓冲的日志文本。 */
	let resizeLogBuffer = null

	/**
	 * 取当前布局（带输入框锚定行）。
	 * @param {number} inputRows - 输入区行数。
	 * @returns {import('./render.mjs').TerminalLayout} 布局。
	 */
	const layoutOf = inputRows => getLayout(inputRows, boxAnchorTop)

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
	 * 拒绝所有挂起的 eval/completion 请求。
	 * @param {string} message - 错误消息。
	 * @returns {void}
	 */
	function rejectAllEvalRequests(message) {
		for (const { reject } of pendingEvalRequests.values())
			reject(new Error(message))
		pendingEvalRequests.clear()
	}

	/**
	 * 关闭 eval WebSocket 并回收挂起请求。
	 * @returns {void}
	 */
	function tearDownEvalWire() {
		rejectAllEvalRequests('eval_wire_closed')
		if (!evalConn) return
		try { evalConn.close() } catch { /* ignore */ }
		try { evalConn.detach() } catch { /* ignore */ }
		evalConn = null
	}

	/**
	 * 建立或等待 eval WebSocket 就绪（首次输入时懒连接）。
	 * @returns {Promise<NonNullable<typeof evalConn>>} 已 OPEN 的 eval 连接句柄。
	 */
	function ensureEvalWire() {
		if (evalConn?.ws?.readyState === WebSocket.OPEN)
			return Promise.resolve(evalConn)
		if (evalConn?.ws?.readyState === WebSocket.CONNECTING)
			return new Promise((resolve, reject) => {
				const ws = evalConn.ws
				/**
				 * @returns {void}
				 */
				const onOpen = () => {
					ws.removeEventListener('error', onError)
					resolve(evalConn)
				}
				/**
				 * @returns {void}
				 */
				const onError = () => {
					ws.removeEventListener('open', onOpen)
					reject(new Error('eval_ws_error'))
				}
				ws.addEventListener('open', onOpen, { once: true })
				ws.addEventListener('error', onError, { once: true })
			})
		if (evalConn) {
			try { evalConn.detach() } catch { /* ignore */ }
			evalConn = null
		}
		return new Promise((resolve, reject) => {
			evalConn = connectLogWire(EVAL_WS_URL, {
				extensionHandlers: {
					/**
					 * @param {{ id?: string }} raw - eval 结果帧。
					 * @returns {void}
					 */
					eval_result: (raw) => {
						const id = String(raw?.id ?? '')
						const pending = pendingEvalRequests.get(id)
						if (!pending) return
						pendingEvalRequests.delete(id)
						pending.resolve(raw)
					},
					/**
					 * @param {{ id?: string }} raw - 补全结果帧。
					 * @returns {void}
					 */
					completion_result: (raw) => {
						const id = String(raw?.id ?? '')
						const pending = pendingEvalRequests.get(id)
						if (!pending) return
						pendingEvalRequests.delete(id)
						pending.resolve(raw)
					},
				},
				/**
				 * @returns {void}
				 */
				onClose: () => {
					rejectAllEvalRequests('eval_wire_closed')
					evalConn = null
				},
				onFatal,
			})
			const ws = evalConn.ws
			if (ws.readyState === WebSocket.OPEN) resolve(evalConn)
			else {
				ws.addEventListener('open', () => resolve(evalConn), { once: true })
				ws.addEventListener('error', () => reject(new Error('eval_ws_error')), { once: true })
			}
		})
	}

	/**
	 * 首次有输入时懒建 eval 链。
	 * @param {boolean} wasEmpty - 变更前输入是否为空。
	 * @returns {void}
	 */
	function maybeConnectEvalOnFirstInput(wasEmpty) {
		if (!wasEmpty || replTornDown) return
		ensureEvalWire().catch(onFatal)
	}

	/**
	 * 发送带 id 的 JSON 请求并等待 extension 回包。
	 * @param {object} payload - 请求体（不含 id）。
	 * @returns {Promise<object>} 响应载荷。
	 */
	async function sendEvalWireRequest(payload) {
		const conn = await ensureEvalWire()
		const id = String(nextEvalRequestId++)
		return new Promise((resolve, reject) => {
			pendingEvalRequests.set(id, { resolve, reject })
			if (!conn.sendJson({ ...payload, id }))
				reject(new Error('eval_wire_send_failed'))
		})
	}

	/**
	 * 清除补全 UI 状态。
	 * @returns {void}
	 */
	function clearCompletion() {
		completionActive = false
		completionItems = []
		completionIndex = 0
	}

	/**
	 * 取消待执行的补全刷新。
	 * @returns {void}
	 */
	function cancelCompletionRefresh() {
		if (completionRefreshTimer === null) return
		clearTimeout(completionRefreshTimer)
		completionRefreshTimer = null
	}

	/**
	 * 输入变化后防抖请求补全（有候选项时自动展示）。
	 * @returns {void}
	 */
	function scheduleCompletionRefresh() {
		if (replTornDown) return
		completionSuppressed = false
		cancelCompletionRefresh()
		completionRefreshTimer = setTimeout(() => {
			completionRefreshTimer = null
			if (replTornDown || completionSuppressed) return
			if (!input.length) {
				clearCompletion()
				scheduleInputRedraw()
				return
			}
			requestCompletion().catch(onFatal)
		}, 150)
	}

	/**
	 * 当前选中候选项是否仍有未输入的后缀（可接受补全）。
	 * @param {number} [index] - 候选项下标，默认当前选中项。
	 * @returns {boolean} 是否仍有可接受的后缀。
	 */
	function completionPendingSuffix(index = completionIndex) {
		if (!completionActive || !completionItems.length) return false
		const item = completionItems[index]
		if (!item) return false
		return !!completionGhostSuffix(input, completionReplaceStart, completionReplaceEnd, item)
	}

	/**
	 * 应用当前选中的补全项。
	 * @returns {void}
	 */
	function acceptCompletion() {
		if (!completionActive || !completionItems.length || !completionPendingSuffix()) {
			clearCompletion()
			scheduleInputRedraw()
			return
		}
		const item = completionItems[completionIndex]
		input = input.slice(0, completionReplaceStart) + item + input.slice(completionReplaceEnd)
		cursor = completionReplaceStart + item.length
		clearCompletion()
		syncInputScrollToCursor()
		scheduleInputRedraw()
		scheduleCompletionRefresh()
	}

	/**
	 * 请求服务端补全并更新补全态。
	 * @returns {Promise<void>}
	 */
	async function requestCompletion() {
		const seq = ++completionRequestSeq
		const snapCode = input
		const snapCursor = cursor
		try {
			const result = await sendEvalWireRequest({
				type: 'completion_request',
				code: snapCode,
				cursor: snapCursor,
			})
			if (seq !== completionRequestSeq || snapCode !== input || snapCursor !== cursor) return
			completionItems = Array.isArray(result.items) ? result.items.map(String) : []
			completionReplaceStart = Number.isFinite(result.replaceStart) ? result.replaceStart : snapCursor
			completionReplaceEnd = Number.isFinite(result.replaceEnd) ? result.replaceEnd : snapCursor
			completionIndex = 0
			completionActive = completionItems.length > 0
			if (completionActive && completionItems.length === 1 && !completionPendingSuffix(0))
				clearCompletion()
			scheduleInputRedraw()
		} catch {
			if (seq !== completionRequestSeq) return
			clearCompletion()
			scheduleInputRedraw()
		}
	}

	// #region 终端模式与生命周期

	/**
	 * @returns {string} 仅设置 DECSTBM 滚动区（不移动光标，避免激活前/重绘时撑出空白行）。
	 */
	function setScrollRegionSeq() {
		const { scrollBottom } = layoutOf(resolveInputRows(input))
		return `\x1b[1;${scrollBottom}r`
	}

	/**
	 * 将上方区域设为 DECSTBM 滚动区，新日志在此滚动，底部输入框不受影响。
	 * @returns {void}
	 */
	function applyScrollRegion() {
		if (replTornDown) return
		process.stdout.write(setScrollRegionSeq())
	}

	/** @type {((chunk: Uint8Array) => void) | null} */
	let stdinListener = null
	const stdinDecoder = new TextDecoder()

	/**
	 * 开启 stdin raw 模式并持续监听。
	 *
	 * 必须走 `process.stdin`（node:tty）而非 `Deno.stdin.read`：Windows 下后者按控制台
	 * 代码页读取，IME / 非 ASCII 输入会变成无效 UTF-8（`�`）；node:tty 路径经
	 * `ReadConsoleInputW` 正确编码为 UTF-8，并把功能键映射成 VT 序列。
	 * @returns {void}
	 */
	function startInputLoop() {
		try { process.stdin.setRawMode?.(true) } catch { /* 非 TTY */ }
		process.stdin.resume()
		/**
		 * @param {Uint8Array} chunk - stdin 原始数据块。
		 * @returns {void}
		 */
		stdinListener = chunk => {
			if (replTornDown || stdinReadAbort) return
			handleStdinChunk(stdinDecoder.decode(chunk, { stream: true }))
		}
		process.stdin.on('data', stdinListener)
	}

	/**
	 * 恢复 stdin 为 cooked 模式并停止监听。
	 * @returns {void}
	 */
	function restoreStdin() {
		stdinReadAbort = true
		if (stdinListener) {
			process.stdin.off('data', stdinListener)
			stdinListener = null
		}
		try { process.stdin.setRawMode?.(false) } catch { /* ignore */ }
		try { process.stdin.pause() } catch { /* ignore */ }
	}

	/**
	 * 退出时擦除 REPL 输入框：恢复全屏滚动，光标回到日志末尾，归还终端给 shell。
	 * @returns {void}
	 */
	function tearDownRepl() {
		if (replTornDown) return
		replTornDown = true
		pendingInputRedraw = false
		cancelCompletionRefresh()
		tearDownEvalWire()
		clearCompletion()
		if (!activated) return
		restoreStdin()
		const { boxTop, boxBottom } = layoutOf(renderedInputRows)
		let out = ANSI_RESET
		for (let row = boxTop; row <= boxBottom; row++)
			out += cursorTo(1, row) + ERASE_LINE
		out += BRACKETED_PASTE_OFF + SCROLL_REGION_RESET
		out += CURSOR_RESTORE + ANSI_RESET + CURSOR_SHOW
		process.stdout.write(out)
	}

	process.on('exit', () => {
		try { tearDownRepl() } catch { /* ignore */ }
	})
	if (process.stdout.isTTY)
		process.stdout.on('resize', () => { handleResize() })

	/**
	 * reflow 后旧输入框带占用的物理行数：每行满屏宽，按 `ceil(旧宽/新宽)` 折行。
	 * @param {number} oldCols - 绘制时列宽。
	 * @param {number} newCols - 当前列宽。
	 * @param {number} logicalBandRows - 框带逻辑行数（补全 + 上下边框 + 输入行）。
	 * @param {number} terminalRows - 终端行高。
	 * @returns {number} 自屏底向上需擦除的行数。
	 */
	function replReflowBandRows(oldCols, newCols, logicalBandRows, terminalRows) {
		const wrapFactor = Math.ceil(oldCols / newCols)
		return Math.min(logicalBandRows * wrapFactor, terminalRows)
	}

	/**
	 * 串行化 resize 处理：进行期间日志写入缓冲，结束后统一回放并重绘。
	 * @returns {void}
	 */
	function handleResize() {
		if (replTornDown || !activated) return
		if (resizeInFlight) {
			resizeAgain = true
			return
		}
		resizeInFlight = true
		resizeLogBuffer = []
		try {
			do {
				resizeAgain = false
				performResize()
			} while (resizeAgain && !replTornDown)
		} finally {
			resizeInFlight = false
			const buffered = resizeLogBuffer?.join('') ?? ''
			resizeLogBuffer = null
			if (buffered) writeLog(buffered)
		}
	}

	/**
	 * 处理一次终端尺寸变化。
	 *
	 * 输入框每行绘制为满屏宽；变窄后整带软折行，物理高度约为
	 * `框带逻辑行数 × ceil(旧宽/新宽)`。自屏底向上擦除该高度，再把日志续写点设到滚动区末行并保存，
	 * 贴底重绘输入框。
	 * @returns {void}
	 */
	function performResize() {
		if (replTornDown) return
		boxAnchorTop = null
		const inputRows = resolveInputRows(input)
		const rows = process.stdout.rows || 24
		const cols = process.stdout.columns || 80
		const logicalBandRows = renderedInputRows + 2 + renderedCompletionRows
		const eraseRows = replReflowBandRows(renderedCols, cols, logicalBandRows, rows)
		const { scrollBottom } = layoutOf(inputRows)
		let out = SCROLL_REGION_RESET
		for (let i = 0; i < eraseRows; i++)
			out += cursorTo(1, rows - i) + ERASE_LINE
		out += cursorTo(1, scrollBottom) + CURSOR_SAVE + setScrollRegionSeq()
		process.stdout.write(out)
		renderedCompletionRows = 0
		redrawInputArea()
	}

	/**
	 * 首次写入或 WebSocket 就绪时激活交互界面：不清屏，从当前光标处继续输出（与纯文本模式一致）。
	 * 先垫出输入框所需行数（光标贴底时让终端滚动），再把光标移回日志续写处并 DECSC 保存——
	 * 此后日志位置始终经 DECSC/DECRC 在重绘间传递。
	 * @returns {void}
	 */
	function ensureActivated() {
		if (replTornDown || activated) return
		activated = true
		const reserve = layoutOf(resolveInputRows(input)).inputRows + 2
		process.stdout.write('\n'.repeat(reserve) + `\x1b[${reserve}A\r` + CURSOR_SAVE + BRACKETED_PASTE_ON)
		applyScrollRegion()
		if (!inputLoopStarted) {
			inputLoopStarted = true
			startInputLoop()
		}
		scheduleInputRedraw()
	}

	// #endregion

	// #region 绘制

	/**
	 * 输入区行数变化时，擦除新旧输入框占用的全部终端行。
	 * @param {number} prevRows - 先前输入行数。
	 * @param {number} nextRows - 新输入行数。
	 * @returns {string} ANSI 擦除序列。
	 */
	function eraseReplBand(prevRows, nextRows) {
		if (prevRows === nextRows) return ''
		const oldLayout = layoutOf(prevRows)
		const newLayout = layoutOf(nextRows)
		const firstRow = Math.min(oldLayout.boxTop, newLayout.boxTop)
		const lastRow = Math.max(oldLayout.boxBottom, newLayout.boxBottom)
		let out = ''
		for (let row = firstRow; row <= lastRow; row++)
			out += cursorTo(1, row) + ERASE_LINE
		return out
	}

	/**
	 * 仅重绘底部 REPL 输入框（上边框 + 输入行 + 下边框）。
	 * @returns {void}
	 */
	function redrawInputArea() {
		if (replTornDown) return
		const inputRows = resolveInputRows(input)
		const prevRows = renderedInputRows
		const { cols, scrollBottom, boxTop, inputStart, boxBottom } = layoutOf(inputRows)
		const contentCols = Math.max(1, cols - INPUT_PAD_LEFT - INPUT_PAD_RIGHT)
		const totalLines = countInputLines(input)
		let out = ''
		if (inputRows !== prevRows) {
			// 滚动区变矮时（贴底锚定下输入框长高；锚定贴日志末尾时框向下方空白生长、不缩区）：
			// 趁旧滚动区还生效，用 LF 下探-回退把日志上滚，
			// 防止日志末尾落入新输入框带、后续 DECRC 把日志写进框里。
			const delta = layoutOf(prevRows).scrollBottom - scrollBottom
			if (delta > 0)
				out += CURSOR_RESTORE + '\n'.repeat(delta) + `\x1b[${delta}A` + CURSOR_SAVE
			out += eraseReplBand(prevRows, inputRows) + setScrollRegionSeq()
		}
		out += CURSOR_HIDE

		out += cursorTo(1, boxTop) + ERASE_LINE + renderTopBorder(cols, evalInFlight)

		const { line: cursorLine, col: cursorCol } = plainOffsetToRowCol(input, cursor)
		const view = getInputView(
			highlightInputLines(input, highlightJs), inputStart, cursorLine, inputRows, inputScrollTop,
		)
		inputScrollTop = view.scrollTop
		for (let i = 0; i < inputRows; i++) {
			const row = inputStart + i
			const logicalLine = view.scrollTop + i
			const { line: cursorLine } = plainOffsetToRowCol(input, cursor)
			let lineText = view.visible[i] ?? ''
			if (completionActive && logicalLine === cursorLine && completionItems[completionIndex]) {
				const ghost = completionGhostSuffix(
					input, completionReplaceStart, completionReplaceEnd, completionItems[completionIndex],
				)
				if (ghost)
					lineText += `${THEME.dim}${ghost}${ANSI_RESET}`
			}
			out += cursorTo(1, row) + ERASE_LINE
				+ `${THEME.frame}│ ${ANSI_RESET}`
				+ inputLinePrefix(logicalLine, totalLines)
				+ truncateByWidth(lineText, contentCols)
				+ cursorTo(cols, row) + renderScrollbarCell(i, inputRows, totalLines, view.scrollTop)
		}

		const completionRows = getCompletionVisibleRows(completionItems.length, completionActive)
		const eraseCompletionRows = Math.max(renderedCompletionRows, completionRows)
		for (let i = 0; i < eraseCompletionRows; i++) {
			const row = boxTop - eraseCompletionRows + i
			if (row >= 1) out += cursorTo(1, row) + ERASE_LINE
		}
		if (completionRows)
			out += renderCompletionBand(cols, boxTop, completionItems, completionIndex, completionActive)
		renderedCompletionRows = completionRows

		out += cursorTo(1, boxBottom) + ERASE_LINE + renderBottomBorder(cols, replHint)

		const cursorLineText = input.split('\n')[cursorLine] ?? ''
		const screenCol = Math.min(
			INPUT_PAD_LEFT + 1 + textWidthBefore(cursorLineText, cursorCol),
			Math.max(1, cols - INPUT_PAD_RIGHT),
		)
		out += cursorTo(screenCol, view.cursorRow) + CURSOR_SHOW
		process.stdout.write(out)
		renderedInputRows = inputRows
		renderedCols = cols
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
			// resize 处理中跳过：performResize 结束时会同步重绘。
			if (resizeInFlight) return
			redrawInputArea()
		})
	}

	/**
	 * 向日志滚动区追加输出（DECRC 回到上次日志末尾，写完 DECSC 保存），再恢复底部输入框。
	 * @param {string} text - 原始 ANSI 文本。
	 * @returns {void}
	 */
	function writeLog(text) {
		if (replTornDown || !text) return
		ensureActivated()
		// resize 处理中（含 CPR 等待窗口）写入会落在错误位置，先缓冲、结束后回放。
		if (resizeLogBuffer) {
			resizeLogBuffer.push(text)
			return
		}
		process.stdout.write(CURSOR_RESTORE + text + CURSOR_SAVE)
		scheduleInputRedraw()
	}

	// #endregion

	// #region 求值

	/**
	 * 渲染 wire 求值载荷为 ANSI 文本（支持惰性展开）。
	 * @param {object} payload - `eval_result` 响应体。
	 * @returns {Promise<string>} ANSI 渲染后的求值输出。
	 */
	async function renderEvalPayload(payload) {
		const conn = await ensureEvalWire()
		/**
		 * @param {string} ref - 展开引用 ID。
		 * @param {number} [maxDepth] - 最大深度。
		 * @returns {Promise<unknown>} 展开后的快照。
		 */
		function requestExpand(ref, maxDepth) {
			return conn.requestExpand(ref, maxDepth)
		}
		const wireCtx = { requestExpand, supportsAnsi: true }
		/**
		 * @param {unknown} snapshot - 序列化快照。
		 * @param {'result' | 'error'} kind - 前缀样式。
		 * @returns {Promise<string>} 渲染行。
		 */
		async function renderSnapshotLine(snapshot, kind) {
			const entry = new WireLogEntry({
				method: kind,
				level: kind === 'error' ? 'error' : 'log',
				timestamp: Date.now(),
				segments: [{ kind: 'value', snapshot }],
			}, wireCtx)
			const prefix = kind === 'error' ? `${THEME.error}✖` : `${THEME.accent}←`
			const body = await entry.renderString({ indent: '  ', maxDepth: 8 })
			return `${prefix}${ANSI_RESET} ${body}\n`
		}
		if (payload.error !== undefined)
			return renderSnapshotLine(payload.error, 'error')
		if ('result' in payload)
			return renderSnapshotLine(payload.result, 'result')
		return ''
	}

	/**
	 * 提交 REPL 输入至 `/ws/eval` 并展示结果。
	 * @returns {Promise<void>}
	 */
	async function submitEval() {
		if (evalInFlight) return
		cancelCompletionRefresh()
		completionSuppressed = false
		clearCompletion()
		const code = input.trimEnd()
		if (code.trim()) historyStore.push(code)
		input = ''
		cursor = 0
		inputScrollTop = 0
		historyBrowseIndex = null
		historyDraft = ''
		if (!code.trim()) {
			redrawInputArea()
			return
		}

		evalInFlight = true
		// 多行提交后输入区缩行时，须先同步重绘再 writeLog，否则异步 eraseReplBand 会擦掉刚写入的回显行。
		redrawInputArea()
		writeLog(`${THEME.accent}❯${ANSI_RESET} ${highlightInputLines(code, highlightJs).replace(/\n/g, '\n  ')}\n`)
		try {
			const payload = await sendEvalWireRequest({ type: 'eval_request', code })
			writeLog(await renderEvalPayload(payload))
		} catch (err) {
			writeLog(`${THEME.error}[eval] ${err?.message ?? err}${ANSI_RESET}\n`)
		} finally {
			evalInFlight = false
			scheduleInputRedraw()
		}
	}

	// #endregion

	// #region 输入编辑

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
		scheduleCompletionRefresh()
	}

	/**
	 * 在光标处插入文本（不处理成对符号）。
	 * @param {string} text - 待插入片段。
	 * @returns {void}
	 */
	function insertAtCursor(text) {
		const wasEmpty = !input.length
		exitHistoryBrowse()
		input = input.slice(0, cursor) + text + input.slice(cursor)
		cursor += text.length
		maybeConnectEvalOnFirstInput(wasEmpty)
		syncInputScrollToCursor()
		scheduleInputRedraw()
		scheduleCompletionRefresh()
	}

	/**
	 * 插入单字符；开符号自动补闭符号，重复输入闭符号则跳过已有闭符号。
	 * @param {string} ch - 单个字符。
	 * @returns {void}
	 */
	function insertCharAtCursor(ch) {
		const wasEmpty = !input.length
		exitHistoryBrowse()
		const close = OPEN_TO_CLOSE.get(ch)
		if (close !== undefined) {
			input = input.slice(0, cursor) + ch + close + input.slice(cursor)
			cursor += ch.length
			maybeConnectEvalOnFirstInput(wasEmpty)
			scheduleInputRedraw()
			scheduleCompletionRefresh()
			return
		}
		const next = charAt(input, cursor)
		if (CLOSE_CHARS.has(ch) && next === ch) {
			cursor += ch.length
			scheduleInputRedraw()
			scheduleCompletionRefresh()
			return
		}
		input = input.slice(0, cursor) + ch + input.slice(cursor)
		cursor += ch.length
		maybeConnectEvalOnFirstInput(wasEmpty)
		syncInputScrollToCursor()
		scheduleInputRedraw()
		scheduleCompletionRefresh()
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
			scheduleCompletionRefresh()
			return
		}
		const before = charBefore(input, cursor)
		if (!before) return
		const beforeLen = before.length
		const after = charAt(input, cursor)
		if (after && OPEN_TO_CLOSE.get(before) === after)
			input = input.slice(0, cursor - beforeLen) + input.slice(cursor + after.length)
		else
			input = input.slice(0, cursor - beforeLen) + input.slice(cursor)
		cursor -= beforeLen
		syncInputScrollToCursor()
		scheduleInputRedraw()
		scheduleCompletionRefresh()
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
		scheduleCompletionRefresh()
	}

	/**
	 * 用词界删除结果更新输入（无变化则忽略）。
	 * @param {{ text: string, pos: number }} next - 新文本与光标。
	 * @returns {void}
	 */
	function applyWordDelete(next) {
		if (next.text === input) return
		exitHistoryBrowse()
		input = next.text
		cursor = next.pos
		syncInputScrollToCursor()
		scheduleInputRedraw()
		scheduleCompletionRefresh()
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
		scheduleCompletionRefresh()
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
		scheduleCompletionRefresh()
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
		scheduleCompletionRefresh()
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
		scheduleCompletionRefresh()
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

	// #endregion

	// #region 按键分发

	/**
	 * Enter / Shift+Enter：keycode 将 `\r` 映射为 `return`、`\n` 映射为 `enter`。
	 * 部分终端 Enter 发送 `\r\n` 两键，需合并为提交；单独 `\n` 或 Shift+Enter 为换行。
	 * @param {import('./keys.mjs').KeyEvent} event - 按键事件。
	 * @returns {void}
	 */
	function handleReturnOrEnter(event) {
		if (event.shiftKey || isShiftEnterCsi(event)) {
			pendingReturnSubmit = false
			insertAtCursor('\n')
			return
		}
		if (event.key === 'enter') {
			// `\r\n` 的第二键：提交。单独 `\n`（如未打补丁终端的 Shift+Enter）插入换行。
			if (pendingReturnSubmit) {
				pendingReturnSubmit = false
				submitEval().catch(onFatal)
				return
			}
			pendingReturnSubmit = false
			insertAtCursor('\n')
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
	 * 在补全列表中循环选中项。
	 * @param {number} delta - 方向（-1 上，+1 下）。
	 * @returns {void}
	 */
	function cycleCompletion(delta) {
		if (!completionActive || completionItems.length <= 1) return
		completionIndex = (completionIndex + delta + completionItems.length) % completionItems.length
		scheduleInputRedraw()
	}

	/**
	 * 处理单次按键。
	 * @param {import('./keys.mjs').KeyEvent} event - 按键事件。
	 * @returns {void}
	 */
	function handleKey(event) {
		if (isImeNoise(event)) return

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
			applyWordDelete(deleteWordBackward(input, cursor))
			return
		}
		if (kitty === 'interrupt' || (event.ctrlKey && event.key === 'c')) {
			tearDownRepl()
			process.kill(process.pid, 'SIGINT')
			return
		}

		if (event.key === 'tab') {
			if (completionActive && completionItems.length && completionPendingSuffix()) {
				acceptCompletion()
				return
			}
			if (completionActive) {
				clearCompletion()
				scheduleInputRedraw()
			}
			if (event.shiftKey)
				moveCursor(event.ctrlKey ? prevWordBoundary(input, cursor) : cursor - 1)
			else
				moveCursor(event.ctrlKey ? nextWordBoundary(input, cursor) : cursor + 1)
			return
		}
		if (event.key === 'escape')
			if (completionActive || completionSuppressed) {
				completionSuppressed = true
				cancelCompletionRefresh()
				clearCompletion()
				scheduleInputRedraw()
				return
			}

		if (completionActive && completionItems.length && completionPendingSuffix()
			&& (event.key === 'right' || event.key === 'return' || event.key === 'enter'))
			if (event.key === 'right' || (!event.shiftKey && (event.key === 'return' || event.key === 'enter'))) {
				acceptCompletion()
				return
			}

		if (completionActive && (event.key === 'right' || event.key === 'return' || event.key === 'enter')
			&& (event.key === 'right' || !event.shiftKey)) {
			clearCompletion()
			scheduleInputRedraw()
		}

		if (event.ctrlKey && event.key === 'v') {
			pasteFromClipboard().catch(onFatal)
			return
		}
		if (event.key === 'up') {
			if (completionActive && completionItems.length > 1) {
				cycleCompletion(-1)
				return
			}
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
			if (completionActive && completionItems.length > 1) {
				cycleCompletion(1)
				return
			}
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
			if (event.ctrlKey) applyWordDelete(deleteWordBackward(input, cursor))
			else deleteBeforeCursor()
			return
		}
		if (event.key === 'delete') {
			if (event.ctrlKey) applyWordDelete(deleteWordForward(input, cursor))
			else deleteAtCursor()
			return
		}
		if (event.char && event.char >= ' ' && !event.ctrlKey && !event.metaKey)
			insertCharAtCursor(event.char)
	}

	/**
	 * 处理一段 stdin 原始文本：剥离括号粘贴片段后逐键解析分发。
	 * @param {string} text - 解码后的 stdin 数据。
	 * @returns {void}
	 */
	function handleStdinChunk(text) {
		let rest = text
		while (rest) {
			if (pasteActive) {
				const end = rest.indexOf(PASTE_END)
				if (end === -1) {
					bracketedPasteBuf += rest
					return
				}
				bracketedPasteBuf += rest.slice(0, end)
				insertAtCursor(normalizePaste(bracketedPasteBuf))
				bracketedPasteBuf = ''
				pasteActive = false
				rest = rest.slice(end + PASTE_END.length)
				continue
			}
			const start = rest.indexOf(PASTE_START)
			if (start === -1) {
				dispatchKeys(rest)
				return
			}
			dispatchKeys(rest.slice(0, start))
			pasteActive = true
			rest = rest.slice(start + PASTE_START.length)
		}
	}

	/**
	 * 解析按键序列并逐个分发；解析失败（断裂转义序列等）时退化为按可打印字符插入。
	 * @param {string} text - 不含括号粘贴标记的 stdin 数据。
	 * @returns {void}
	 */
	function dispatchKeys(text) {
		if (!text) return
		/** @type {import('jsr:@cliffy/keycode').KeyCode[]} */
		let keys
		try {
			keys = parseKeyCodes(text)
		} catch {
			for (const ch of text)
				if (ch >= ' ') insertCharAtCursor(ch)
			return
		}
		for (const key of keys) {
			if (replTornDown || stdinReadAbort) return
			handleKey({
				key: key.name,
				char: key.char,
				sequence: key.sequence,
				code: key.code,
				ctrlKey: !!key.ctrl,
				metaKey: !!key.meta,
				shiftKey: !!key.shift,
			})
		}
	}

	// #endregion

	// #region LogSink 接口

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
		// 清屏后输入框回到贴底锚定；整屏擦除（含旧的抬高框），随后 writeLog 触发重绘。
		boxAnchorTop = null
		const { rows, scrollBottom } = layoutOf(resolveInputRows(input))
		let out = `\x1b[1;${scrollBottom}r`
		for (let row = 1; row <= rows; row++)
			out += cursorTo(1, row) + ERASE_LINE
		out += cursorTo(1, 1) + CURSOR_SAVE
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

	// #endregion

	return { writeEntry, appendText, clear, showInitialInfo, focusInput, tearDown: tearDownRepl }
}
