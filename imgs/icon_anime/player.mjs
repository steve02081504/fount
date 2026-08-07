/**
 * ASCII 动画播放器 — 循环播放、Ctrl+C / 长按 ESC 中止、TUI、终端缩放、
 * SGR 鼠标（左/右键按下 / 拖拽 / 释放 → onPointer）。
 * 终端可用性只在此层判断；无进程生命周期，由 session 管理。
 */

import process from 'node:process'
import { setTimeout as sleep } from 'node:timers/promises'

import { console } from 'npm:@steve02081504/virtual-console'

import { canUseTui } from './terminal.mjs'

const nativeStdout = process.stdout.targetStream

/**
 * @param {string} text 待写入文本
 * @returns {boolean} 是否写入成功
 */
const write = (text) => nativeStdout.write(text)

/**
 * @returns {{ columns: number, rows: number }} 终端尺寸
 */
export const terminalSize = () => ({
	columns: process.stdout.columns || 0,
	rows: process.stdout.rows || 0,
})

/**
 * @param {Iterable<string> | AsyncIterable<string> | (() => Iterable<string> | AsyncIterable<string>)} frames 帧或工厂
 * @returns {AsyncGenerator<string, void, unknown>} 帧流
 */
async function* iterateFrames(frames) {
	yield* typeof frames === 'function' ? frames() : frames
}

/** 启用 SGR 按键 + 拖拽鼠标上报。 */
const MOUSE_ON = '\x1b[?1000h\x1b[?1002h\x1b[?1006h'
/** 禁用鼠标上报（逆序）。 */
const MOUSE_OFF = '\x1b[?1006l\x1b[?1002l\x1b[?1000l'

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
 * @param {number} [holdMs] 触发中止的持续时长
 * @param {number} [gapMs] 允许的最大重复间隔
 * @returns {{ note: (now: number) => boolean, reset: () => void }} note 在达到 holdMs 时返回 true
 */
export function createEscHold(holdMs = ESC_HOLD_MS, gapMs = ESC_HOLD_GAP_MS) {
	let start = 0
	let last = 0
	return {
		/**
		 * @param {number} now 单调时钟（ms）
		 * @returns {boolean} 是否已连续按住满 holdMs
		 */
		note(now) {
			if (!start || now - last > gapMs) start = now
			last = now
			return now - start >= holdMs
		},
		/** @returns {void} */
		reset() {
			start = last = 0
		},
	}
}

/**
 * 将一块 stdin 数据喂入 SGR 鼠标 / Ctrl+C / ESC 解析器。
 * 末尾不完整的 CSI 作为 carry 缓冲返回。
 * @param {string} carry 先前不完整字节（latin1）
 * @param {Buffer | Uint8Array} chunk stdin 块
 * @param {{ abort?: () => void, onPointer?: (pointerEvent: PointerEvent) => void, onEsc?: () => void }} sink Ctrl+C / ESC / 指针接收器
 * @returns {string} 新 carry
 */
export const consumeStdin = (carry, chunk, sink = {}) => {
	let text = carry
	for (let offset = 0; offset < chunk.length; offset++) {
		const byte = chunk[offset]
		if (byte === 0x03) sink.abort?.()
		text += String.fromCharCode(byte)
	}

	let cursor = 0
	while (cursor < text.length) {
		if (text.charCodeAt(cursor) !== 0x1b) {
			cursor++
			continue
		}
		if (cursor + 1 >= text.length) break
		if (text[cursor + 1] !== '[') {
			// Bare ESC (not CSI): key or Alt-prefix. Confirm before consuming.
			sink.onEsc?.()
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
/** 当前播放中止信号。 */
export let signal = ac.signal

/** @type {string} */
let stdinCarry = ''
/** @type {((buf: Buffer) => void) | null} */
let onData = null
/** @type {(() => void) | null} */
let resizeListener = null

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
	signal = ac.signal
	return signal
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

	if (!canUseTui) return

	// Defer global console output until stop leaves the alternate screen.
	console.block()
	// Alternate screen keeps the pre-start scrollback + cursor row; leave restores them.
	write(`\x1b[?1049h\x1b[?25l\x1b[2J\x1b[H${MOUSE_ON}`)

	/** @returns {void} */
	resizeListener = () => onResize?.(terminalSize())
	process.stdout.on('resize', resizeListener)

	process.stdin.setRawMode(true)
	process.stdin.resume()
	const escHold = createEscHold()
	/**
	 * Ctrl+C / 长按 ESC 中止；SGR 鼠标 → onPointer。
	 * @param {Buffer} buf stdin 块
	 * @returns {void}
	 */
	onData = (buf) => {
		stdinCarry = consumeStdin(stdinCarry, buf, {
			/** Ctrl+C：中止播放并通知会话。 */
			abort: () => {
				abort()
				onUserAbort?.()
			},
			/** ESC 键重复：连续按住满 ESC_HOLD_MS 则中止。 */
			onEsc: () => {
				if (!escHold.note(performance.now())) return
				abort()
				onUserAbort?.()
			},
			onPointer,
		})
	}
	process.stdin.on('data', onData)
}

/**
 * 将完整 ANSI 帧写到备用屏原点。
 * @param {string} frame ANSI 帧
 * @returns {void}
 */
export function paint(frame) {
	if (!canUseTui) return
	// Frame is full-viewport — home only; skip Erase display.
	write(`\x1b[H${frame}`)
}

/**
 * 按目标帧率播放一轮帧序列（可中止）。
 * @param {Iterable<string> | AsyncIterable<string> | (() => Iterable<string> | AsyncIterable<string>)} frames 帧
 * @returns {Promise<void>}
 */
async function playFrames(frames) {
	if (!canUseTui) return
	for await (const frame of iterateFrames(frames)) {
		if (signal.aborted) return
		const started = performance.now()
		paint(frame)
		const wait = 1000 / fps - (performance.now() - started)
		if (wait <= 0) continue
		try {
			await sleep(wait, undefined, { signal })
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
	if (!canUseTui) return
	while (!signal.aborted)
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

	if (!canUseTui) return

	if (resizeListener) {
		process.stdout.off('resize', resizeListener)
		resizeListener = null
	}
	if (onData) {
		process.stdin.off('data', onData)
		onData = null
	}
	try { process.stdin.setRawMode(false) } catch { /* Node/Deno teardown on odd TTYs */ }
	try { process.stdin.pause() } catch { /* already paused */ }
	write(`${MOUSE_OFF}\x1b[?25h\x1b[0m\x1b[?1049l`)
	console.unblock()
}
