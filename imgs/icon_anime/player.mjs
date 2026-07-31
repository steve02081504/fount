/**
 * ASCII animation player — loop playback, Ctrl+C abort, TUI, terminal resize,
 * SGR mouse (left press / drag / release → onPointer).
 * No process lifecycle / on-shutdown; callers own that.
 */

import process from 'node:process'
import { setTimeout as sleep } from 'node:timers/promises'

/**
 * @param {string} s text to write
 * @returns {boolean} whether the write succeeded
 */
const write = (s) => process.stdout.write(s)

/**
 * @returns {{ columns: number, rows: number }} terminal size
 */
export const terminalSize = () => ({
	columns: process.stdout.columns || 0,
	rows: process.stdout.rows || 0,
})

/**
 * @param {Iterable<string> | AsyncIterable<string> | (() => Iterable<string> | AsyncIterable<string>)} frames frames or factory
 * @returns {AsyncGenerator<string, void, unknown>} frame stream
 */
async function* iterateFrames(frames) {
	yield* typeof frames === 'function' ? frames() : frames
}

/** Enable SGR button + drag mouse reporting. */
const MOUSE_ON = '\x1b[?1000h\x1b[?1002h\x1b[?1006h'
/** Disable mouse reporting (reverse order). */
const MOUSE_OFF = '\x1b[?1006l\x1b[?1002l\x1b[?1000l'

/**
 * @typedef {{ x: number, y: number, left: boolean }} PointerEvent
 */

/**
 * Feed one stdin chunk into an SGR mouse / Ctrl+C parser.
 * Incomplete CSI at the end is returned as the carry buffer.
 * @param {string} carry previous incomplete bytes (latin1)
 * @param {Buffer | Uint8Array} chunk stdin chunk
 * @param {{ abort?: () => void, onPointer?: (ev: PointerEvent) => void }} sink Ctrl+C + pointer sink (e.g. the player)
 * @returns {string} new carry
 */
export const consumeStdin = (carry, chunk, sink = {}) => {
	for (let i = 0; i < chunk.length; i++)
		if (chunk[i] === 0x03) sink.abort?.()

	let s = carry
	for (let i = 0; i < chunk.length; i++)
		s += String.fromCharCode(chunk[i])

	let i = 0
	while (i < s.length) {
		if (s.charCodeAt(i) !== 0x1b) {
			i++
			continue
		}
		if (i + 1 >= s.length) break
		if (s[i + 1] !== '[') {
			i++
			continue
		}
		// SGR mouse: ESC [ < btn ; x ; y M|m
		if (i + 2 < s.length && s[i + 2] === '<') {
			let j = i + 3
			while (j < s.length && s[j] !== 'M' && s[j] !== 'm') j++
			if (j >= s.length) break
			const body = s.slice(i + 3, j)
			const press = s[j] === 'M'
			const parts = body.split(';')
			if (parts.length >= 3 && sink.onPointer) {
				const btn = +parts[0]
				const x = +parts[1] - 1
				const y = +parts[2] - 1
				// Ignore wheel / non-left. btn&3 is the button; +32 = drag motion.
				if (!(btn & 64) && (btn & 3) === 0)
					sink.onPointer({ x, y, left: press })
			}
			i = j + 1
			continue
		}
		// Other CSI: skip until final byte
		let j = i + 2
		while (j < s.length && (s.charCodeAt(j) < 0x40 || s.charCodeAt(j) > 0x7e)) j++
		if (j >= s.length) break
		i = j + 1
	}
	return s.slice(i)
}

