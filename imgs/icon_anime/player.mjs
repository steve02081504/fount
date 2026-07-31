/**
 * ASCII 动画播放器 — 循环播放、Ctrl+C 中止、TUI、终端缩放、
 * SGR 鼠标（左/右键按下 / 拖拽 / 释放 → onPointer）。
 * 无进程生命周期 / on-shutdown；由调用方自行管理。
 */

import process from 'node:process'
import { setTimeout as sleep } from 'node:timers/promises'

/**
 * @param {string} text 待写入文本
 * @returns {boolean} 是否写入成功
 */
const write = (text) => process.stdout.write(text)

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

/**
 * 将一块 stdin 数据喂入 SGR 鼠标 / Ctrl+C 解析器。
 * 末尾不完整的 CSI 作为 carry 缓冲返回。
 * @param {string} carry 先前不完整字节（latin1）
 * @param {Buffer | Uint8Array} chunk stdin 块
 * @param {{ abort?: () => void, onPointer?: (ev: PointerEvent) => void }} sink Ctrl+C + 指针接收器
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

/** ASCII 动画播放器。 */
export class AsciiAnimePlayer {
	/**
	 * @param {{
	 *   fps?: number,
	 *   onResize?: (size: { columns: number, rows: number }) => void,
	 *   onPointer?: (ev: PointerEvent) => void,
	 * }} [opts] 选项
	 */
	constructor({ fps = 24, onResize, onPointer } = {}) {
		this.fps = fps
		this.onResize = onResize ?? null
		this.onPointer = onPointer ?? null
		this.#onData = null
		this.#resizeListener = null
		this.#ac = null
		this.#stdinCarry = ''
	}

	/** @type {((buf: Buffer) => void) | null} */
	#onData
	/** @type {(() => void) | null} */
	#resizeListener
	/** @type {AbortController | null} */
	#ac
	/** @type {string} */
	#stdinCarry

	/**
	 * 中止当前 play/loop 信号。
	 * @returns {void}
	 */
	abort() {
		this.#ac?.abort()
	}

