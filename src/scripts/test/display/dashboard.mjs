/**
 * 包管理器式（pacman 风格）测试进度仪表盘。
 *
 * TTY + ANSI 支持时，把 overview / multi 模式的运行状态画成贴底的一块状态区：
 * 首行是总剩余/计数头部，其后每个在跑套件一行（左侧名字、右侧单项进度条）。
 * 套件一结束就把它从状态区“提交”到上方滚动区，带耗时 / 平均 CPU / 峰值内存统计，
 * 让完成的统计永久留在进度区上方（与 pacman/cargo 的底部进度条一致）。
 */
import process from 'node:process'

import { geti18nForTerminal } from '../../i18n/bare.mjs'
import { formatDuration } from '../core/format_duration.mjs'
import { formatScheduleReason } from '../kernel/schedule_event.mjs'

import { splitSuiteKey } from './paint.mjs'

const RESET = '\x1b[0m'
const BOLD = '\x1b[1m'
const DIM = '\x1b[2m'
const CYAN = '\x1b[36m'
const GREEN = '\x1b[32m'
const RED = '\x1b[31m'
const CURSOR_HIDE = '\x1b[?25l'
const CURSOR_SHOW = '\x1b[?25h'

/** 进度条固定宽度（字符）。 */
const BAR_WIDTH = 20
/** 状态区刷新间隔（毫秒）。 */
const REFRESH_MS = 200
/** 立即渲染去抖（毫秒）。 */
const RENDER_THROTTLE_MS = 50
/** 不确定条的 marquee 相位步进间隔（毫秒）。 */
const MARQUEE_STEP_MS = 150

