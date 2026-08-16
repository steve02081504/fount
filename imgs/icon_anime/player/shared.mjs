/**
 * ASCII 动画播放器 — 循环播放、Ctrl+C / 长按 ESC 中止、TUI、终端缩放、
 * SGR 鼠标（左/右键按下 / 拖拽 / 释放 → onPointer）。
 * 终端可用性只在此层判断；无进程生命周期，由 session 管理。
 */

import { delay } from '../delay.mjs'
import { canUseTui, getIO, watchTerminalSize } from '../io.mjs'

/**
 * @param {string} text 待写入文本
 * @returns {boolean} 是否写入成功
 */
const write = (text) => {
	const { stdout } = getIO()
	return Boolean(stdout?.targetStream.write(text))
}

/** 启用 SGR 按键 + 拖拽鼠标上报。 */
const MOUSE_ON = '\x1b[?1000h\x1b[?1002h\x1b[?1006h'
/** 禁用鼠标上报（逆序）。 */
const MOUSE_OFF = '\x1b[?1006l\x1b[?1002l\x1b[?1000l'
/** 关自动换行：满宽行再 `\n` 否则会 wrap 进下一行再换行，隔出空行。 */
const WRAP_OFF = '\x1b[?7l'
/** 恢复自动换行（离开备用屏前）。 */
const WRAP_ON = '\x1b[?7h'

/**
 * SGR 鼠标指针事件。仅设置发生变化的按键
 *（`left` 和/或 `right`）；另一字段省略。
 * @typedef {{ x: number, y: number, left?: boolean, right?: boolean }} PointerEvent
 */

/** 连续 ESC（键重复）达到此时长则中止。 */
export const ESC_HOLD_MS = 4000
/** ESC 重复间隔超过此时长则重新计时（视为松开）。 */
export const ESC_HOLD_GAP_MS = 500

/**
 * ESC 长按计时：靠终端键重复确认仍在按住；无松开事件。
 * 触发一次后保持闩锁，避免退场动画播放期间键重复再次 abort。
 * @param {number} [holdMs] 触发中止的持续时长
 * @param {number} [gapMs] 允许的最大重复间隔
 * @returns {{ note: (now: number) => boolean, reset: () => void }} note 在达到 holdMs 时返回 true（仅一次）
 */
export function createEscHold(holdMs = ESC_HOLD_MS, gapMs = ESC_HOLD_GAP_MS) {
	/** @type {number | null} */
	let start = null
	let last = 0
	let fired = false
	return {
		/**
		 * @param {number} now 单调时钟（ms）
		 * @returns {boolean} 是否刚达到 holdMs（已触发过则恒 false）
		 */
		note(now) {
			if (fired) return false
			if (start == null || now - last > gapMs) start = now
			last = now
			if (now - start < holdMs) return false
			fired = true
			return true
		},
		/**
		 * 清除 start、last、fired，重新允许一次触发。
		 * @returns {void}
		 */
		reset() {
			start = null
			last = 0
			fired = false
		},
	}
}

const latin1 = new TextDecoder('latin1')

/**
 * 将一块 stdin 数据喂入 SGR 鼠标 / Ctrl+C / ESC 解析器。
 * 末尾不完整的 CSI 作为 carry 缓冲返回。
 * @param {string} carry 先前不完整字节（latin1）
 * @param {Buffer | Uint8Array} chunk stdin 块
 * @param {{ abort?: () => void, onPointer?: (pointerEvent: PointerEvent) => void, onEsc?: () => void }} sink Ctrl+C / ESC / 指针接收器
 * @returns {string} 新 carry
 */
