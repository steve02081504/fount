/**
 * ASCII animation player — loop playback, keyboard, TUI.
 * No process lifecycle / on-shutdown; callers own that.
 *
 * CLI: deno run -A imgs/icon_anime/index.mjs
 */

import process from 'node:process'
import { setTimeout as sleep } from 'node:timers/promises'

/**
 * 写入 stdout。
 * @param {string} s 文本
 * @returns {boolean} write 返回值
 */
const write = (s) => process.stdout.write(s)

/**
 * 读取终端列数/行数（TTY 可用时）；否则为 0。
 * @returns {{ columns: number, rows: number }} 终端尺寸
 */
export const terminalSize = () => ({
	columns: process.stdout.columns || 0,
	rows: process.stdout.rows || 0,
})

/**
 * 将帧源展开为异步迭代。
 * @param {Iterable<string> | AsyncIterable<string> | (() => Iterable<string> | AsyncIterable<string>)} frames 帧序列或工厂
 * @returns {AsyncGenerator<string, void, unknown>} 帧流
 */
async function* iterateFrames(frames) {
	yield* frames?.() ?? frames
}

/** ASCII 动画播放器。 */
export class AsciiAnimePlayer {
	/**
	 * @param {{ fps?: number }} [opts] 播放选项
	 */
	constructor({ fps = 24 } = {}) {
		this.fps = fps
		this.speed = 1
		this.paused = false
		this.#onKey = null
		this.#onData = null
		this.#ac = null
	}

	/** @type {((key: string, buf: Buffer) => void) | null} */
	#onKey
	/** @type {((buf: Buffer) => void) | null} */
	#onData
	/** @type {AbortController | null} */
	#ac

	/** 中止当前播放（原始 Ctrl+C / 调用方 shutdown）。 */
	abort() {
		this.#ac?.abort()
	}

