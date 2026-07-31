/**
 * Icon anime controller: anim state + TUI player.
 * No process hooks — host awaits `farewell` (logo CLI) or registers it on shutdown (log viewer).
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
 * @typedef {object} IconAnime
 * @property {boolean} userAborted - last play ended by Ctrl+C (not dismiss / farewell)
 * @property {AbortSignal} userSignal - aborts when userAborted becomes true
 * @property {() => Promise<void>} start - enter→hold until abort / dismiss (idempotent while live)
 * @property {() => Promise<void>} intro - play enter to completion, park for farewell
 * @property {(ms: number) => Promise<void>} sleep - wait; resolves early on user abort
 * @property {() => Promise<void>} dismiss - stop hold, leave alt-screen; keep state for farewell
 * @property {() => Promise<void>} farewell - play exit from live or parked progress
 */

/**
 * @returns {IconAnime} controller
 */
export function createIconAnime() {
	/** @type {AsciiAnimePlayer | null} */
	let player = null
	/** @type {ReturnType<typeof createAnimState> | null} */
	let state = null
	/** @type {Promise<void> | null} */
	let running = null
	/** @type {ReturnType<typeof createAnimState> | null} */
	let savedState = null
	/** Host-initiated stop / farewell took over. */
	let stopping = false
	let userAborted = false
	let userAc = new AbortController()

	/**
	 * @param {ReturnType<typeof createAnimState>} animState state
	 * @returns {AsciiAnimePlayer} player
	 */
	const openPlayer = (animState) => {
		state = animState
		return new AsciiAnimePlayer({
			fps,
			/**
			 * @param {{ columns: number, rows: number }} size terminal size
			 * @returns {void}
			 */
			onResize(size) {
				if (!size.columns || !size.rows) return
				resizeAnimState(animState, {
					width: Math.max(ICON_W, size.columns),
					height: Math.max(ICON_H + 1, size.rows - 1),
				})
			},
			/**
			 * @param {{ x: number, y: number, left?: boolean, right?: boolean }} ev pointer
			 * @returns {void}
			 */
			onPointer(ev) {
				const x = Math.max(0, Math.min(animState.width - 1, ev.x))
				const y = Math.max(0, Math.min(animState.height - 1, ev.y))
				if (ev.left !== undefined)
					lightPointer(animState.light, { x, y, left: ev.left })
				if (ev.right !== undefined)
					windPointer(animState.wind, { x, y, right: ev.right })
			},
		})
	}

	/**
	 * Leave alt-screen; keep progress for a later farewell.
	 * @returns {void}
	 */
	const park = () => {
		savedState = state
		player?.stop()
		player = null
		state = null
		running = null
	}

	/**
	 * Shared playback shutdown: abort → microtask → await running.
	 * Microtask lets play()'s abort handler settle before we await `running`.
	 * @returns {Promise<void>}
	 */
	const haltPlay = async () => {
		stopping = true
		player.abort()
		await Promise.resolve()
		await running?.catch(() => { /* abort */ })
		running = null
	}

	return {
		/** @returns {boolean} whether last play ended by Ctrl+C */
		get userAborted() {
			return userAborted
		},

		/** @returns {AbortSignal} aborts when userAborted becomes true */
		get userSignal() {
			return userAc.signal
		},

		/**
		 * Enter → hold until Ctrl+C / dismiss.
		 * @returns {Promise<void>}
		 */
		start() {
			if (player) return running
			userAborted = false
			stopping = false
			userAc = new AbortController()
			player = openPlayer(createAnimState())
			savedState = state
			player.start()
			running = player.play(() => enter(state)).loop(() => hold(state)).then(() => {
				if (stopping) return
				userAborted = true
				userAc.abort()
			})
			return running
		},

		/**
		 * Play enter to completion, then leave alt-screen (progress kept for farewell).
		 * @returns {Promise<void>}
		 */
		async intro() {
			if (player) return
			userAborted = false
			stopping = false
			player = openPlayer(createAnimState())
			player.start()
			running = Promise.resolve(player.play(() => enter(state)))
			await running
			if (stopping) return
			if (player.signal?.aborted) userAborted = true
			park()
		},

		/**
		 * @param {number} ms milliseconds
		 * @returns {Promise<void>}
		 */
		sleep(ms) {
			return new Promise((resolve) => {
				const signal = userAc.signal
				if (signal.aborted) {
					resolve()
					return
				}
				/**
				 *
				 */
				const wake = () => {
					clearTimeout(timer)
					signal.removeEventListener('abort', wake)
					resolve()
				}
				const timer = setTimeout(wake, ms)
				signal.addEventListener('abort', wake, { once: true })
			})
		},

		/**
		 * Stop hold, leave alt-screen; keep state for farewell.
		 * @returns {Promise<void>}
		 */
		async dismiss() {
			if (!player) return
			await haltPlay()
			park()
		},

		/**
		 * Play exit from live hold/intro or parked progress.
		 * @returns {Promise<void>}
		 */
		async farewell() {
			if (player) {
				savedState = null
				await haltPlay()
				await player.play(() => exit(state), { signal: null })
				player.stop()
				player = null
				state = null
				return
			}
			if (!savedState) return
			player = openPlayer(savedState)
			savedState = null
			player.start()
			try {
				await player.play(() => exit(state), { signal: null })
			}
			finally {
				player.stop()
				player = null
				state = null
			}
		},
	}
}
