/**
 * Icon anime host: anim state + TUI player + wait / dismiss / farewell lifecycle.
 * Used by the CLI entry and embedders (e.g. log_viewer) — no separate wait wrapper.
 */

import { lightPointer } from './gesture/light.mjs'
import { windPointer } from './gesture/wind.mjs'
import { ICON_W, ICON_H } from './icon.mjs'
import { AsciiAnimePlayer } from './player.mjs'
import {
	createAnimState, resizeAnimState, enter, hold, exit,
} from './scene.mjs'

/** Target frame rate. */
export const fps = 24

/**
 * Bind anim state to a TUI player (resize + pointer → light / wind).
 * @param {ReturnType<typeof createAnimState>} state anim state
 * @returns {{
 *   state: typeof state,
 *   player: AsciiAnimePlayer,
 *   start: () => void,
 *   stop: () => void,
 *   abort: () => void,
 *   run: () => Promise<void>,
 *   playExit: () => Promise<void>,
 * }} bound player
 */
const bindPlayer = (state) => {
	/**
	 * @param {{ columns: number, rows: number }} size terminal size
	 * @returns {void}
	 */
	const handleResize = (size) => {
		if (!size.columns || !size.rows) return
		resizeAnimState(state, {
			width: Math.max(ICON_W, size.columns),
			height: Math.max(ICON_H + 1, size.rows - 1),
		})
	}

	const player = new AsciiAnimePlayer({
		fps,
		onResize: handleResize,
		/**
		 * Left → click ripple / hold torch; right → stroke wind / long-press vortex.
		 * @param {{ x: number, y: number, left?: boolean, right?: boolean }} ev pointer event
		 * @returns {void}
		 */
		onPointer(ev) {
			const x = Math.max(0, Math.min(state.width - 1, ev.x))
			const y = Math.max(0, Math.min(state.height - 1, ev.y))
			if (ev.left !== undefined)
				lightPointer(state.light, { x, y, left: ev.left })
			if (ev.right !== undefined)
				windPointer(state.wind, { x, y, right: ev.right })
		},
	})

	return {
		state,
		player,
		/** @returns {void} */
		start: () => { player.start() },
		/** @returns {void} */
		stop: () => { player.stop() },
		/** @returns {void} */
		abort: () => { player.abort() },
		/** @returns {Promise<void>} */
		run: () => player.play(() => enter(state)).loop(() => hold(state)),
		/** @returns {Promise<void>} */
		playExit: () => player.play(() => exit(state), { signal: null }),
	}
}

/**
 * @typedef {object} IconAnime
 * @property {boolean} userAborted - hold ended by Ctrl+C (not dismiss / farewell)
 * @property {AbortSignal} userSignal - aborts when userAborted becomes true
 * @property {() => Promise<void>} start - enter alt-screen, enter→hold (idempotent while live)
 * @property {(ms: number) => Promise<void>} sleep - wait; resolves early on user abort
 * @property {() => Promise<void>} dismiss - stop hold, leave alt-screen; keep state for farewell
 * @property {() => Promise<void>} farewell - play exit from live or dismissed progress, restore terminal
 */

/**
 * Create an icon anime host.
 * @param {object} [opts] options
 * @param {() => void} [opts.onUserAbort] Ctrl+C during hold (not after dismiss/farewell)
 * @returns {IconAnime} host
 */
export function createIconAnime({ onUserAbort } = {}) {
	/** @type {ReturnType<typeof bindPlayer> | null} */
	let bound = null
	/** @type {Promise<void> | null} */
	let running = null
	/** dismiss / farewell set this so hold end is not userAborted. */
	let intentionalStop = false
	let userAborted = false
	/** After dismiss: retained for process-quit farewell. */
	/** @type {ReturnType<typeof createAnimState> | null} */
	let farewellState = null
	/** @type {(() => void) | null} */
	let wakeSleep = null
	let userAc = new AbortController()

	return {
		/** @returns {boolean} whether Ctrl+C ended hold */
		get userAborted() {
			return userAborted
		},

		/** @returns {AbortSignal} aborts when userAborted becomes true */
		get userSignal() {
			return userAc.signal
		},

		/**
		 * @returns {Promise<void>} resolves when hold ends (abort / dismiss / farewell)
		 */
		start() {
			if (bound) return running
			userAborted = false
			intentionalStop = false
			userAc = new AbortController()
			bound = bindPlayer(createAnimState())
			farewellState = bound.state
			bound.start()
			running = Promise.resolve(bound.run()).then(() => {
				if (intentionalStop) return
				userAborted = true
				userAc.abort()
				wakeSleep?.()
				onUserAbort?.()
			})
			return running
		},

		/**
		 * @param {number} ms milliseconds
		 * @returns {Promise<void>}
		 */
		sleep(ms) {
			return new Promise((resolve) => {
				const timer = setTimeout(() => {
					wakeSleep = null
					resolve()
				}, ms)
				/**
				 *
				 */
				wakeSleep = () => {
					clearTimeout(timer)
					wakeSleep = null
					resolve()
				}
			})
		},

		/**
		 * @returns {Promise<void>}
		 */
		async dismiss() {
			if (!bound) return
			intentionalStop = true
			const live = bound
			const playPromise = running
			bound = null
			running = null
			live.abort()
			await playPromise?.catch(() => { /* abort */ })
			live.stop()
		},

		/**
		 * @returns {Promise<void>}
		 */
		async farewell() {
			if (bound) {
				intentionalStop = true
				const live = bound
				const playPromise = running
				bound = null
				running = null
				farewellState = null
				live.abort()
				await playPromise?.catch(() => { /* abort */ })
				await live.playExit()
				live.stop()
				return
			}
			if (!farewellState) return
			const state = farewellState
			farewellState = null
			const live = bindPlayer(state)
			live.start()
			try {
				await live.playExit()
			}
			finally {
				live.stop()
			}
		},
	}
}