/** ASCII animation player. */
export class AsciiAnimePlayer {
	/**
	 * @param {{
	 *   fps?: number,
	 *   onResize?: (size: { columns: number, rows: number }) => void,
	 *   onPointer?: (ev: PointerEvent) => void,
	 * }} [opts] options
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
	 * Abort the active play/loop signal.
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
	 * }} [opts] options
	 * @returns {AsciiAnimePlayer} this
	 */
	start({ onResize, onPointer, signal } = {}) {
		this.#ac = new AbortController()
		this.signal = this.#ac.signal
		if (signal)
			if (signal.aborted) this.#ac.abort()
			else signal.addEventListener('abort', () => this.#ac.abort(), { once: true })

		if (onResize) this.onResize = onResize
		if (onPointer) this.onPointer = onPointer
		this.#stdinCarry = ''

		// Alternate screen keeps the pre-start scrollback + cursor row; leave restores them.
		write(`\x1b[?1049h\x1b[?25l\x1b[2J\x1b[H${MOUSE_ON}`)

		if (process.stdout.isTTY) {
			/**
			 * @returns {void}
			 */
			this.#resizeListener = () => this.onResize?.(terminalSize())
			process.stdout.on('resize', this.#resizeListener)
		}

		if (!process.stdin.isTTY) return this
		process.stdin.setRawMode(true)
		process.stdin.resume()
		/**
		 * Raw mode: Ctrl+C aborts; SGR mouse → onPointer; other CSI discarded.
		 * @param {Buffer} buf stdin chunk
		 * @returns {void}
		 */
		this.#onData = (buf) => {
			this.#stdinCarry = consumeStdin(this.#stdinCarry, buf, this)
		}
		process.stdin.on('data', this.#onData)
		return this
	}

	/**
	 * @param {string} frame ANSI frame
	 * @returns {void}
	 */
	paint(frame) {
		write(`\x1b[H\x1b[J${frame}`)
	}

	/**
	 * @param {Iterable<string> | AsyncIterable<string> | (() => Iterable<string> | AsyncIterable<string>)} frames frames
	 * @param {{ signal?: AbortSignal }} [opts] options
	 * @returns {Promise<void>}
	 */
	async #playFrames(frames, { signal } = {}) {
		signal ??= this.signal
		for await (const frame of iterateFrames(frames)) {
			if (signal?.aborted) return
			const t0 = performance.now()
			this.paint(frame)
			const wait = 1000 / this.fps - (performance.now() - t0)
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
	 * @param {Iterable<string> | AsyncIterable<string> | (() => Iterable<string> | AsyncIterable<string>)} frames frames
	 * @param {{ signal?: AbortSignal | null }} [opts] options
	 * @returns {Promise<void> & { play: Function, loop: Function }} chainable play promise
	 */
	play(frames, opts = {}) {
		const signal = this.useSignal(opts.signal)
		const result = this.#playFrames(frames, { ...opts, signal })
		return Object.assign(result, {
			/**
			 * @param {Iterable<string> | AsyncIterable<string> | (() => Iterable<string> | AsyncIterable<string>)} action frames
			 * @param {{ signal?: AbortSignal | null }} [options] options
			 * @returns {Promise<void> & { play: Function, loop: Function }} chainable play promise
			 */
			play: async (action, options) => {
				await result
				return this.play(action, { ...opts, ...options })
			},
			/**
			 * @param {Iterable<string> | AsyncIterable<string> | (() => Iterable<string> | AsyncIterable<string>)} action frames
			 * @param {{ signal?: AbortSignal | null }} [options] options
			 * @returns {Promise<void>} loop promise
			 */
			loop: async (action, options) => {
				await result
				return this.loop(action, { ...opts, ...options })
			},
		})
	}

	/**
	 * @returns {AbortSignal} fresh signal
	 */
	refreshSignal() {
		this.#ac = new AbortController()
		this.signal = this.#ac.signal
		return this.signal
	}

	/**
	 * @param {AbortSignal | null | undefined} signal override
	 * @returns {AbortSignal | undefined} active signal
	 */
	useSignal(signal) {
		if (signal === undefined) return this.signal
		if (signal === null) return this.refreshSignal()
		if (!signal.aborted && this.signal && !this.signal.aborted)
			signal.addEventListener('abort', () => this.abort(), { once: true })
		return this.signal
	}

	/**
	 * @param {Iterable<string> | AsyncIterable<string> | (() => Iterable<string> | AsyncIterable<string>)} frames frames
	 * @param {{ signal?: AbortSignal | null }} [opts] options
	 * @returns {Promise<void>}
	 */
	async loop(frames, { signal } = {}) {
		signal = this.useSignal(signal)
		while (!signal?.aborted)
			await this.#playFrames(frames, { signal: this.signal })
	}

	/** Leave alt screen (restores pre-start scrollback + cursor) / raw mode / resize listener. */
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
			try { process.stdin.setRawMode(false) } catch { /* non-TTY teardown */ }

		try { process.stdin.pause() } catch { /* already paused */ }
		write(`${MOUSE_OFF}\x1b[?25h\x1b[0m\x1b[?1049l`)
		this.#stdinCarry = ''
	}
}
