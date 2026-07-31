/**
 * ASCII animation player — loop playback, keyboard, TUI.
 * No process lifecycle / on-shutdown; callers own that.
 *
 * CLI: deno run -A imgs/ascii_player.mjs  →  plays fount icon anim
 */

import process from 'node:process'
import { setTimeout as sleep } from 'node:timers/promises'

const write = (s) => process.stdout.write(s)

/**
 * @param {Iterable<string> | AsyncIterable<string> | (() => Iterable<string> | AsyncIterable<string>)} frames
 */
async function* iterateFrames(frames) {
	const src = typeof frames === 'function' ? frames() : frames
	yield* src
}

export class AsciiPlayer {
	/** @param {{ fps?: number }} [opts] */
	constructor({ fps = 24 } = {}) {
		this.fps = fps
		this.speed = 1
		this.paused = false
		this.#onKey = null
		this.#onData = null
	}

	/** @type {((key: string, buf: Buffer) => void) | null} */
	#onKey
	/** @type {((buf: Buffer) => void) | null} */
	#onData

	/** Open TUI: clear, hide cursor, raw stdin. */
	start({ onKey, signal } = {}) {
		this.signal = signal
		this.#onKey = onKey ?? (ch => {
			if (ch === '\x03') signal?.abort()
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
				await sleep(wait, undefined, { signal })
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
	 *
	 * @param {Iterable<string> | AsyncIterable<string> | (() => Iterable<string> | AsyncIterable<string>)} frames
	 * @param {{ signal?: AbortSignal }} [opts]
	 */
	play(frames, { signal } = {}) {
		signal ??= this.signal
		const result = this.#base_play(frames, { signal })
		return Object.assign(result, {
			play: async (action, options = {signal}) => {
				await result
				this.play(action, options)
			},
			loop: async (action, options = {signal}) => {
				await result
				this.loop(action, options)
			},
		})
	}

	/**
	 * Replay frames until signal aborts (infinite generators: one play until abort).
	 *
	 * @param {Iterable<string> | AsyncIterable<string> | (() => Iterable<string> | AsyncIterable<string>)} frames
	 * @param {{ signal?: AbortSignal }} [opts]
	 */
	async loop(frames, { signal } = {}) {
		signal ??= this.signal
		while (!signal?.aborted)
			await this.play(frames, { signal })
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
		write('\x1b[?25h\x1b[0m\n')
		this.#onKey = null
	}
}

if (import.meta.main) {
	const { play } = await import('./icon_anim.mjs')
	await play()
}