	/**
	 * 打开 TUI：清屏、隐藏光标、raw stdin。
	 * @param {{ onKey?: (key: string, buf: Buffer) => void, signal?: AbortSignal }} [opts] 按键与外部 abort
	 * @returns {AsciiAnimePlayer} this
	 */
	start({ onKey, signal } = {}) {
		this.#ac = new AbortController()
		this.signal = this.#ac.signal
		if (signal) 
			if (signal.aborted) this.#ac.abort()
			else signal.addEventListener('abort', () => this.#ac.abort(), { once: true })
		
		this.#onKey = onKey ?? (ch => {
			if (ch === '\x03') this.abort()
		})
		write('\x1b[?25l\x1b[2J\x1b[H')
		if (!process.stdin.isTTY) return this
		process.stdin.setRawMode(true)
		process.stdin.resume()
		/**
		 * raw stdin 数据处理：空格暂停、[/] 调速、其余交给 onKey。
		 * @param {Buffer} buf 输入缓冲
		 * @returns {void}
		 */
		this.#onData = (buf) => {
			for (let i = 0; i < buf.length; i++) {
				const c = buf[i]
				const ch = String.fromCharCode(c)
				if (ch === ' ') this.paused = !this.paused
				else if (ch === '[') this.speed = Math.max(0.25, +(this.speed / 1.25).toFixed(3))
				else if (ch === ']') this.speed = Math.min(8, +(this.speed * 1.25).toFixed(3))
				else this.#onKey?.(ch, buf.subarray(i))
			}
		}
		process.stdin.on('data', this.#onData)
		return this
	}

	/**
	 * 绘制一帧 ANSI。
	 * @param {string} frame 帧文本
	 * @returns {void}
	 */
	paint(frame) {
		write(`\x1b[H\x1b[J${frame}`)
	}

	/**
	 * 播放帧序列一次（传入函数则每次重启 generator）。
	 * signal abort 时提前结束。
	 * @param {Iterable<string> | AsyncIterable<string> | (() => Iterable<string> | AsyncIterable<string>)} frames 帧源
	 * @param {{ signal?: AbortSignal }} [opts] 可选 abort
	 * @returns {Promise<void>}
	 */
	async #base_play(frames, { signal } = {}) {
		signal ??= this.signal
		/**
		 * 单帧时间预算（毫秒）。
		 * @returns {number} 帧间隔
		 */
		const budget = () => 1000 / (this.fps * this.speed)
		for await (const frame of iterateFrames(frames)) {
			if (signal?.aborted) return
			while (this.paused && !signal?.aborted)
				try {
					await sleep(50, undefined, signal ? { signal } : undefined)
				}
				catch (e) {
					if (e?.name === 'AbortError') return
					throw e
				}

			if (signal?.aborted) return
			const t0 = performance.now()
			this.paint(frame)
			const wait = budget() - (performance.now() - t0)
			if (wait <= 0) continue
			try {
				await sleep(wait, undefined, signal ? { signal } : undefined)
			}
			catch (e) {
				if (e?.name === 'AbortError') return
				throw e
			}
		}
	}

	/**
	 * 播放帧序列一次；返回的 Promise 可链式 `.play` / `.loop`。
	 * `signal: null` 会刷新内部 AbortController（例如 abort 后播 exit）。
	 * @param {Iterable<string> | AsyncIterable<string> | (() => Iterable<string> | AsyncIterable<string>)} frames 帧源
	 * @param {{ signal?: AbortSignal | null }} [opts] 可选 abort；null 刷新内部 signal
	 * @returns {Promise<void> & { play: Function, loop: Function }} 可链式播放的 Promise
	 */
	play(frames, opts = {}) {
		const signal = this.useSignal(opts.signal)
		const result = this.#base_play(frames, { ...opts, signal })
		return Object.assign(result, {
			/**
			 * 等当前段结束后再播下一段。
			 * @param {Iterable<string> | AsyncIterable<string> | (() => Iterable<string> | AsyncIterable<string>)} action 帧源
			 * @param {{ signal?: AbortSignal | null }} [options] 覆盖选项
			 * @returns {Promise<void> & { play: Function, loop: Function }} 链式 Promise
			 */
			play: async (action, options) => {
				await result
				return this.play(action, { ...opts, ...options })
			},
			/**
			 * 等当前段结束后进入循环播放。
			 * @param {Iterable<string> | AsyncIterable<string> | (() => Iterable<string> | AsyncIterable<string>)} action 帧源
			 * @param {{ signal?: AbortSignal | null }} [options] 覆盖选项
			 * @returns {Promise<void>}
			 */
			loop: async (action, options) => {
				await result
				return this.loop(action, { ...opts, ...options })
			},
		})
	}

	/**
	 * 刷新内部 AbortController。
	 * @returns {AbortSignal} 新 signal
	 */
	refreshSignal() {
		this.#ac = new AbortController()
		this.signal = this.#ac.signal
		return this.signal
	}

	/**
	 * 解析本次播放使用的 signal。
	 * @param {AbortSignal | null | undefined} signal undefined=沿用；null=刷新；否则挂到内部 abort
	 * @returns {AbortSignal | undefined} 实际使用的 signal
	 */
	useSignal(signal) {
		if (signal === undefined) return this.signal
		if (signal === null) return this.refreshSignal()
		if (!signal.aborted && this.signal && !this.signal.aborted)
			signal.addEventListener('abort', () => this.abort(), { once: true })
		return this.signal
	}

	/**
	 * 循环重放直到 signal abort（无限 generator：一次 play 播到 abort）。
	 * @param {Iterable<string> | AsyncIterable<string> | (() => Iterable<string> | AsyncIterable<string>)} frames 帧源
	 * @param {{ signal?: AbortSignal | null }} [opts] 可选 abort
	 * @returns {Promise<void>}
	 */
	async loop(frames, { signal } = {}) {
		signal = this.useSignal(signal)
		while (!signal?.aborted)
			await this.#base_play(frames, { signal: this.signal })
	}

	/** 恢复光标 / raw mode。 */
	stop() {
		if (this.#onData) {
			process.stdin.off('data', this.#onData)
			this.#onData = null
		}
		if (process.stdin.isTTY)
			try { process.stdin.setRawMode(false) } catch { /* */ }

		try { process.stdin.pause() } catch { /* */ }
		write('\x1b[?25h\x1b[0m\n')
		this.#onKey = null
	}
}
