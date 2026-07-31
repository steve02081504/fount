/**
 * ASCII animation player — loop playback, keyboard, TUI, terminal resize.
 * No process lifecycle / on-shutdown; callers own that.
 *
 * CLI: deno run -A imgs/icon_anime/index.mjs
 */

import process from 'node:process'
import { setTimeout as sleep } from 'node:timers/promises'

/**
 * @param {string} s parameter
 * @returns {boolean} result
 */
const write = (s) => process.stdout.write(s)

/**
 * @returns {{ columns: number, rows: number }} result
 */
export const terminalSize = () => ({
	columns: process.stdout.columns || 0,
	rows: process.stdout.rows || 0,
})

/**
 * @param {Iterable<string> | AsyncIterable<string> | (() => Iterable<string> | AsyncIterable<string>)} frames parameter
 * @returns {AsyncGenerator<string, void, unknown>} result
 */
async function* iterateFrames(frames) {
	yield* frames?.() ?? frames
}

/** ASCII animation player. */
export class AsciiAnimePlayer {
	/**
	 * @param {{ fps?: number, onResize?: (size: { columns: number, rows: number }) => void }} [opts] parameter
	 */
	constructor({ fps = 24, onResize } = {}) {
		this.fps = fps
		this.speed = 1
		this.paused = false
		this.onResize = onResize ?? null
		this.#onKey = null
		this.#onData = null
		this.#onResize = null
		this.#ac = null
	}

	/** @type {((key: string, buf: Buffer) => void) | null} */
	#onKey
	/** @type {((buf: Buffer) => void) | null} */
	#onData
	/** @type {(() => void) | null} */
	#onResize
	/** @type {AbortController | null} */
	#ac

	/**
	 *
	 */
	abort() {
		this.#ac?.abort()
	}

	/**
	 * @param {{ onKey?: (key: string, buf: Buffer) => void, onResize?: (size: { columns: number, rows: number }) => void, signal?: AbortSignal }} [opts] parameter
	 * @returns {AsciiAnimePlayer} result
	 */
	start({ onKey, onResize, signal } = {}) {
		this.#ac = new AbortController()
		this.signal = this.#ac.signal
		if (signal)
			if (signal.aborted) this.#ac.abort()
			else signal.addEventListener('abort', () => this.#ac.abort(), { once: true })

		this.#onKey = onKey ?? (ch => {
			if (ch === '\x03') this.abort()
		})
		if (onResize) this.onResize = onResize

		// Alternate screen keeps the pre-start scrollback + cursor row; leave restores them.
		write('\x1b[?1049h\x1b[?25l\x1b[2J\x1b[H')

		if (process.stdout.isTTY) {
			/**
			 *
			 */
			this.#onResize = () => {
				const size = terminalSize()
				this.onResize?.(size)
			}
			process.stdout.on('resize', this.#onResize)
		}

		if (!process.stdin.isTTY) return this
		process.stdin.setRawMode(true)
		process.stdin.resume()
		/**
		 * @param {Buffer} buf parameter
		 * @returns {void} result
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
	 * @param {string} frame parameter
	 * @returns {void} result
	 */
	paint(frame) {
		write(`\x1b[H\x1b[J${frame}`)
	}

	/**
	 * @param {Iterable<string> | AsyncIterable<string> | (() => Iterable<string> | AsyncIterable<string>)} frames parameter
	 * @param {{ signal?: AbortSignal }} [opts] parameter
	 * @returns {Promise<void>} result
	 */
	async #base_play(frames, { signal } = {}) {
		signal ??= this.signal
		/**
		 * @returns {number} result
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
	 * @param {Iterable<string> | AsyncIterable<string> | (() => Iterable<string> | AsyncIterable<string>)} frames parameter
	 * @param {{ signal?: AbortSignal | null }} [opts] parameter
	 * @returns {Promise<void> & { play: Function, loop: Function }} result
	 */
	play(frames, opts = {}) {
		const signal = this.useSignal(opts.signal)
		const result = this.#base_play(frames, { ...opts, signal })
		return Object.assign(result, {
			/**
			 * @param {Iterable<string> | AsyncIterable<string> | (() => Iterable<string> | AsyncIterable<string>)} action parameter
			 * @param {{ signal?: AbortSignal | null }} [options] parameter
			 * @returns {Promise<void> & { play: Function, loop: Function }} result
			 */
			play: async (action, options) => {
				await result
				return this.play(action, { ...opts, ...options })
			},
			/**
			 * @param {Iterable<string> | AsyncIterable<string> | (() => Iterable<string> | AsyncIterable<string>)} action parameter
			 * @param {{ signal?: AbortSignal | null }} [options] parameter
			 * @returns {Promise<void>} result
			 */
			loop: async (action, options) => {
				await result
				return this.loop(action, { ...opts, ...options })
			},
		})
	}

	/**
	 * @returns {AbortSignal} result
	 */
	refreshSignal() {
		this.#ac = new AbortController()
		this.signal = this.#ac.signal
		return this.signal
	}

	/**
	 * @param {AbortSignal | null | undefined} signal parameter
	 * @returns {AbortSignal | undefined} result
	 */
	useSignal(signal) {
		if (signal === undefined) return this.signal
		if (signal === null) return this.refreshSignal()
		if (!signal.aborted && this.signal && !this.signal.aborted)
			signal.addEventListener('abort', () => this.abort(), { once: true })
		return this.signal
	}

	/**
	 * @param {Iterable<string> | AsyncIterable<string> | (() => Iterable<string> | AsyncIterable<string>)} frames parameter
	 * @param {{ signal?: AbortSignal | null }} [opts] parameter
	 * @returns {Promise<void>} result
	 */
	async loop(frames, { signal } = {}) {
		signal = this.useSignal(signal)
		while (!signal?.aborted)
			await this.#base_play(frames, { signal: this.signal })
	}

	/** Leave alt screen (restores pre-start scrollback + cursor) / raw mode / resize listener. */
	stop() {
		if (this.#onResize) {
			process.stdout.off('resize', this.#onResize)
			this.#onResize = null
		}
		if (this.#onData) {
			process.stdin.off('data', this.#onData)
			this.#onData = null
		}
		if (process.stdin.isTTY)
			try { process.stdin.setRawMode(false) } catch { /* */ }

		try { process.stdin.pause() } catch { /* */ }
		write('\x1b[?25h\x1b[0m\x1b[?1049l')
		this.#onKey = null
	}
}