export const consumeStdin = (carry, chunk, sink = {}) => {
	const text = carry + latin1.decode(chunk)
	if (chunk.includes(0x03)) sink.abort?.()

	let cursor = 0
	while (cursor < text.length) {
		if (text.charCodeAt(cursor) !== 0x1b) {
			cursor++
			continue
		}
		if (cursor + 1 >= text.length) break
		if (text[cursor + 1] !== '[') {
			// Bare ESC (not CSI): only ESC-ESC counts as ESC key / hold.
			// ESC + other char (e.g. Alt+x) consumes ESC as Alt prefix — no onEsc.
			if (text[cursor + 1] === '\x1b') sink.onEsc?.()
			cursor++
			continue
		}
		// SGR mouse: ESC [ < button ; x ; y M|m
		if (cursor + 2 < text.length && text[cursor + 2] === '<') {
			let end = cursor + 3
			while (end < text.length && text[end] !== 'M' && text[end] !== 'm') end++
			if (end >= text.length) break
			const body = text.slice(cursor + 3, end)
			const pressed = text[end] === 'M'
			const parts = body.split(';')
			if (parts.length >= 3 && sink.onPointer) {
				const button = +parts[0]
				const x = +parts[1] - 1
				const y = +parts[2] - 1
				// Ignore wheel. button&3 is the button; +32 = drag motion.
				const which = button & 3
				if (!(button & 64) && (which === 0 || which === 2))
					sink.onPointer(which === 0
						? { x, y, left: pressed }
						: { x, y, right: pressed })
			}
			cursor = end + 1
			continue
		}
		// Other CSI: skip until final byte
		let end = cursor + 2
		while (end < text.length && (text.charCodeAt(end) < 0x40 || text.charCodeAt(end) > 0x7e)) end++
		if (end >= text.length) break
		cursor = end + 1
	}
	return text.slice(cursor)
}

/** 目标帧率。 */
export const fps = 24

/** @type {AbortController} */
let ac = new AbortController()
/** 当前播放中止信号（模块私有）。 */
let playSignal = ac.signal

/** @type {string} */
let stdinCarry = ''
/** @type {((buf: Buffer | Uint8Array) => void) | null} */
let onData = null
/** @type {(() => void) | null} */
let unwatchResize = null
/** 本轮 `start` 是否已进入备用屏（`stop` 必须对称拆掉）。 */
let tuiOpen = false

/**
 * 中止当前 play/loop。
 * @returns {void}
 */
export function abort() {
	ac.abort()
}

/**
 * 新建播放信号（farewell 在中止后再播时用）。
 * @returns {AbortSignal} 新信号
 */
export function refreshSignal() {
	ac = new AbortController()
	playSignal = ac.signal
	return playSignal
}

/**
 * 进入备用屏、挂 stdin / resize。
 * @param {{
 *   onResize?: (size: { columns: number, rows: number }) => void,
 *   onPointer?: (pointerEvent: PointerEvent) => void,
 *   onUserAbort?: () => void,
 * }} [opts] 回调
 * @returns {void}
 */
export function start({ onResize, onPointer, onUserAbort } = {}) {
	refreshSignal()
	stdinCarry = ''

	if (!canUseTui()) return

	tuiOpen = true
	const { console: virtualConsole, stdin } = getIO()
	// Defer console output until stop leaves the alternate screen.
	virtualConsole.block()
	// Alternate screen keeps the pre-start scrollback + cursor row; leave restores them.
	write(`\x1b[?1049h${WRAP_OFF}\x1b[?25l\x1b[2J\x1b[H${MOUSE_ON}`)

	if (onResize) unwatchResize = watchTerminalSize(onResize)

	stdin.setRawMode?.(true)
	stdin.resume?.()
	const escHold = createEscHold()
	/** 首次用户中止后闩上，避免 farewell 退场被 ESC 重复 / 连按 Ctrl+C 掐断。 */
	let userAbortArmed = true
	/**
	 * 触发一次用户中止（幂等）。
	 * @returns {void}
	 */
	const tripUserAbort = () => {
		if (!userAbortArmed) return
		userAbortArmed = false
		abort()
		onUserAbort?.()
	}
	/**
	 * Ctrl+C / 长按 ESC 中止；SGR 鼠标 → onPointer。
	 * @param {Buffer | Uint8Array} buf stdin 块
	 * @returns {void}
	 */
	onData = (buf) => {
		stdinCarry = consumeStdin(stdinCarry, buf, {
			abort: tripUserAbort,
			/** ESC 键重复：连续按住满 ESC_HOLD_MS 则中止。 */
			onEsc: () => {
				if (!escHold.note(performance.now())) return
				tripUserAbort()
			},
			onPointer,
		})
	}
	stdin.on('data', onData)
}

