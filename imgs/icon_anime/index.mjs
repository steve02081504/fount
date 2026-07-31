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
 * Main: enter → loop hold → Ctrl+C → exit from current progress.
 * Pointer: left quick-click → bright expanding ripple; left hold → spotlight;
 *   right drag stroke wind; right long-still clockwise vortex (follows / reforms / clears on release).
 */

import process from 'node:process'

import {
	createAnimState, resizeAnimState, enter, hold, exit,
} from './scene.mjs'
import { createIconAnime, fps } from './session.mjs'

/**
 *
 */
export {
	ICON_W, ICON_H, ICON_PACK_H, ICON_BASE_ROWS, ICON_BASE_X0, ICON_BASE_X1,
	ICON_BODY_H, maxBodyD, maxPillarH,
} from './icon.mjs'
/**
 *
 */
export { renderBuffers, renderGrid } from './compose.mjs'
/**
 *
 */
export {
	createAnimState, resizeAnimState, enter, hold, exit,
}
/**
 *
 */
export { createIconAnime, fps }
/**
 *
 */
export { AsciiAnimePlayer } from './player.mjs'

/** Public frame producers. */
export const iconAnim = { enter, hold, exit, fps, createAnimState, resizeAnimState }

if (import.meta.main) {
	const icon = createIconAnime()
	await icon.start()
	await icon.farewell()
	process.exit(icon.userAborted ? 130 : 0)
}
