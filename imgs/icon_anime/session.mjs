/**
 * Bound icon anime session: anim state + TUI player with resize / pointer wired.
 * Used by the CLI entry and by hosts that embed the waiting/exit animation (e.g. log_viewer).
 */

import { ICON_W, ICON_H } from './icon.mjs'
import { lightPointer } from './light_gesture.mjs'
import { AsciiAnimePlayer } from './player.mjs'
import {
	createAnimState, resizeAnimState, enter, hold, exit,
} from './scene.mjs'
import { windPointer } from './wind_gesture.mjs'

/** Target frame rate. */
export const fps = 24

/**
 * @typedef {object} IconAnimeSession
 * @property {ReturnType<typeof createAnimState>} state - shared anim state
 * @property {AsciiAnimePlayer} player - TUI player
 * @property {() => IconAnimeSession} start - enter alt-screen / raw stdin
 * @property {() => void} stop - leave alt-screen / restore terminal
 * @property {() => void} abort - abort active play/loop
 * @property {() => Promise<void> & { play: Function, loop: Function }} run - enter then hold until abort
 * @property {() => Promise<void> & { play: Function, loop: Function }} playExit - tear-down from current progress
 */

/**
 * Create a session bound to a fresh or existing anim state.
 * @param {ReturnType<typeof createAnimState>} [state] existing state (e.g. farewell after dismiss)
 * @returns {IconAnimeSession} bound session
 */
export function createIconAnimeSession(state = createAnimState()) {
	/**
	 * Rebuild scene when the terminal is resized.
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
		/**
		 * @returns {IconAnimeSession} this
		 */
		start() {
			player.start()
			return this
		},
		/**
		 * @returns {void}
		 */
		stop() {
			player.stop()
		},
		/**
		 * @returns {void}
		 */
		abort() {
			player.abort()
		},
		/**
		 * Enter → hold until abort.
		 * @returns {Promise<void> & { play: Function, loop: Function }} chainable play promise
		 */
		run() {
			return player.play(() => enter(state)).loop(() => hold(state))
		},
		/**
		 * Exit animation from current icon progress (refreshes abort signal).
		 * @returns {Promise<void> & { play: Function, loop: Function }} chainable play promise
		 */
		playExit() {
			return player.play(() => exit(state), { signal: null })
		},
	}
}