// deno-lint-ignore no-control-regex
const ANSI_ESCAPE = /\x1b\[[0-9;?]*[ -/]*[@-~]/g
// 锚定行首的转义序列（无 g，避免 exec 的 lastIndex 状态影响逐字符扫描）。
// deno-lint-ignore no-control-regex
const ESCAPE_AT_START = /^\x1b\[[0-9;?]*[ -/]*[@-~]/
/** 终端上占两列的字符（CJK 及其标点、全角等常用区段）。 */
const WIDE_CHAR = /[\u1100-\u115F\u2E80-\uA4CF\uA960-\uA97F\uAC00-\uD7A3\uF900-\uFAFF\uFE10-\uFE19\uFE30-\uFE6F\uFF00-\uFF60\uFFE0-\uFFE6]/

/**
 * 剥离 ANSI 转义序列。
 * @param {string} text 文本
 * @returns {string} 纯文本
 */
export function stripAnsi(text) {
	return text.replace(ANSI_ESCAPE, '')
}

/**
 * @param {string} ch 单个 Unicode 字符
 * @returns {number} 1 或 2
 */
function charWidth(ch) {
	return WIDE_CHAR.test(ch) ? 2 : 1
}

/**
 * 文本终端显示宽度（剥离 ANSI、宽字符计 2）。
 * @param {string} text 文本
 * @returns {number} 显示列数
 */
export function visibleWidth(text) {
	let width = 0
	for (const ch of stripAnsi(text)) width += charWidth(ch)
	return width
}

/**
 * 按显示宽度把文本折成多行，不截断任何内容（宽字符计 2，ANSI 序列保持完整）。
 * 仅当放入当前行会超宽时换行；ANSI 转义随文本原样携带，折行后样式自然延续到续行。
 * @param {string} text 含 ANSI 的文本
 * @param {number} maxCols 每行列宽上限
 * @returns {string[]} 折行后的多行文本
 */
export function wrapByWidth(text, maxCols) {
	const limit = Math.max(1, maxCols)
	/** @type {string[]} */
	const lines = []
	let line = ''
	let width = 0
	let i = 0
	while (i < text.length) {
		if (text.charCodeAt(i) === 0x1b) {
			const esc = ESCAPE_AT_START.exec(text.slice(i))
			line += esc ? esc[0] : '\x1b'
			i += esc ? esc[0].length : 1
			continue
		}
		const ch = text[i]
		if (ch === '\n') {
			lines.push(line)
			line = ''
			width = 0
			i++
			continue
		}
		const w = ch === '\r' ? 0 : charWidth(ch)
		if (width > 0 && width + w > limit) {
			lines.push(line)
			line = ''
			width = 0
		}
		line += ch
		width += w
		i++
	}
	lines.push(line)
	return lines
}

/**
 * 紧凑时长（d/h/m/s 拉丁单位，用于进度条行内）。
 * @param {number} ms 毫秒
 * @returns {string} 可读时长
 */
function formatCompactDuration(ms) {
	if (ms == null || ms < 0) return '?'
	const sec = Math.round(ms / 1000)
	if (sec < 60) return `${sec}s`
	const min = Math.floor(sec / 60)
	const remSec = sec % 60
	if (min < 60) return `${min}m${remSec}s`
	return `${Math.floor(min / 60)}h${min % 60}m`
}

/**
 * 峰值内存可读格式。
 * @param {number} mb 兆字节
 * @returns {string} 可读内存（如 320MB / 1.2GB）
 */
function formatMemMb(mb) {
	if (mb >= 1024) return `${(mb / 1024).toFixed(1)}GB`
	return `${Math.round(mb)}MB`
}

/**
 * 渲染单项进度条。
 * @param {number | null} pct 进度百分位（null 为不确定，用向右循环的 marquee）
 * @param {number} width 条宽
 * @param {number} phase 动画相位（毫秒，不确定时用）
 * @returns {string} 渲染好的条（含 ANSI）
 */
export function renderBar(pct, width, phase) {
	if (pct == null) return marquee(phase, width)
	const filled = Math.max(0, Math.min(width, Math.round(pct / 100 * width)))
	const fill = '█'.repeat(filled)
	const rest = '░'.repeat(width - filled)
	const color = pct < 100 ? CYAN : GREEN
	return `${color}${fill}${DIM}${rest}${RESET}`
}

/**
 * 向右循环的 marquee：一段定长高亮块从 0 滑到尾部，绕回再滑。
 * @param {number} phase 相位（毫秒）
 * @param {number} width 条宽
 * @returns {string} 含 ANSI 的条
 */
function marquee(phase, width) {
	const block = Math.max(3, Math.ceil(width / 3))
	const pos = phase % width
	const cells = Array.from({ length: width }, (_, i) =>
		(i - pos + width) % width < block ? `${CYAN}█${RESET}` : '░')
	return `${DIM}${cells.join('')}${RESET}`
}

/**
 * 测试进度仪表盘。
 */
export class TestDashboard {
	/** @type {(text: string) => void} */
	#write
	/** @type {boolean} */
	#enabled
	/** @type {boolean} */
	#begun = false
	/** @type {boolean} */
	#ended = false
	/** @type {string[]} 上次渲染的状态区行（含 ANSI，未按当前宽度折行）。 */
	#statusLines = []
	/** @type {ReturnType<typeof setInterval> | null} */
	#timer = null
	/** @type {boolean} */
	#dirty = false
	/** @type {number} */
	#lastRenderAt = 0
	/** @type {Map<string, { key: string, name: string, expectedMs: number | null | undefined, startedAt: number, remainingMs: number | null }>} */
	#running = new Map()
	/** @type {number} */
	#passed = 0
	/** @type {number} */
	#failed = 0
	/** @type {number} */
	#lastCompletionMs = null
	/** @type {number} */
	#unknownCount = 0
	/** @type {string} */
	#reason = ''
	/** @type {number} */
	#aheadCount = 0
	/** @type {number} */
	#throttleMs

	/**
	 * @param {object} [options] 选项
	 * @param {(text: string) => void} [options.write] stdout 写入函数
	 * @param {boolean} [options.enabled] 是否启用（TTY + ANSI）
	 * @param {number} [options.throttleMs] 立即渲染去抖毫秒（测试用 0）
	 */
	constructor({ write = text => process.stdout.write(text), enabled = true, throttleMs = RENDER_THROTTLE_MS } = {}) {
		this.#write = write
		this.#enabled = enabled
		this.#throttleMs = throttleMs
	}

	/**
	 * 当前终端列数。
	 * @returns {number} 列数
	 */
	get #cols() {
		return process.stdout.columns || 80
	}

	/**
	 * 当前终端行数。
	 * @returns {number} 行数
	 */
	get #rows() {
		return process.stdout.rows || 24
	}

	/**
	 * 是否在构造时启用（TTY + ANSI）。
	 * @returns {boolean} 是否启用
	 */
	get enabled() {
		return this.#enabled
	}

	/**
	 * 是否处于激活（已 begin 且未 end）状态。
	 * @returns {boolean} 是否激活
	 */
	get active() {
		return this.#begun && !this.#ended
	}

	/**
	 * 开始仪表盘（隐藏光标并清空状态）。
	 * @returns {void}
	 */
	begin() {
		if (!this.#enabled || this.#begun) return
		this.#begun = true
		this.#ended = false
		process.stdout.on('resize', this.#onResize)
		this.#write(CURSOR_HIDE)
		this.reset()
	}

	/**
	 * 结束仪表盘：擦除状态区并恢复光标，后续输出回到普通滚动区。
	 * @returns {void}
	 */
	end() {
		if (!this.#begun || this.#ended) return
		this.#ended = true
		if (this.#timer) {
			clearInterval(this.#timer)
			this.#timer = null
		}
		if (this.#statusLines.length > 0) {
			this.#write(`\x1b[${this.#moveUpCount()}A\x1b[J`)
			this.#statusLines = []
		}
		process.stdout.off('resize', this.#onResize)
		this.#write(CURSOR_SHOW)
	}

	/**
	 * resize 事件：立即重绘，避免列数变化后旧状态区物理行数失准。
	 * @returns {void}
	 */
	#onResize = () => {
		if (this.#begun && !this.#ended) this.#scheduleRender()
	}

	/**
	 * 上移行数：按已渲染状态区在当前列宽下的物理折行数精确计算
	 * （终端会把上次写入的每行按当前列数重排，重排后每行的物理行数为 ceil(宽度/列数)）。
	 * @returns {number} 物理行数
	 */
	#moveUpCount() {
		let total = 0
		for (const line of this.#statusLines)
			total += Math.max(1, Math.ceil(visibleWidth(line) / Math.max(1, this.#cols)))
		return Math.min(total, this.#rows - 1)
	}

	/**
	 * 新波次：清空在跑与计数。
	 * @returns {void}
	 */
	reset() {
		if (!this.#begun) return
		this.#running.clear()
		this.#passed = 0
		this.#failed = 0
		this.#lastCompletionMs = null
		this.#unknownCount = 0
		this.#reason = ''
		this.#aheadCount = 0
		this.#scheduleRender()
	}

	/**
	 * @param {object} msg suite-start 载荷
	 * @returns {void}
	 */
	onSuiteStart(msg) {
		if (!this.#begun) return
		this.#running.set(msg.key, {
			key: msg.key,
			name: msg.key,
			expectedMs: msg.expectedMs,
			startedAt: Date.now(),
			remainingMs: null,
		})
		this.#scheduleRender()
	}

	/**
	 * @param {object} msg schedule-update 载荷
	 * @returns {void}
	 */
	onScheduleUpdate(msg) {
		if (!this.#begun) return
		this.#lastCompletionMs = msg.lastCompletionMs
		this.#unknownCount = msg.unknownCount ?? 0
		if (msg.reason && msg.reason !== 'initial') this.#reason = msg.reason
		for (const r of msg.running ?? []) {
			const suite = this.#running.get(r.key)
			if (suite) suite.remainingMs = r.remainingMs
		}
		this.#scheduleRender()
	}

	/**
	 * @param {object} msg job-wait 载荷
	 * @returns {void}
	 */
	onJobWait(msg) {
		if (!this.#begun) return
		this.#aheadCount = msg.aheadCount ?? 0
		this.#scheduleRender()
	}

	/**
	 * @param {object} msg queue-append / queue-remove 载荷
	 * @returns {void}
	 */
	onQueue(msg) {
		if (!this.#begun) return
		this.#commit(geti18nForTerminal(
			msg.type === 'queue-append' ? 'fountConsole.test.display.dashboard.queueAppend' : 'fountConsole.test.display.dashboard.queueRemove',
			{ label: msg.key, reason: msg.reason || '' },
		), { dim: true })
	}

	/**
	 * @param {object} msg suite-end 载荷
	 * @returns {void}
	 */
	onSuiteEnd(msg) {
		if (!this.#begun) return
		this.#running.delete(msg.key)
		if (msg.blockedBy?.length) {
			this.#commit(geti18nForTerminal('fountConsole.test.blocked', { label: msg.key, deps: msg.blockedBy.join(', ') }), { dim: true })
			return
		}
		if (msg.skippedBy?.length) {
			this.#commit(geti18nForTerminal('fountConsole.test.skippedTree', { label: msg.key, deps: msg.skippedBy.join(', ') }), { dim: true })
			return
		}
		if (msg.reused) {
			const { manifestId, name } = splitSuiteKey(msg.key)
			this.#commit(geti18nForTerminal('fountConsole.test.reusedSuite', { manifestId, name, status: msg.status }), { dim: true })
			return
		}
		if (msg.missedReady) {
			this.#commit(geti18nForTerminal('fountConsole.test.moduleCheck.missedReady', { label: msg.key }), { dim: true })
			return
		}
		if (msg.skipBecause?.length) {
			this.#commit(geti18nForTerminal(
				msg.passed ? 'fountConsole.test.skipBecause.pass' : 'fountConsole.test.skipBecause.fail',
				{ label: msg.key, url: (msg.passed ? msg.skipBecause : msg.skipBecauseClosed ?? msg.skipBecause).join(' ') },
			), { dim: true })
			return
		}
		if (msg.passed) this.#passed++
		else this.#failed++
		this.#commit(this.#formatCompleted(msg))
		this.#scheduleRender()
	}

	/**
	 * 提交一行到仪表盘上方的滚动区（错误、清理泄漏等外来消息用）。
	 * @param {string} text 文本
	 * @returns {void}
	 */
	commitLine(text) {
		this.#commit(text)
	}

	/**
	 * 把套件完成行格式化为统计行。
	 * @param {object} msg suite-end 载荷
	 * @returns {string} 含 ANSI 的完成行
	 */
	#formatCompleted(msg) {
		const passed = msg.passed
		const mark = passed ? `${GREEN}✓${RESET}` : `${RED}✗${RESET}`
		const name = passed ? msg.key : `${RED}${msg.key}${RESET}`
		/** @type {string[]} */
		const stats = []
		if (msg.durationMs != null)
			stats.push(geti18nForTerminal('fountConsole.test.display.dashboard.duration', { duration: formatDuration(msg.durationMs) }))
		if (msg.avgCpuPct != null)
			stats.push(geti18nForTerminal('fountConsole.test.display.dashboard.cpu', { cpu: `${Math.round(msg.avgCpuPct)}%` }))
		if (msg.peakMemMb != null)
			stats.push(geti18nForTerminal('fountConsole.test.display.dashboard.memory', { memory: formatMemMb(msg.peakMemMb) }))
		const suffix = stats.length ? `  ${stats.join(' · ')}` : ''
		const noise = msg.noiseHits?.length
			? ` ${geti18nForTerminal('fountConsole.test.noiseHits', { hits: msg.noiseHits.join(', ') })}`
			: ''
		// 失败行名字标红并在行尾加终端响铃。
		const bell = passed ? '' : '\x07'
		return `${mark} ${name}${suffix}${noise}${bell}`
	}

	/**
	 * 在跑套件当前进度百分位。
	 * @param {{ remainingMs: number | null, expectedMs: number | null | undefined }} suite 套件
	 * @param {number} elapsed 已运行毫秒
	 * @returns {number | null} 0..100；无时长基线时 null
	 */
	#progressPct(suite, elapsed) {
		const total = suite.remainingMs ?? suite.expectedMs
		return total > 0 ? Math.min(100, elapsed / total * 100) : null
	}

	/**
	 * 渲染在跑套件行（左侧名字、右侧进度条）。名字过长时折成多行，不截断；
	 * 首行放名字首段 + 信息 + 右侧进度条，续行承接名字余段。
	 * @param {{ name: string, startedAt: number, remainingMs: number | null, expectedMs: number | null | undefined }} suite 套件
	 * @returns {string[]} 含 ANSI 的多行
	 */
	#renderRunningLine(suite) {
		const now = Date.now()
		const elapsed = Math.max(0, now - suite.startedAt)
		const pct = this.#progressPct(suite, elapsed)
		// pctStr 恒宽 4：未知（'   ?'）与百分数（' 58%'）对齐，避免右侧段整体偏移。
		const pctStr = pct == null ? '   ?' : `${String(Math.round(pct)).padStart(3)}%`
		const right = `${renderBar(pct, BAR_WIDTH, Math.floor(now / MARQUEE_STEP_MS))} ${pctStr}`
		const leftMax = Math.max(12, this.#cols - 1 - visibleWidth(right) - 1)
		/** @type {string[]} */
		const info = [geti18nForTerminal('fountConsole.test.display.dashboard.elapsed', { elapsed: formatCompactDuration(elapsed) })]
		if (pct != null) {
			const remaining = Math.max(0, (suite.remainingMs ?? suite.expectedMs) - elapsed)
			info.push(geti18nForTerminal('fountConsole.test.display.dashboard.eta', { remaining: formatCompactDuration(remaining) }))
		}
		const infoStr = info.join(' ')
		const nameMax = Math.max(8, leftMax - visibleWidth(infoStr) - 1)
		const nameRows = wrapByWidth(suite.name, nameMax)
		const first = `${CYAN}${nameRows[0]}${RESET} ${infoStr}`
		const firstLine = `${first}${' '.repeat(Math.max(0, leftMax - visibleWidth(first) + 1))}${right}`
		const rest = nameRows.slice(1).map(row => `${DIM}${row}${RESET}`)
		return [firstLine, ...rest]
	}

	/**
	 * 渲染头部行（总剩余 + 计数）。
	 * @returns {string} 含 ANSI 的头部
	 */
	#renderHeader() {
		/** @type {string[]} */
		const parts = []
		if (this.#lastCompletionMs != null && Number.isFinite(this.#lastCompletionMs))
			parts.push(geti18nForTerminal('fountConsole.test.display.remaining', { remaining: formatDuration(this.#lastCompletionMs) }))
		else
			parts.push(geti18nForTerminal('fountConsole.test.display.dashboard.idle'))
		if (this.#unknownCount > 0)
			parts.push(geti18nForTerminal('fountConsole.test.display.dashboard.unknownCount', { count: this.#unknownCount }))
		if (this.#running.size > 0)
			parts.push(geti18nForTerminal('fountConsole.test.display.dashboard.runningCount', { count: this.#running.size }))
		if (this.#passed > 0)
			parts.push(geti18nForTerminal('fountConsole.test.display.dashboard.passedCount', { count: this.#passed }))
		if (this.#failed > 0)
			parts.push(geti18nForTerminal('fountConsole.test.display.dashboard.failedCount', { count: this.#failed }))
		if (this.#aheadCount > 0)
			parts.push(geti18nForTerminal('fountConsole.test.display.dashboard.queuedCount', { count: this.#aheadCount }))
		let line = parts.join(' · ')
		if (this.#reason && this.#reason !== 'initial')
			line += ` ${geti18nForTerminal('fountConsole.test.display.dashboard.reason', { reason: formatScheduleReason(this.#reason) })}`
		return `${BOLD}${line}${RESET}`
	}

	/**
	 * 组装状态区全部行（头部 + 每在跑套件一行，限高）。
	 * @returns {string[]} 含 ANSI 的行
	 */
	#buildLines() {
		/** @type {string[]} */
		const lines = [this.#renderHeader()]
		for (const suite of this.#running.values())
			lines.push(...this.#renderRunningLine(suite))
		const maxRows = Math.max(2, this.#rows - 1)
		return lines.slice(0, maxRows)
	}

	/**
	 * 重绘状态区（先擦旧区再写新区）。
	 * @returns {void}
	 */
	#render() {
		if (!this.#enabled || !this.#begun || this.#ended) return
		const now = Date.now()
		if (now - this.#lastRenderAt < this.#throttleMs) return
		this.#lastRenderAt = now
		this.#frame()
	}

	/**
	 * 提交一行到滚动区并重绘状态区。
	 * @param {string} text 文本
	 * @param {object} [options] 选项
	 * @param {boolean} [options.dim] 是否置灰
	 * @returns {void}
	 */
	#commit(text, { dim = false } = {}) {
		this.#frame(dim ? `${DIM}${text}${RESET}` : text)
	}

	/**
	 * 画一帧：按需上移到旧状态区顶、清屏，写滚动区新行（若有）与状态区全部行。
	 * 滚动区结果行整行输出、不做列宽处理——终端会自行折行；
	 * 状态区超宽行按列宽折行成多行，不截断内容。
	 * @param {string} [scrolledLine] 提交到滚动区的一行（无则纯重绘）
	 * @returns {void}
	 */
	#frame(scrolledLine) {
		if (!this.#enabled || !this.#begun || this.#ended) return
		let out = ''
		if (this.#statusLines.length > 0) out += `\x1b[${this.#moveUpCount()}A`
		out += '\x1b[J'
		if (scrolledLine != null) out += `${scrolledLine}\r\n`
		this.#statusLines = this.#buildLines()
		for (const line of this.#statusLines)
			for (const seg of wrapByWidth(line, this.#cols - 1)) out += `${seg}\r\n`
		this.#write(out)
		this.#dirty = false
	}

	/**
	 * 有状态变化时立即（去抖）渲染并保证动画定时器在跑。
	 * @returns {void}
	 */
	#scheduleRender() {
		if (!this.#enabled || !this.#begun || this.#ended) return
		this.#dirty = true
		this.#render()
		this.#ensureTimer()
	}

	/**
	 * 在跑时维持刷新定时器；空闲且无变化时停住。
	 * @returns {void}
	 */
	#ensureTimer() {
		if (this.#timer) return
		this.#timer = setInterval(() => {
			if (this.#ended) {
				clearInterval(this.#timer)
				this.#timer = null
				return
			}
			if (this.#running.size === 0 && !this.#dirty) {
				clearInterval(this.#timer)
				this.#timer = null
				return
			}
			this.#render()
			this.#dirty = false
		}, REFRESH_MS)
	}
}
