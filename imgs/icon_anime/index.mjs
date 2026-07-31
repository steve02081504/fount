#!/usr/bin/env -S deno run -A
/**
 * fount fountain logo ASCII animation.
 *
 * Materials (see AGENTS.md):
 *   body `@`  — impact shell (splash then vanish)
 *   `:`       — visual jet only (does not block fluid)
 *   base `@`  — pool that leaks downward | `>`/`<` — 45° splash
 *   terrain   — soil stores moisture; ceilings condense & drip
 *
 * createAnimState({ width?, height?, seed? }) — defaults to terminal size when available.
 * Main: enter → loop hold → Ctrl+C → exit from current progress
 */

import process from 'node:process'

import { on_shutdown } from 'npm:on-shutdown'

import { layout, ICON_W, ICON_H } from './icon.mjs'
import { AsciiAnimePlayer } from './player.mjs'
import {
	createAnimState, resizeAnimState, enter, hold, exit,
} from './scene.mjs'

/**
 *
 */
export { layout, ICON_W, ICON_H }
/**
 *
 */
export { renderBuffers, renderGrid } from './compose.mjs'
/**
 *
 */
export {
	createAnimState, resizeAnimState, enter, hold, exit,
} from './scene.mjs'

/** Target frame rate. */
export const fps = 24

/** Public frame producers. */
export const iconAnim = { enter, hold, exit, fps, createAnimState, resizeAnimState }

if (import.meta.main) {
	const state = createAnimState()
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
	const player = new AsciiAnimePlayer({ fps, onResize: handleResize })

	on_shutdown(async () => {
		player.abort()
		await player.play(() => exit(state), { signal: null })
		player.stop()
	})

	player.start()
	await player.play(() => enter(state)).loop(() => hold(state))
	process.exit(0)
}