	/**
	 * @param {{
	 *   onResize?: (size: { columns: number, rows: number }) => void,
	 *   onPointer?: (ev: PointerEvent) => void,
	 *   signal?: AbortSignal,
	 * }} [opts] 选项
	 * @returns {AsciiAnimePlayer} this
	 */
	start({ onResize, onPointer, signal } = {}) {
		this.#ac = new AbortController()
		this.signal = this.#ac.signal
		if (signal?.aborted) this.#ac.abort()
		else signal?.addEventListener('abort', () => this.#ac.abort(), { once: true })

		if (onResize) this.onResize = onResize
		if (onPointer) this.onPointer = onPointer
		this.#stdinCarry = ''

		// Alternate screen keeps the pre-start scrollback + cursor row; leave restores them.
		write(`\x1b[?1049h\x1b[?25l\x1b[2J\x1b[H${MOUSE_ON}`)

		if (process.stdout.isTTY) {
			/** @returns {void} */
			this.#resizeListener = () => this.onResize?.(terminalSize())
			process.stdout.on('resize', this.#resizeListener)
		}

		if (!process.stdin.isTTY) return this
		process.stdin.setRawMode(true)
		process.stdin.resume()
		/**
		 * Ctrl+C 中止；SGR 鼠标 → onPointer。
		 * @param {Buffer} buf stdin 块
		 * @returns {void}
		 */
		this.#onData = (buf) => {
			this.#stdinCarry = consumeStdin(this.#stdinCarry, buf, this)
		}
		process.stdin.on('data', this.#onData)
		return this
	}

	/**
	 * @param {string} frame ANSI 帧
	 * @returns {void}
	 */
	paint(frame) {
		// Frame is full-viewport — home only; skip Erase display.
		write(`\x1b[H${frame}`)
	}

	/**
	 * @param {Iterable<string> | AsyncIterable<string> | (() => Iterable<string> | AsyncIterable<string>)} frames 帧
	 * @param {{ signal?: AbortSignal }} [opts] 选项
	 * @returns {Promise<void>}
	 */
	async #playFrames(frames, { signal } = {}) {
		signal ??= this.signal
		for await (const frame of iterateFrames(frames)) {
			if (signal?.aborted) return
			const started = performance.now()
			this.paint(frame)
			const wait = 1000 / this.fps - (performance.now() - started)
			if (wait <= 0) continue
			try {
				await sleep(wait, undefined, signal ? { signal } : undefined)
			}
			catch (error) {
				if (error?.name === 'AbortError') return
				throw error
			}
		}
	}

	/**
	 * @param {Iterable<string> | AsyncIterable<string> | (() => Iterable<string> | AsyncIterable<string>)} frames 帧
	 * @param {{ signal?: AbortSignal | null }} [opts] 选项
	 * @returns {Promise<void> & { play: Function, loop: Function }} 可链式 play promise
	 */
	play(frames, opts = {}) {
		const signal = this.useSignal(opts.signal)
		const result = this.#playFrames(frames, { ...opts, signal })
		return Object.assign(result, {
			/**
			 * @param {Iterable<string> | AsyncIterable<string> | (() => Iterable<string> | AsyncIterable<string>)} action 帧
			 * @param {{ signal?: AbortSignal | null }} [options] 选项
			 * @returns {Promise<void> & { play: Function, loop: Function }} 可链式 play promise
			 */
			play: async (action, options) => {
				await result
				return this.play(action, { ...opts, ...options })
			},
			/**
			 * @param {Iterable<string> | AsyncIterable<string> | (() => Iterable<string> | AsyncIterable<string>)} action 帧
			 * @param {{ signal?: AbortSignal | null }} [options] 选项
			 * @returns {Promise<void>} loop promise
			 */
			loop: async (action, options) => {
				await result
				return this.loop(action, { ...opts, ...options })
			},
		})
	}

	/**
	 * @returns {AbortSignal} 新信号
	 */
	refreshSignal() {
		this.#ac = new AbortController()
		this.signal = this.#ac.signal
		return this.signal
	}

	/**
	 * 选择本次 play 使用的信号。
	 * - `undefined` → 沿用当前 play 信号
	 * - `null` → 新建信号（中止后再播，如 farewell）
	 * - `AbortSignal` → 交叉接线：该信号中止时一并 abort play
	 * @param {AbortSignal | null | undefined} signal 覆盖
	 * @returns {AbortSignal | undefined} 活动信号
	 */
	useSignal(signal) {
		if (signal === undefined) return this.signal
		if (signal === null) return this.refreshSignal()
		if (!signal.aborted && this.signal && !this.signal.aborted)
			signal.addEventListener('abort', () => this.abort(), { once: true })
		return this.signal
	}

	/**
	 * @param {Iterable<string> | AsyncIterable<string> | (() => Iterable<string> | AsyncIterable<string>)} frames 帧
	 * @param {{ signal?: AbortSignal | null }} [opts] 选项
	 * @returns {Promise<void>}
	 */
	async loop(frames, { signal } = {}) {
		signal = this.useSignal(signal)
		while (!signal?.aborted)
			await this.#playFrames(frames, { signal: this.signal })
	}

	/** 离开备用屏（恢复启动前滚动缓冲 + 光标）/ 原始模式 / 缩放监听。 */
	stop() {
		if (this.#resizeListener) {
			process.stdout.off('resize', this.#resizeListener)
			this.#resizeListener = null
		}
		if (this.#onData) {
			process.stdin.off('data', this.#onData)
			this.#onData = null
		}
		if (process.stdin.isTTY)
			try { process.stdin.setRawMode(false) } catch { /* Node/Deno teardown on odd TTYs */ }

		try { process.stdin.pause() } catch { /* already paused */ }
		write(`${MOUSE_OFF}\x1b[?25h\x1b[0m\x1b[?1049l`)
		this.#stdinCarry = ''
	}
}
