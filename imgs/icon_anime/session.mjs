/**
 * Icon anime controller: anim state + TUI player.
 * Hosts own process hooks (`on_shutdown` → farewell).
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
 * @property {boolean} userAborted - last play ended by Ctrl+C
 * @property {() => Promise<void>} start - CLI: enter→hold until abort
 * @property {() => Promise<void>} intro - play enter to completion, leave alt-screen, keep state for farewell
 * @property {() => Promise<void>} farewell - play exit from live or saved progress, restore terminal
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

	return {
		/** @returns {boolean} whether last play ended by Ctrl+C */
		get userAborted() {
			return userAborted
		},

		/**
		 * Enter → hold until Ctrl+C (standalone CLI).
		 * @returns {Promise<void>}
		 */
		start() {
			if (player) return running
			userAborted = false
			stopping = false
			player = openPlayer(createAnimState())
			savedState = state
			player.start()
			running = player.play(() => enter(state)).loop(() => hold(state)).then(() => {
				if (!stopping) userAborted = true
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
		 * Play exit from live hold/intro or parked progress.
		 * @returns {Promise<void>}
		 */
		async farewell() {
			if (player) {
				stopping = true
				savedState = null
				player.abort()
				await Promise.resolve()
				await running?.catch(() => { /* abort */ })
				running = null
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
