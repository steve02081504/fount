/**
 * ASCII animation player — loop playback, keyboard, TUI.
 * No process lifecycle / on-shutdown; callers own that.
 *
 * CLI: deno run -A imgs/ascii_anime_player.mjs  →  plays fount icon anim
 */

import process from 'node:process'
import { setTimeout as sleep } from 'node:timers/promises'

const write = (s) => process.stdout.write(s)

/**
 * @param {Iterable<string> | AsyncIterable<string> | (() => Iterable<string> | AsyncIterable<string>)} frames
 */
async function* iterateFrames(frames) {
	yield* frames?.() ?? frames
}

export class AsciiAnimePlayer {
	/** @param {{ fps?: number }} [opts] */
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

	/** Abort current playback (raw Ctrl+C / caller shutdown). */
	abort() {
		this.#ac?.abort()
	}

	/** Open TUI: clear, hide cursor, raw stdin. */
	start({ onKey, signal } = {}) {
		this.#ac = new AbortController()
		this.signal = this.#ac.signal
		if (signal) {
			if (signal.aborted) this.#ac.abort()
			else signal.addEventListener('abort', () => this.#ac.abort(), { once: true })
		}
		this.#onKey = onKey ?? (ch => {
			if (ch === '\x03') this.abort()
		})
		write('\x1b[?25l\x1b[2J\x1b[H')
		if (!process.stdin.isTTY) return this
		process.stdin.setRawMode(true)
		process.stdin.resume()
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

	/** Paint one ANSI frame. */
	paint(frame) {
		write(`\x1b[H\x1b[J${frame}`)
	}

	/**
	 * Play frames once (restarts generator if given a function).
	 * Stops early when signal aborts.
	 *
	 * @param {Iterable<string> | AsyncIterable<string> | (() => Iterable<string> | AsyncIterable<string>)} frames
	 * @param {{ signal?: AbortSignal }} [opts]
	 */
	async #base_play(frames, { signal } = {}) {
		signal ??= this.signal
		const budget = () => 1000 / (this.fps * this.speed)
		for await (const frame of iterateFrames(frames)) {
			if (signal?.aborted) return
			while (this.paused && !signal?.aborted) {
				try {
					await sleep(50, undefined, signal ? { signal } : undefined)
				}
				catch (e) {
					if (e?.name === 'AbortError') return
					throw e
				}
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
	 * Play frames once (restarts generator if given a function).
	 * Stops early when signal aborts.
	 * `signal: null` refreshes the internal AbortController (e.g. after abort for exit).
	 *
	 * @param {Iterable<string> | AsyncIterable<string> | (() => Iterable<string> | AsyncIterable<string>)} frames
	 * @param {{ signal?: AbortSignal | null }} [opts]
	 */
	play(frames, opts = {}) {
		const signal = this.useSignal(opts.signal)
		const result = this.#base_play(frames, { ...opts, signal })
		return Object.assign(result, {
			play: async (action, options) => {
				await result
				return this.play(action, { ...opts, ...options })
			},
			loop: async (action, options) => {
				await result
				return this.loop(action, { ...opts, ...options })
			},
		})
	}

	/** @returns {AbortSignal} */
	refreshSignal() {
		this.#ac = new AbortController()
		this.signal = this.#ac.signal
		return this.signal
	}

	/**
	 * @param {AbortSignal | null | undefined} signal
	 * @returns {AbortSignal | undefined}
	 */
	useSignal(signal) {
		if (signal === undefined) return this.signal
		if (signal === null) return this.refreshSignal()
		if (!signal.aborted && this.signal && !this.signal.aborted)
			signal.addEventListener('abort', () => this.abort(), { once: true })
		return this.signal
	}

	/**
	 * Replay frames until signal aborts (infinite generators: one play until abort).
	 *
	 * @param {Iterable<string> | AsyncIterable<string> | (() => Iterable<string> | AsyncIterable<string>)} frames
	 * @param {{ signal?: AbortSignal | null }} [opts]
	 */
	async loop(frames, { signal } = {}) {
		signal = this.useSignal(signal)
		while (!signal?.aborted)
			await this.#base_play(frames, { signal: this.signal })
	}

	/** Restore cursor / raw mode. */
	stop() {
		if (this.#onData) {
			process.stdin.off('data', this.#onData)
			this.#onData = null
		}
		if (process.stdin.isTTY) {
			try { process.stdin.setRawMode(false) } catch { /* */ }
		}
		try { process.stdin.pause() } catch { /* */ }
		write('\x1b[?25h\x1b[0m\n')
		this.#onKey = null
	}
}

if (import.meta.main) {
}