/**
 * 将完整 ANSI 帧写到备用屏原点。
 * @param {string} frame ANSI 帧
 * @returns {void}
 */
export function paint(frame) {
	if (!canUseTui()) return
	// Frame is full-viewport — home only; skip Erase display.
	write(`\x1b[H${frame}`)
}

/**
 * 按目标帧率播放一轮帧序列（可中止）。
 * @param {Iterable<string> | AsyncIterable<string> | (() => Iterable<string> | AsyncIterable<string>)} frames 帧
 * @returns {Promise<void>}
 */
async function playFrames(frames) {
	if (!canUseTui()) return
	for await (const frame of frames instanceof Function ? frames() : frames) {
		if (playSignal.aborted) return
		const started = performance.now()
		paint(frame)
		const wait = 1000 / fps - (performance.now() - started)
		if (wait <= 0) continue
		try {
			await delay(wait, { signal: playSignal })
		}
		catch (error) {
			if (error?.name === 'AbortError') return
			throw error
		}
	}
}

/**
 * 循环播放直至中止。
 * @param {Iterable<string> | AsyncIterable<string> | (() => Iterable<string> | AsyncIterable<string>)} frames 帧
 * @returns {Promise<void>}
 */
async function loopFrames(frames) {
	if (!canUseTui()) return
	while (!playSignal.aborted)
		await playFrames(frames)
}

/**
 * 为前序播放挂上可继续链式调用的 play / loop。
 * @param {Promise<void>} promise 前序播放
 * @returns {Promise<void> & { play: Function, loop: Function }} 可链式 promise
 */
function withChain(promise) {
	return Object.assign(promise, {
		/**
		 * 前序完成后播放一轮。
		 * @param {Iterable<string> | AsyncIterable<string> | (() => Iterable<string> | AsyncIterable<string>)} action 帧
		 * @returns {Promise<void> & { play: Function, loop: Function }} 可链式 play
		 */
		play: (action) => withChain(promise.then(() => playFrames(action))),
		/**
		 * 前序完成后循环播放。
		 * @param {Iterable<string> | AsyncIterable<string> | (() => Iterable<string> | AsyncIterable<string>)} action 帧
		 * @returns {Promise<void> & { play: Function, loop: Function }} 可链式 play
		 */
		loop: (action) => withChain(promise.then(() => loopFrames(action))),
	})
}

/**
 * 播放一轮帧序列；返回值可继续 `.play` / `.loop`。
 * @param {Iterable<string> | AsyncIterable<string> | (() => Iterable<string> | AsyncIterable<string>)} frames 帧
 * @returns {Promise<void> & { play: Function, loop: Function }} 可链式 play promise
 */
export function play(frames) {
	return withChain(playFrames(frames))
}

/**
 * 循环播放直至中止；返回值可继续 `.play` / `.loop`。
 * @param {Iterable<string> | AsyncIterable<string> | (() => Iterable<string> | AsyncIterable<string>)} frames 帧
 * @returns {Promise<void> & { play: Function, loop: Function }} 可链式 play promise
 */
export function loop(frames) {
	return withChain(loopFrames(frames))
}

/** 离开备用屏 / 原始模式 / 缩放监听。 */
export function stop() {
	stdinCarry = ''

	if (!tuiOpen) return
	tuiOpen = false

	const { console: virtualConsole, stdin } = getIO()

	if (unwatchResize) {
		unwatchResize()
		unwatchResize = null
	}
	if (onData) {
		stdin.off('data', onData)
		onData = null
	}
	try { stdin.setRawMode?.(false) } catch { /* Node/Deno teardown on odd TTYs */ }
	try { stdin.pause?.() } catch { /* already paused */ }
	write(`${MOUSE_OFF}\x1b[?25h\x1b[0m${WRAP_ON}\x1b[?1049l`)
	virtualConsole.unblock()
}
