/**
 * Icon anime controller: anim state + TUI player.
 * Lifecycle for embedders: start → (dismiss) → farewell. Process hooks stay in the host.
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
 * @property {boolean} userAborted - hold ended by Ctrl+C (not dismiss / farewell)
 * @property {AbortSignal} userSignal - aborts when userAborted becomes true
 * @property {() => Promise<void>} start - enter alt-screen, enter→hold (idempotent while live)
 * @property {(ms: number) => Promise<void>} sleep - wait; resolves early on user abort
 * @property {() => Promise<void>} dismiss - stop hold, leave alt-screen; keep state for farewell
 * @property {() => Promise<void>} farewell - play exit from live or dismissed progress, restore terminal
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
	/** Dismissed (or pre-farewell) anim progress. */
	/** @type {ReturnType<typeof createAnimState> | null} */
	let savedState = null
	/** dismiss / farewell — do not treat hold end as userAborted. */
	let stopping = false
	let userAborted = false
	/** @type {(() => void) | null} */
	let wakeSleep = null
	let userAc = new AbortController()

	/**
	 * Wire a player to an anim state (resize + pointer).
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
	 * Abort hold and wait for the run promise to settle.
	 * @returns {Promise<void>}
	 */
	const stopHold = async () => {
		stopping = true
		player?.abort()
		await Promise.resolve()
		await running?.catch(() => { /* abort */ })
		running = null
	}

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
				wakeSleep?.()
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
			if (!player) return
			savedState = state
			await stopHold()
			player.stop()
			player = null
			state = null
		},

		/**
		 * @returns {Promise<void>}
		 */
		async farewell() {
			if (player) {
				savedState = null
				await stopHold()
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
